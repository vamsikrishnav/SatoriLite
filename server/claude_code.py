"""Claude Code subprocess integration for SatoriLite."""

import asyncio
import json
import logging
import select
import shutil
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger("satori.claude_code")

_claude_available: dict | None = None
_active_processes: dict[str, subprocess.Popen] = {}

SUBPROCESS_TIMEOUT = 60


def check_claude_available() -> dict:
    """Check if the claude CLI is installed. Caches result."""
    global _claude_available
    if _claude_available is not None:
        return _claude_available

    path = shutil.which("claude")
    if not path:
        _claude_available = {"available": False, "detail": "Claude Code CLI not installed"}
        return _claude_available

    try:
        result = subprocess.run(
            ["claude", "--version"], capture_output=True, text=True, timeout=5
        )
        version = result.stdout.strip() or "unknown"
    except (subprocess.TimeoutExpired, OSError):
        version = "unknown"

    _claude_available = {"available": True, "version": version, "path": path}
    return _claude_available


def reset_claude_available_cache():
    """Reset the cached availability check (for testing)."""
    global _claude_available
    _claude_available = None


def build_system_prompt(
    active_vault: str,
    all_vaults: list[dict],
    file_path: str = "",
    file_context: str = "",
) -> str:
    """Build the system prompt for Claude Code with vault context."""
    other_vaults = [v for v in all_vaults if v["path"] != active_vault]
    other_paths = ", ".join(v["path"] for v in other_vaults)

    parts = [
        f"Your primary scope is the active vault at {active_vault}. Search here first.",
    ]

    if other_paths:
        parts.append(
            f"If you cannot find what the user needs, expand your search to these additional vaults: {other_paths}. "
            f"Always prefer results from the active vault when they exist."
        )

    if file_context and file_path:
        parts.append(f"\nThe user currently has this file open ({file_path}):\n{file_context}")

    return "\n".join(parts)


def parse_stream_event(line: str) -> list[dict]:
    """Parse a single stream-json line into zero or more SSE events."""
    try:
        data = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return []

    event_type = data.get("type")

    if event_type == "result":
        return [{"type": "done"}]

    if event_type == "system":
        return []

    if event_type == "assistant":
        message = data.get("message", {})
        content_blocks = message.get("content", [])
        events = []
        for block in content_blocks:
            block_type = block.get("type")
            if block_type == "text":
                text = block.get("text", "")
                if text:
                    events.append({"type": "text", "content": text})
            elif block_type == "tool_use":
                events.append({
                    "type": "tool_start",
                    "tool": block.get("name", ""),
                    "input": block.get("input", {}),
                })
        return events

    return []


def _read_line_with_timeout(proc: subprocess.Popen, timeout: float) -> str | None:
    """Read a line from proc.stdout, return None on EOF, '__TIMEOUT__' on timeout."""
    if sys.platform == "darwin" or sys.platform.startswith("linux"):
        ready, _, _ = select.select([proc.stdout], [], [], timeout)
        if not ready:
            return "__TIMEOUT__"

    line = proc.stdout.readline()
    if not line:
        return None
    return line


async def stream_claude_response(
    message: str,
    session_id: str,
    vault_path: str,
    system_prompt: str,
):
    """Spawn claude subprocess and yield SSE events."""
    await cancel_session(session_id)

    cmd = [
        "claude", "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--session-id", session_id,
        "--continue",
        "--system-prompt", system_prompt,
        message,
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=vault_path,
            text=True,
            bufsize=1,
        )
        _active_processes[session_id] = proc
    except OSError as e:
        yield {"type": "error", "content": f"Failed to start Claude Code: {e}"}
        yield {"type": "done"}
        return

    try:
        while True:
            line = await asyncio.to_thread(_read_line_with_timeout, proc, SUBPROCESS_TIMEOUT)
            if line is None:
                break
            if line == "__TIMEOUT__":
                yield {"type": "error", "content": "Claude Code timed out (no output for 60s)"}
                proc.kill()
                break

            line = line.strip()
            if not line:
                continue

            events = parse_stream_event(line)
            for event in events:
                yield event
                if event["type"] == "done":
                    return
    except Exception as e:
        yield {"type": "error", "content": f"Claude Code process error: {e}"}
    finally:
        _active_processes.pop(session_id, None)
        if proc.poll() is None:
            proc.kill()
            await asyncio.to_thread(proc.wait, timeout=5)

    yield {"type": "done"}


async def cancel_session(session_id: str) -> bool:
    """Kill the active subprocess for a session. Returns True if killed."""
    proc = _active_processes.pop(session_id, None)
    if proc and proc.poll() is None:
        proc.kill()
        await asyncio.to_thread(proc.wait, timeout=5)
        return True
    return False
