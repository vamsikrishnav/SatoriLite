"""Claude Code subprocess integration for SatoriLite."""

import asyncio
import json
import logging
import select
import shutil
import subprocess
import sys
from pathlib import Path

import boto3

logger = logging.getLogger("satori.claude_code")

_claude_available: dict | None = None
_active_processes: dict[str, subprocess.Popen] = {}
_known_sessions: set[str] = set()

SUBPROCESS_TIMEOUT = 120


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


MAX_CONTEXT_CHARS = 40000
MAX_FILES_TO_READ = 8
MAX_PER_FILE_CHARS = 6000

_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "am", "do", "does", "did", "has", "have", "had", "having",
    "will", "would", "shall", "should", "may", "might", "must", "can", "could",
    "about", "above", "after", "again", "all", "also", "and", "any", "because",
    "before", "between", "but", "by", "for", "from", "how", "if", "in", "into",
    "it", "its", "just", "me", "more", "most", "no", "nor", "not", "of", "on",
    "or", "other", "our", "out", "over", "own", "so", "some", "such", "than",
    "tell", "then", "there", "to", "too", "under", "up", "very", "we", "with", "you",
})


_ACTION_VERBS = frozenset({
    "list", "create", "edit", "delete", "remove", "rename", "move", "copy",
    "summarize", "find", "show", "run", "execute", "modify", "refactor",
    "write", "rewrite", "update", "fix", "debug", "change", "add",
})


def needs_tool_use(query: str) -> bool:
    """Check if a query likely needs tool actions rather than knowledge lookup."""
    words = [w.strip("?.,!\"'()") for w in query.lower().split()]
    return any(w in _ACTION_VERBS for w in words[:4])


def _extract_search_terms(query: str) -> str:
    """Extract meaningful search terms, removing stop words and short tokens."""
    words = [w.strip("?.,!\"'()") for w in query.lower().split()]
    terms = [w for w in words if w and len(w) > 1 and w not in _STOP_WORDS]
    return " ".join(terms) if terms else query


def pre_search(query: str, all_vaults: list[dict], return_files: bool = False, deep: bool = False):
    """Use FTS indices to find relevant content, read top matches.

    If return_files=True, returns (context_str, list_of_file_paths).
    Otherwise returns just the context string.
    deep=True doubles the file/context limits for thorough answers.
    """
    from server.fts import get_fts_index
    from server.config import index_dir_for_vault

    max_files = MAX_FILES_TO_READ * 2 if deep else MAX_FILES_TO_READ
    max_chars = MAX_CONTEXT_CHARS * 2 if deep else MAX_CONTEXT_CHARS
    fts_limit = 8 if deep else 5

    search_query = _extract_search_terms(query)
    search_terms = search_query.lower().split()

    scored_files = []
    for v in all_vaults:
        idx = get_fts_index(v["name"], index_dir=index_dir_for_vault(v["path"]))
        results = idx.search(search_query, limit=fts_limit)
        for r in results:
            score = r.get("score", 0)
            path_lower = r["path"].lower()
            title_lower = r.get("title", "").lower()
            matches = sum(1 for t in search_terms if t in title_lower or t in path_lower)
            score += matches * 5
            scored_files.append((score, r["path"]))

    scored_files.sort(key=lambda x: x[0], reverse=True)
    matched_files = [f[1] for f in scored_files[:max_files]]

    if not matched_files:
        return ("", []) if return_files else ""

    context_parts = []
    chars = 0
    read_files = []
    for fpath in matched_files:
        try:
            content = Path(fpath).read_text(errors="replace")
            content = content[:MAX_PER_FILE_CHARS]
            if chars + len(content) > max_chars:
                content = content[:max_chars - chars]
            context_parts.append(f"--- {fpath} ---\n{content}")
            read_files.append(fpath)
            chars += len(content)
            if chars >= max_chars:
                break
        except OSError:
            continue

    context = "\n\n".join(context_parts)
    return (context, read_files) if return_files else context


