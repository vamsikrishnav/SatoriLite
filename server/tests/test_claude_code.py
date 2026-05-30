"""Tests for server/claude_code.py — CLI check, system prompt, event parsing."""

import pytest
from unittest.mock import patch

from server.claude_code import (
    check_claude_available,
    reset_claude_available_cache,
    build_system_prompt,
    parse_stream_event,
)


@pytest.fixture(autouse=True)
def reset_cache():
    """Reset the availability cache before each test."""
    reset_claude_available_cache()
    yield
    reset_claude_available_cache()


# --- CLI availability ---

def test_check_claude_available_found():
    with patch("server.claude_code.shutil.which", return_value="/usr/local/bin/claude"):
        with patch("server.claude_code.subprocess.run") as mock_run:
            mock_run.return_value.stdout = "2.1.156"
            result = check_claude_available()
    assert result["available"] is True
    assert "version" in result


def test_check_claude_available_not_found():
    with patch("server.claude_code.shutil.which", return_value=None):
        result = check_claude_available()
    assert result["available"] is False


# --- System prompt ---

def test_build_system_prompt_with_file_context():
    prompt = build_system_prompt(
        active_vault="/home/user/notes",
        all_vaults=[
            {"name": "notes", "path": "/home/user/notes"},
            {"name": "work", "path": "/home/user/work"},
        ],
        file_path="projects/todo.md",
        file_context="# Todo\n- Buy milk",
    )
    assert "/home/user/notes" in prompt
    assert "/home/user/work" in prompt
    assert "projects/todo.md" in prompt
    assert "Buy milk" in prompt
    assert "knowledge assistant" in prompt


def test_build_system_prompt_without_file_context():
    prompt = build_system_prompt(
        active_vault="/home/user/notes",
        all_vaults=[{"name": "notes", "path": "/home/user/notes"}],
        file_path="",
        file_context="",
    )
    assert "/home/user/notes" in prompt
    assert "currently has" not in prompt


# --- Stream event parsing ---

def test_parse_text_event():
    line = '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]},"session_id":"abc"}'
    events = parse_stream_event(line)
    assert len(events) == 1
    assert events[0] == {"type": "text", "content": "Hello world"}


def test_parse_tool_use_event():
    line = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/a/b.md"}}]},"session_id":"abc"}'
    events = parse_stream_event(line)
    assert len(events) == 1
    assert events[0] == {"type": "tool_start", "tool": "Read", "input": {"file_path": "/a/b.md"}}


def test_parse_thinking_event_skipped():
    line = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"}]},"session_id":"abc"}'
    events = parse_stream_event(line)
    assert len(events) == 0


def test_parse_result_event():
    line = '{"type":"result","subtype":"success","session_id":"abc","duration_ms":1234}'
    events = parse_stream_event(line)
    assert len(events) == 1
    assert events[0] == {"type": "done"}


def test_parse_system_event_skipped():
    line = '{"type":"system","subtype":"init","session_id":"abc"}'
    events = parse_stream_event(line)
    assert len(events) == 0


def test_parse_invalid_json():
    events = parse_stream_event("not json at all")
    assert len(events) == 0


def test_parse_multi_content_blocks():
    line = json.dumps({
        "type": "assistant",
        "message": {
            "content": [
                {"type": "text", "text": "Reading file..."},
                {"type": "tool_use", "name": "Read", "input": {"file_path": "/x.md"}},
            ]
        },
        "session_id": "abc",
    })
    events = parse_stream_event(line)
    assert len(events) == 2
    assert events[0]["type"] == "text"
    assert events[1]["type"] == "tool_start"


import json
