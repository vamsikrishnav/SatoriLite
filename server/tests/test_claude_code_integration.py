"""Integration test for Claude Code chat endpoint with mocked subprocess."""

import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from server.main import app
from server.claude_code import reset_claude_available_cache


@pytest.fixture
def client():
    reset_claude_available_cache()
    yield TestClient(app)
    reset_claude_available_cache()


def test_chat_streams_text_events(client):
    stream_lines = [
        '{"type":"system","subtype":"init","session_id":"test-123"}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]},"session_id":"test-123"}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":" world"}]},"session_id":"test-123"}\n',
        '{"type":"result","subtype":"success","session_id":"test-123"}\n',
    ]

    with patch("server.main.check_claude_available", return_value={"available": True, "version": "2.1.0"}):
        with patch("server.claude_code._read_line_with_timeout", side_effect=stream_lines + [None]):
            with patch("server.claude_code.subprocess.Popen") as mock_popen:
                proc = MagicMock()
                proc.poll.return_value = None
                proc.kill = MagicMock()
                proc.wait = MagicMock()
                mock_popen.return_value = proc

                resp = client.post("/api/cc/chat", json={
                    "message": "hello",
                    "session_id": "test-123",
                })

    assert resp.status_code == 200
    events = []
    for line in resp.text.strip().split("\n"):
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))

    types = [e["type"] for e in events]
    assert "session" in types
    assert "text" in types
    assert "done" in types


def test_chat_returns_503_when_unavailable(client):
    with patch("server.main.check_claude_available", return_value={"available": False, "detail": "not installed"}):
        resp = client.post("/api/cc/chat", json={"message": "hi"})
    assert resp.status_code == 503


def test_chat_returns_400_without_message(client):
    with patch("server.main.check_claude_available", return_value={"available": True, "version": "2.1.0"}):
        resp = client.post("/api/cc/chat", json={"message": ""})
    assert resp.status_code == 400


def test_cancel_no_active_session(client):
    resp = client.post("/api/cc/cancel", json={"session_id": "nonexistent"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "no_active_session"


def test_cancel_requires_session_id(client):
    resp = client.post("/api/cc/cancel", json={"session_id": ""})
    assert resp.status_code == 400


def test_status_endpoint(client):
    with patch("server.main.check_claude_available", return_value={"available": True, "version": "2.1.156"}):
        resp = client.get("/api/cc/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is True
    assert data["version"] == "2.1.156"