def build_system_prompt(
    active_vault: str,
    all_vaults: list[dict],
    file_path: str = "",
    file_context: str = "",
    query: str = "",
    vault_context: str = "",
) -> str:
    """Build the system prompt for Claude Code with vault context."""
    all_paths = [active_vault] + [v["path"] for v in all_vaults if v["path"] != active_vault]

    vault_list = "\n".join(f"  - {p}" for p in all_paths)

    if vault_context:
        parts = [
            "You are a knowledge assistant for the user's vaults. "
            "Answer based on the provided vault content below. "
            "If the provided content is insufficient, use your tools to search for more. "
            "Be concise and cite the source file path.",
            f"\nVault directories:\n{vault_list}",
            f"\n--- VAULT CONTENT ---\n{vault_context}\n--- END ---",
        ]
    else:
        parts = [
            "You are a knowledge assistant with access to the user's local knowledge vaults. "
            "NEVER ask clarifying questions — the answers are in the vault files. "
            "ALWAYS use your tools (grep_vault, read_file, list_files) to search before answering. "
            "Be concise and cite source file paths.",
            f"\nVault directories:\n{vault_list}",
            "\nWorkflow: 1) grep_vault for key terms. 2) read_file on top matches. "
            "3) Synthesize an answer citing file paths.",
        ]

    if file_context and file_path:
        parts.append(f"\nCurrently open file ({file_path}):\n{file_context}")

    return "\n".join(parts)


_bedrock_client = None


def _get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None:
        from server.config import AWS_REGION
        _bedrock_client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    return _bedrock_client


async def stream_bedrock_response(message: str, system_prompt: str):
    """Stream a response directly from Bedrock (fast path, no CLI)."""
    from server.config import BEDROCK_ROUTER_MODEL_ID

    client = _get_bedrock_client()
    messages = [{"role": "user", "content": [{"text": message}]}]

    try:
        response = await asyncio.to_thread(
            client.converse_stream,
            modelId=BEDROCK_ROUTER_MODEL_ID,
            messages=messages,
            system=[{"text": system_prompt}],
        )

        queue = asyncio.Queue()

        def _consume():
            for evt in response["stream"]:
                if "contentBlockDelta" in evt:
                    delta = evt["contentBlockDelta"].get("delta", {})
                    if "text" in delta:
                        queue.put_nowait({"type": "text", "content": delta["text"]})
            queue.put_nowait(None)

        task = asyncio.get_event_loop().run_in_executor(None, _consume)

        while True:
            event = await queue.get()
            if event is None:
                break
            yield event

        await task
    except Exception as e:
        yield {"type": "error", "content": f"Bedrock error: {e}"}

    yield {"type": "done"}


# --- Agentic tool-use loop (replaces CLI subprocess) ---

MAX_AGENT_ROUNDS = 5
MAX_GREP_RESULTS = 20
MAX_READ_CHARS = 8000

_VAULT_TOOLS = [
    {
        "toolSpec": {
            "name": "grep_vault",
            "description": (
                "Search for a pattern across vault files using grep. "
                "Returns matching file paths and line snippets. "
                "Use this to find files containing specific terms."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Search pattern (case-insensitive substring match)",
                        },
                        "vault_dir": {
                            "type": "string",
                            "description": "Vault directory to search in (from the listed vault paths)",
                        },
                    },
                    "required": ["pattern"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "read_file",
            "description": (
                "Read the contents of a specific file. "
                "Returns the file text, truncated if very large."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Absolute path to the file to read",
                        },
                    },
                    "required": ["file_path"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "list_files",
            "description": (
                "List markdown files in a vault directory (recursive). "
                "Returns file paths relative to the vault root."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "vault_dir": {
                            "type": "string",
                            "description": "Vault directory to list files from",
                        },
                        "subdirectory": {
                            "type": "string",
                            "description": "Optional subdirectory within the vault to scope the listing",
                        },
                    },
                    "required": ["vault_dir"],
                }
            },
        }
    },
]


