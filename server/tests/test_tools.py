"""Tests for the tool execution layer."""

import os

import pytest

from server.tools import execute_tool


@pytest.fixture
def vault_dir(tmp_path):
    """Create a minimal vault with test files."""
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "btp-overview.md").write_text(
        "# BTP Overview\n\nSAP Business Technology Platform.\n\n"
        "## Provider Account\n\nA provider global account is owned by SAP.\n"
    )
    (notes / "kubernetes.md").write_text(
        "# Kubernetes\n\nContainer orchestration platform.\n\n"
        "## Pods\n\nSmallest deployable unit.\n"
    )
    sub = notes / "sub"
    sub.mkdir()
    (sub / "nested.md").write_text("# Nested\n\nNested file content.\n")
    return str(notes)


class TestSearchTool:
    def test_search_returns_results(self, vault_dir):
        from server.fts import build_fts_index
        idx_dir = vault_dir + "/.idx"
        build_fts_index("test_vault", vault_dir, index_dir=idx_dir)

        result = execute_tool("search", {"query": "provider account"}, vault_path=vault_dir, vault_name="test_vault")
        assert len(result["results"]) > 0
        assert any("btp" in r["title"].lower() for r in result["results"])

    def test_search_no_results(self, vault_dir):
        from server.fts import build_fts_index
        idx_dir = vault_dir + "/.idx"
        build_fts_index("test_vault", vault_dir, index_dir=idx_dir)

        result = execute_tool("search", {"query": "xyznonexistent"}, vault_path=vault_dir, vault_name="test_vault")
        assert result["results"] == []

    def test_search_requires_query(self, vault_dir):
        result = execute_tool("search", {"query": ""}, vault_path=vault_dir, vault_name="test_vault")
        assert "error" in result


class TestGrepTool:
    def test_grep_exact_phrase(self, vault_dir):
        result = execute_tool("grep", {"pattern": "provider global account"}, vault_path=vault_dir, vault_name="test_vault")
        assert len(result["results"]) > 0
        assert "btp-overview.md" in result["results"][0]["path"]

    def test_grep_no_match(self, vault_dir):
        result = execute_tool("grep", {"pattern": "xyznonexistent"}, vault_path=vault_dir, vault_name="test_vault")
        assert result["results"] == []

    def test_grep_case_insensitive(self, vault_dir):
        result = execute_tool("grep", {"pattern": "PROVIDER GLOBAL"}, vault_path=vault_dir, vault_name="test_vault")
        assert len(result["results"]) > 0

    def test_grep_requires_pattern(self, vault_dir):
        result = execute_tool("grep", {"pattern": ""}, vault_path=vault_dir, vault_name="test_vault")
        assert "error" in result


class TestFindTool:
    def test_find_by_glob(self, vault_dir):
        result = execute_tool("find", {"pattern": "*btp*"}, vault_path=vault_dir, vault_name="test_vault")
        assert len(result["results"]) > 0
        assert any("btp-overview.md" in r["path"] for r in result["results"])

    def test_find_all_md(self, vault_dir):
        result = execute_tool("find", {"pattern": "*.md"}, vault_path=vault_dir, vault_name="test_vault")
        assert len(result["results"]) == 3

    def test_find_no_match(self, vault_dir):
        result = execute_tool("find", {"pattern": "*.xyz"}, vault_path=vault_dir, vault_name="test_vault")
        assert result["results"] == []

    def test_find_requires_pattern(self, vault_dir):
        result = execute_tool("find", {"pattern": ""}, vault_path=vault_dir, vault_name="test_vault")
        assert "error" in result


class TestReadTool:
    def test_read_full_file(self, vault_dir):
        path = os.path.join(vault_dir, "btp-overview.md")
        result = execute_tool("read", {"path": path}, vault_path=vault_dir, vault_name="test_vault")
        assert "Provider Account" in result["content"]
        assert result["total_lines"] >= 7

    def test_read_line_range(self, vault_dir):
        path = os.path.join(vault_dir, "btp-overview.md")
        result = execute_tool("read", {"path": path, "start_line": 5, "end_line": 7}, vault_path=vault_dir, vault_name="test_vault")
        assert "provider global account" in result["content"].lower()

    def test_read_nonexistent(self, vault_dir):
        result = execute_tool("read", {"path": "/nonexistent/file.md"}, vault_path=vault_dir, vault_name="test_vault")
        assert "error" in result

    def test_read_outside_vault_rejected(self, vault_dir):
        result = execute_tool("read", {"path": "/etc/passwd"}, vault_path=vault_dir, vault_name="test_vault")
        assert "error" in result

    def test_read_requires_path(self, vault_dir):
        result = execute_tool("read", {"path": ""}, vault_path=vault_dir, vault_name="test_vault")
        assert "error" in result


class TestUnknownTool:
    def test_unknown_tool_returns_error(self, vault_dir):
        result = execute_tool("unknown", {}, vault_path=vault_dir, vault_name="test_vault")
        assert "error" in result
