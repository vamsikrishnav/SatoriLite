"""Tool execution layer for agentic chat."""

import logging
import subprocess
from pathlib import Path

from server.fts import search_fts

logger = logging.getLogger("satori.tools")

MAX_GREP_RESULTS = 20
MAX_FIND_RESULTS = 20
MAX_READ_LINES = 200
MAX_SEARCH_RESULTS = 10


def execute_tool(name: str, args: dict, vault_path: str, vault_name: str) -> dict:
    """Execute a tool by name and return the result."""
    handlers = {
        "search": _tool_search,
        "grep": _tool_grep,
        "find": _tool_find,
        "read": _tool_read,
    }
    handler = handlers.get(name)
    if not handler:
        return {"error": f"Unknown tool: {name}"}
    try:
        return handler(args, vault_path, vault_name)
    except Exception as e:
        logger.warning("Tool %s failed: %s", name, e)
        return {"error": str(e)}


def _tool_search(args: dict, vault_path: str, vault_name: str) -> dict:
    query = args.get("query", "")
    limit = min(args.get("limit", MAX_SEARCH_RESULTS), MAX_SEARCH_RESULTS)
    if not query:
        return {"error": "query is required", "results": []}
    results = search_fts(vault_name, query, limit=limit)
    return {"results": [
        {"path": r["path"], "title": r["title"], "score": r["score"], "snippet": r.get("snippet", "")}
        for r in results
    ]}


def _tool_grep(args: dict, vault_path: str, vault_name: str) -> dict:
    pattern = args.get("pattern", "")
    if not pattern:
        return {"error": "pattern is required", "results": []}
    try:
        result = subprocess.run(
            ["grep", "-rin", "--include=*.md", pattern, vault_path],
            capture_output=True, text=True, timeout=10,
        )
    except subprocess.TimeoutExpired:
        return {"error": "grep timed out", "results": []}
    lines = result.stdout.strip().split("\n") if result.stdout.strip() else []
    results = []
    for line in lines[:MAX_GREP_RESULTS]:
        parts = line.split(":", 2)
        if len(parts) >= 3:
            results.append({"path": parts[0], "line_number": int(parts[1]), "match": parts[2].strip()})
    return {"results": results}


def _tool_find(args: dict, vault_path: str, vault_name: str) -> dict:
    pattern = args.get("pattern", "")
    if not pattern:
        return {"error": "pattern is required", "results": []}
    try:
        result = subprocess.run(
            ["find", vault_path, "-name", pattern, "-type", "f", "-not", "-path", "*/.*"],
            capture_output=True, text=True, timeout=10,
        )
    except subprocess.TimeoutExpired:
        return {"error": "find timed out", "results": []}
    paths = [p for p in result.stdout.strip().split("\n") if p]
    return {"results": [{"path": p} for p in paths[:MAX_FIND_RESULTS]]}


def _tool_read(args: dict, vault_path: str, vault_name: str) -> dict:
    path = args.get("path", "")
    if not path:
        return {"error": "path is required"}
    real_path = str(Path(path).resolve())
    real_vault = str(Path(vault_path).resolve())
    if not real_path.startswith(real_vault):
        return {"error": "path must be within the vault"}
    if not Path(real_path).exists():
        return {"error": f"file not found: {path}"}
    try:
        lines = Path(real_path).read_text(encoding="utf-8").split("\n")
    except (UnicodeDecodeError, PermissionError, OSError) as e:
        return {"error": str(e)}
    start = max(0, args.get("start_line", 1) - 1)
    end = min(len(lines), args.get("end_line", len(lines)))
    if end - start > MAX_READ_LINES:
        end = start + MAX_READ_LINES
    content = "\n".join(lines[start:end])
    return {"content": content, "start_line": start + 1, "end_line": end, "total_lines": len(lines)}


TOOL_DEFINITIONS = [
    {
        "toolSpec": {
            "name": "search",
            "description": "Search vault notes using keyword matching (BM25). Good for discovering relevant files when you don't know exact phrasing. Returns titles, paths, and text snippets.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query (keywords)"},
                        "limit": {"type": "integer", "description": "Max results (default 10)"},
                    },
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "grep",
            "description": "Search for an exact pattern (regex or string) across all markdown files in the vault. Case-insensitive. Returns matching file paths, line numbers, and matched text. Use for exact phrases, acronyms, or specific terminology.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Regex or exact string to search for"},
                    },
                    "required": ["pattern"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "find",
            "description": "Find files by name pattern (glob). Use to discover files when you know part of the filename.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Glob pattern for filename (e.g. '*provider*', '*.md')"},
                    },
                    "required": ["pattern"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "read",
            "description": "Read the content of a file, optionally a specific line range. Use after search/grep/find to get full context from a relevant file.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Absolute path to the file"},
                        "start_line": {"type": "integer", "description": "Start line (1-based, default: 1)"},
                        "end_line": {"type": "integer", "description": "End line (default: end of file, capped at 200 lines)"},
                    },
                    "required": ["path"],
                }
            },
        }
    },
]