def _execute_tool(name: str, input_data: dict, all_vault_paths: list[str]) -> str:
    """Execute a tool call and return the result as text."""
    if name == "grep_vault":
        pattern = input_data.get("pattern", "")
        vault_dir = input_data.get("vault_dir", "")
        if not pattern:
            return "Error: pattern is required"
        dirs_to_search = [vault_dir] if vault_dir and Path(vault_dir).is_dir() else all_vault_paths
        results = []
        for d in dirs_to_search:
            try:
                import subprocess as sp
                proc = sp.run(
                    ["grep", "-rli", "--include=*.md", pattern, d],
                    capture_output=True, text=True, timeout=10,
                )
                for line in proc.stdout.strip().splitlines()[:MAX_GREP_RESULTS]:
                    if line:
                        results.append(line)
            except (sp.TimeoutExpired, OSError):
                continue
        if not results:
            return f"No files found matching '{pattern}'"
        return f"Found {len(results)} files:\n" + "\n".join(results[:MAX_GREP_RESULTS])

    elif name == "read_file":
        file_path = input_data.get("file_path", "")
        if not file_path:
            return "Error: file_path is required"
        try:
            content = Path(file_path).read_text(errors="replace")
            if len(content) > MAX_READ_CHARS:
                content = content[:MAX_READ_CHARS] + f"\n\n[...truncated at {MAX_READ_CHARS} chars]"
            return content
        except OSError as e:
            return f"Error reading file: {e}"

    elif name == "list_files":
        vault_dir = input_data.get("vault_dir", "")
        subdir = input_data.get("subdirectory", "")
        search_root = Path(vault_dir) / subdir if subdir else Path(vault_dir)
        if not search_root.is_dir():
            return f"Error: directory not found: {search_root}"
        files = sorted(str(p) for p in search_root.rglob("*.md"))
        if not files:
            return "No markdown files found"
        if len(files) > 50:
            return f"Found {len(files)} files (showing first 50):\n" + "\n".join(files[:50])
        return f"Found {len(files)} files:\n" + "\n".join(files)

    return f"Unknown tool: {name}"


async def stream_agentic_response(
    message: str,
    system_prompt: str,
    all_vault_paths: list[str],
    vault_context: str = "",
):
    """Agentic Bedrock converse loop with tool use. Yields SSE events."""
    from server.config import BEDROCK_ROUTER_MODEL_ID

    client = _get_bedrock_client()

    user_content = []
    if vault_context:
        user_content.append({"text": f"Pre-fetched vault content:\n\n{vault_context}\n\n---\n\nQuestion: {message}"})
    else:
        user_content.append({"text": message})

    messages = [{"role": "user", "content": user_content}]

    try:
        for round_num in range(MAX_AGENT_ROUNDS):
            response = await asyncio.to_thread(
                client.converse,
                modelId=BEDROCK_ROUTER_MODEL_ID,
                messages=messages,
                system=[{"text": system_prompt}],
                toolConfig={"tools": _VAULT_TOOLS},
            )

            output = response.get("output", {})
            assistant_message = output.get("message", {})
            content_blocks = assistant_message.get("content", [])
            stop_reason = response.get("stopReason", "")

            messages.append({"role": "assistant", "content": content_blocks})

            tool_uses = []
            for block in content_blocks:
                if "text" in block:
                    yield {"type": "text", "content": block["text"]}
                elif "toolUse" in block:
                    tool = block["toolUse"]
                    tool_uses.append(tool)
                    yield {
                        "type": "tool_start",
                        "tool": tool["name"],
                        "input": tool.get("input", {}),
                    }

            if stop_reason == "end_turn" or not tool_uses:
                break

            tool_results = []
            for tool in tool_uses:
                result_text = await asyncio.to_thread(
                    _execute_tool, tool["name"], tool.get("input", {}), all_vault_paths
                )
                tool_results.append({
                    "toolResult": {
                        "toolUseId": tool["toolUseId"],
                        "content": [{"text": result_text}],
                    }
                })

            messages.append({"role": "user", "content": tool_results})

    except Exception as e:
        logger.exception("Agentic loop error")
        yield {"type": "error", "content": f"Agent error: {e}"}

    yield {"type": "done"}


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

    is_resume = session_id in _known_sessions

    cmd = ["claude", "-p", "--model", "sonnet",
           "--output-format", "stream-json", "--verbose",
           "--max-turns", "8", "--permission-mode", "auto"]
    if is_resume:
        cmd += ["--resume", session_id]
    else:
        cmd += ["--session-id", session_id, "--system-prompt", system_prompt]
    cmd.append(message)

    _known_sessions.add(session_id)

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


def clear_session(session_id: str):
    """Remove session from known sessions (for 'new session' action)."""
    _known_sessions.discard(session_id)
