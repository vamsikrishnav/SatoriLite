"""Integration test: full agent loop with mocked Bedrock."""

import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from server.fts import build_fts_index


@pytest.fixture
def integration_setup(tmp_path):
    """Set up a vault with FTS index and patched app."""
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    (vault_path / "btp-automation.md").write_text(
        "# BTP Automation\n\n## Overview\n\n"
        "UCA streamlines SAP BTP resource provisioning.\n\n"
        "## SAP-Managed Mode\n\n"
        "In SAP-managed mode, UCA automates provisioning in SAP's provider global account "
        "on behalf of the customer. The provider global account is owned by SAP and hosts "
        "the managed application infrastructure.\n"
    )
    (vault_path / "kubernetes.md").write_text("# Kubernetes\n\nContainer orchestration.\n")

    idx_dir = str(vault_path / ".idx")
    Path(idx_dir).mkdir()
    build_fts_index("default", str(vault_path), idx_dir)

    with patch("server.main.active_vault_path", str(vault_path)), \
         patch("server.main.active_index_dir", idx_dir), \
         patch("server.main.list_vaults", return_value=[{"name": "test", "path": str(vault_path)}]):
        from server.main import app
        yield TestClient(app), str(vault_path)


def test_agent_finds_provider_account(integration_setup):
    """The agent should use tools to find provider account info."""
    client, vault_path = integration_setup

    call_count = {"n": 0}

    def mock_converse(**kwargs):
        call_count["n"] += 1

        if call_count["n"] == 1:
            return {
                "output": {"message": {"role": "assistant", "content": [
                    {"toolUse": {"toolUseId": "t1", "name": "grep",
                                 "input": {"pattern": "provider global account"}}}
                ]}},
                "stopReason": "tool_use",
            }
        elif call_count["n"] == 2:
            return {
                "output": {"message": {"role": "assistant", "content": [
                    {"toolUse": {"toolUseId": "t2", "name": "read",
                                 "input": {"path": f"{vault_path}/btp-automation.md", "start_line": 7, "end_line": 12}}}
                ]}},
                "stopReason": "tool_use",
            }
        else:
            return {
                "output": {"message": {"role": "assistant", "content": [
                    {"text": "A provider global account is owned by SAP and hosts the managed application infrastructure."}
                ]}},
                "stopReason": "end_turn",
            }

    with patch("server.main.boto3") as mock_boto:
        mock_bedrock = MagicMock()
        mock_boto.client.return_value = mock_bedrock
        mock_bedrock.converse.side_effect = mock_converse

        response = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "what is a BTP provider account?"}]
        })

        assert response.status_code == 200
        body = response.text
        events = [json.loads(line.removeprefix("data: "))
                  for line in body.split("\n") if line.startswith("data: ")]

        # Should have progress events
        progress = [e for e in events if e["type"] == "progress"]
        assert len(progress) == 2
        assert progress[0]["tool"] == "grep"
        assert progress[1]["tool"] == "read"

        # Should have the answer
        text_events = [e for e in events if e["type"] == "text"]
        assert len(text_events) == 1
        assert "provider global account" in text_events[0]["content"].lower()

        # Should have sources
        source_events = [e for e in events if e["type"] == "sources"]
        assert len(source_events) == 1
        assert any("btp-automation.md" in p for p in source_events[0]["paths"])

        # Should have done
        assert any(e["type"] == "done" for e in events)


def test_agent_respects_tool_call_limit(integration_setup):
    """Agent should stop after MAX_TOOL_CALLS."""
    client, vault_path = integration_setup

    def mock_converse_infinite_loop(**kwargs):
        return {
            "output": {"message": {"role": "assistant", "content": [
                {"toolUse": {"toolUseId": "t1", "name": "search",
                             "input": {"query": "something"}}}
            ]}},
            "stopReason": "tool_use",
        }

    with patch("server.main.boto3") as mock_boto:
        mock_bedrock = MagicMock()
        mock_boto.client.return_value = mock_bedrock
        mock_bedrock.converse.side_effect = mock_converse_infinite_loop

        response = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "loop forever"}]
        })

        # Should still return 200 (graceful stop)
        assert response.status_code == 200
        body = response.text
        events = [json.loads(line.removeprefix("data: "))
                  for line in body.split("\n") if line.startswith("data: ")]
        progress = [e for e in events if e["type"] == "progress"]
        # Should be capped at MAX_TOOL_CALLS (10)
        assert len(progress) <= 10


def test_chat_requires_messages(integration_setup):
    """Chat endpoint should reject empty messages."""
    client, _ = integration_setup
    response = client.post("/api/chat", json={"messages": []})
    assert response.status_code == 400
