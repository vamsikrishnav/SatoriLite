# Claude Code Integration for SatoriLite

**Date:** 2026-05-29  
**Status:** Approved  
**Summary:** Add a Claude Code-powered chat panel to SatoriLite that spawns Claude Code as a subprocess, scoped to the user's vault, with full tool access (codegraph, semble, MCP servers, Read, Bash). Existing Bedrock-powered chat remains untouched.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser                                             │
│                                                      │
│  Existing chat panel ──→ POST /api/chat (Bedrock)   │
│                                                      │
│  NEW CC chat panel ────→ POST /api/claude-code/chat │
│       ↑                         │                    │
│       │ SSE stream              │ spawns subprocess  │
│       │                         ▼                    │
│       │              claude --print --stream-json    │
│       │              --session-id {sid}              │
│       │              --continue                      │
│       │              cwd=vault_path                  │
│       └─────────────── stdout parsed & relayed ─────┘
└─────────────────────────────────────────────────────┘
```

### New Components

- `server/claude_code.py` — subprocess management, stream parsing, SSE relay
- `js/claude-chat.js` — CC-specific chat panel, tool-activity rendering, session management

### Untouched

- `server/main.py` `/api/chat` endpoint (existing Bedrock chat)
- `js/chat.js` (existing chat module)
- `server/tools.py`, `server/fts.py`, `server/watcher.py`
- All other frontend modules

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI entry point | New toolbar icon (alongside existing chat icon) | Preserves existing chat, separate panel |
| Vault access | Read-write | Full Claude Code capability — create, edit, refactor notes |
| Conversation history | Session-based via `--session-id` + `--continue` | Native multi-turn, Claude Code manages context |
| Output display | Collapsible tool activity + streamed text | Shows what CC is doing without overwhelming |
| Current file context | Auto-passed in system prompt | "Summarize this" works without specifying which file |
| System prompt | Minimal scoping + CLAUDE.md in vault | Server passes context, user customizes behavior via CLAUDE.md |
| Tool restrictions | None — full access | Codegraph, semble, MCP servers, Read, Bash all available |
| Vault search priority | Active vault first, expand to all registered vaults if not found | Prompt-level instruction, not code constraint |
| Error handling | Graceful degradation | Grayed icon if CLI missing, inline errors, abort support |
| Implementation approach | Direct subprocess per message | Simplest, uses CLI as designed, no runtime changes |

---

## Server: `server/claude_code.py`

### Responsibilities

- Check if `claude` CLI is installed (cached at startup)
- Manage session IDs (in-memory dict, one per browser session)
- Spawn subprocess per message with correct flags
- Parse `stream-json` events line-by-line from stdout
- Convert to SSE events and yield to the frontend
- Handle abort (cancel request → kill subprocess)
- Handle errors (crash, timeout, CLI not found)

### Subprocess Invocation

```python
claude --print \
  --output-format stream-json \
  --session-id {session_id} \
  --continue \
  --system-prompt "{system_prompt}" \
  "{user_message}"
```

- `cwd` = active vault path
- No `--allowedTools` restriction

### System Prompt Construction

```
Your primary scope is the active vault at {active_vault_path}. Search here first.
If you cannot find what the user needs, expand your search to these additional vaults: {other_vault_paths}.
Always prefer results from the active vault when they exist.

The user currently has this file open ({file_path}):
{file_content}
```

### SSE Event Types Emitted

| Event type | Payload | When |
|------------|---------|------|
| `text` | `{content: "..."}` | Assistant text token |
| `tool_start` | `{tool: "Read", input: {...}}` | Claude Code starts a tool call |
| `tool_result` | `{tool: "Read", output: "..."}` | Tool call completes |
| `error` | `{content: "..."}` | Process error or crash |
| `done` | `{}` | Stream finished |

---

## API Endpoints

Three new endpoints, prefixed `/api/claude-code/`:

### `GET /api/claude-code/status`

Returns whether Claude Code CLI is available.

**Response:**
```json
{"available": true, "version": "1.x.x"}
```

Or if not installed:
```json
{"available": false, "detail": "Claude Code CLI not installed"}
```

### `POST /api/claude-code/chat`

Main chat endpoint. Returns SSE stream.

**Request body:**
```json
{
  "message": "What notes do I have about kubernetes?",
  "session_id": "uuid-here",
  "file_context": "# Current file content...",
  "file_path": "notes/k8s-setup.md"
}
```

**Response:** `Content-Type: text/event-stream` with events as described above.

If `session_id` is omitted, server generates one and returns it in the first SSE event.

### `POST /api/claude-code/cancel`

Kills active subprocess for a given session.

**Request body:**
```json
{
  "session_id": "uuid-here"
}
```

---

## Frontend: `js/claude-chat.js`

### UI Placement

- New toolbar icon in the view toggle bar (next to existing chat icon)
- Claude-specific icon (sparkle/asterisk or Claude logomark)
- Clicking opens right sidebar with a separate panel (not sharing DOM with existing chat)
- Both panels can exist simultaneously, only one visible at a time

### Panel Structure

- **Header:** "Claude Code" title + clear button + close button
- **Messages area:** scrollable, renders assistant markdown + collapsible tool activity
- **Input area:** textarea + send button (same pattern as existing chat)
- **Status indicator:** streaming/idle/unavailable states

### Tool Activity Rendering

- `tool_start` → append collapsed block: tool name + brief input summary (e.g., "Reading notes/project-ideas.md")
- `tool_result` → update block with chevron to expand full output
- Multiple tool calls stack vertically between text blocks
- Text tokens stream inline as progressive markdown

### Session Management

- Generate UUID `session_id` on first message, store in module state
- "Clear" button resets session_id (fresh conversation)
- Session persists across panel open/close within same page session
- Page refresh = new session

### Abort/Cancel

- While streaming, send button becomes "Stop" button
- Clicking stop sends `POST /api/claude-code/cancel`
- Partial response stays visible in the panel

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Claude Code not installed | Icon grayed out, tooltip: "Install Claude Code to enable". Endpoints return 503. |
| Subprocess crashes mid-stream | Emit `{"type": "error", "content": "Claude Code process terminated unexpectedly"}` then `{"type": "done"}`. Partial output stays visible. |
| User sends message while streaming | Kill current subprocess, start new one. Frontend clears streaming state. |
| Subprocess hangs (no output for 60s) | Timeout, kill process, emit error event. |
| Vault path doesn't exist | Return 400 with detail. |
| Session ID not provided | Server generates one, returns in first SSE event. |
| Very long output (context exhaustion) | Claude Code handles internally (compaction). No server-side limit. |
| Permission errors on vault files | Claude Code reports in its output — relayed as normal text. |

---

## File Changes

### New Files

```
server/claude_code.py      — subprocess management, stream parsing, SSE relay
js/claude-chat.js          — frontend panel, tool activity rendering, session management
```

### Modified Files

```
server/main.py             — register 3 new endpoints (import from claude_code.py)
index.html                 — add new toolbar icon + new sidebar panel div
css/satori.css             — styles for tool-activity blocks (collapsible)
js/app.js                  — import and call initClaudeChat() in openVault()
```

### Not Modified

```
js/chat.js                 — existing Bedrock chat
server/tools.py            — existing tool definitions
server/fts.py              — existing FTS engine
server/watcher.py          — existing file watcher
server/registry.py         — existing vault registry
All other js/ modules
```

---

## Integration Point

In `js/app.js`, inside `openVault()`:

```javascript
// After initChat():
initClaudeChat();
```

One import, one init call. Minimal coupling.
