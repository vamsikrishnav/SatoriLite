# Claude Code Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude Code-powered chat panel to SatoriLite that spawns Claude Code as a subprocess scoped to the user's vault, with full tool access, while keeping existing Bedrock chat untouched.

**Architecture:** Server spawns `claude -p --output-format stream-json --verbose` as a subprocess per message, parses newline-delimited JSON events from stdout, converts them to SSE events, and streams to the frontend. Frontend renders text + collapsible tool activity in a dedicated panel.

**Tech Stack:** Python/FastAPI (subprocess + asyncio), vanilla JS (ES modules), SSE streaming, Claude Code CLI

---

## File Structure

| File | Responsibility |
|------|---------------|
| `server/claude_code.py` (create) | CLI availability check, subprocess spawning, stream-json parsing, SSE event generation, session/process tracking, cancel support |
| `js/claude-chat.js` (create) | Panel DOM construction, SSE consumption, tool-activity collapsible rendering, session management, abort UX |
| `server/main.py` (modify) | Import and register 3 new endpoints from `claude_code.py` |
| `index.html` (modify) | Add toolbar icon + new sidebar panel div |
| `css/satori.css` (modify) | Styles for CC tool-activity blocks |
| `js/app.js` (modify) | Import and call `initClaudeChat()` |

---

### Task 1: Server — Claude Code subprocess module

**Files:**
- Create: `server/claude_code.py`
- Test: `server/tests/test_claude_code.py`

- [ ] **Step 1: Write the failing test for CLI availability check**

```python
# server/tests/test_claude_code.py
import pytest
from unittest.mock import patch

from server.claude_code import check_claude_available


def test_check_claude_available_found():
    with patch("shutil.which", return_value="/usr/local/bin/claude"):
        result = check_claude_available()
    assert result["available"] is True
    assert "version" in result


def test_check_claude_available_not_found():
    with patch("shutil.which", return_value=None):
        result = check_claude_available()
    assert result["available"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'server.claude_code'"

- [ ] **Step 3: Implement CLI availability check**

```python
# server/claude_code.py
"""Claude Code subprocess integration for SatoriLite."""

import asyncio
import json
import logging
import shutil
import subprocess
import uuid
from pathlib import Path

from server.registry import list_vaults

logger = logging.getLogger("satori.claude_code")

_claude_available: dict | None = None
_active_processes: dict[str, subprocess.Popen] = {}


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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py::test_check_claude_available_found server/tests/test_claude_code.py::test_check_claude_available_not_found -v`
Expected: PASS

- [ ] **Step 5: Write the failing test for system prompt construction**

```python
# Append to server/tests/test_claude_code.py

from server.claude_code import build_system_prompt


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
    assert "Search here first" in prompt


def test_build_system_prompt_without_file_context():
    prompt = build_system_prompt(
        active_vault="/home/user/notes",
        all_vaults=[{"name": "notes", "path": "/home/user/notes"}],
        file_path="",
        file_context="",
    )
    assert "/home/user/notes" in prompt
    assert "currently has" not in prompt
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py::test_build_system_prompt_with_file_context -v`
Expected: FAIL with "cannot import name 'build_system_prompt'"

- [ ] **Step 7: Implement system prompt builder**

```python
# Add to server/claude_code.py

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
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py -k "system_prompt" -v`
Expected: PASS

- [ ] **Step 9: Write the failing test for stream-json event parsing**

```python
# Append to server/tests/test_claude_code.py

from server.claude_code import parse_stream_event


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
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py -k "parse_" -v`
Expected: FAIL with "cannot import name 'parse_stream_event'"

- [ ] **Step 11: Implement stream-json event parser**

```python
# Add to server/claude_code.py

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
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py -k "parse_" -v`
Expected: PASS

- [ ] **Step 13: Implement the SSE stream generator**

```python
# Add to server/claude_code.py

SUBPROCESS_TIMEOUT = 60  # seconds of no output before killing


async def stream_claude_response(
    message: str,
    session_id: str,
    vault_path: str,
    system_prompt: str,
) -> asyncio.AsyncGenerator:
    """Spawn claude subprocess and yield SSE events."""
    global _active_processes

    # Kill any existing process for this session
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
            # Read with timeout
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


def _read_line_with_timeout(proc: subprocess.Popen, timeout: float) -> str | None:
    """Read a line from proc.stdout, return None on EOF, '__TIMEOUT__' on timeout."""
    import select
    import sys

    if sys.platform == "darwin" or sys.platform.startswith("linux"):
        ready, _, _ = select.select([proc.stdout], [], [], timeout)
        if not ready:
            return "__TIMEOUT__"
    else:
        # Fallback for other platforms
        pass

    line = proc.stdout.readline()
    if not line:
        return None
    return line


async def cancel_session(session_id: str) -> bool:
    """Kill the active subprocess for a session. Returns True if killed."""
    proc = _active_processes.pop(session_id, None)
    if proc and proc.poll() is None:
        proc.kill()
        await asyncio.to_thread(proc.wait, timeout=5)
        return True
    return False
```

- [ ] **Step 14: Run all tests to verify nothing broke**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py -v`
Expected: All PASS

- [ ] **Step 15: Commit**

```bash
git add server/claude_code.py server/tests/test_claude_code.py
git commit -m "feat: add Claude Code subprocess module with stream-json parsing"
```

---

### Task 2: Server — Register API endpoints

**Files:**
- Modify: `server/main.py` (add 3 endpoints after the vault management section, ~line 682)

- [ ] **Step 1: Write failing test for the status endpoint**

```python
# Append to server/tests/test_claude_code.py
import pytest
from unittest.mock import patch


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from server.main import app
    return TestClient(app)


def test_claude_code_status_available(client):
    with patch("server.claude_code.check_claude_available", return_value={"available": True, "version": "2.1.0"}):
        resp = client.get("/api/claude-code/status")
    assert resp.status_code == 200
    assert resp.json()["available"] is True


def test_claude_code_status_unavailable(client):
    with patch("server.claude_code.check_claude_available", return_value={"available": False, "detail": "not installed"}):
        resp = client.get("/api/claude-code/status")
    assert resp.status_code == 200
    assert resp.json()["available"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py::test_claude_code_status_available -v`
Expected: FAIL with 404 (endpoint not registered)

- [ ] **Step 3: Add endpoints to server/main.py**

Add these imports at the top of `server/main.py`:

```python
from server.claude_code import check_claude_available, build_system_prompt, stream_claude_response, cancel_session
```

Add these endpoints after the WebSocket section (after line 699):

```python
# ---------------------------------------------------------------------------
# Claude Code integration
# ---------------------------------------------------------------------------


@app.get("/api/claude-code/status")
async def claude_code_status():
    """Check if Claude Code CLI is available."""
    return check_claude_available()


@app.post("/api/claude-code/chat")
async def claude_code_chat(request: Request):
    """Stream a Claude Code response via SSE."""
    status = check_claude_available()
    if not status["available"]:
        raise HTTPException(status_code=503, detail="Claude Code CLI not installed")

    body = await request.json()
    message = body.get("message", "")
    session_id = body.get("session_id", "") or str(uuid.uuid4())
    file_context = body.get("file_context", "")
    file_path = body.get("file_path", "")

    if not message:
        raise HTTPException(status_code=400, detail="'message' is required")

    vault_path = _get_vault_path()
    all_vaults = list_vaults()

    system_prompt = build_system_prompt(
        active_vault=vault_path,
        all_vaults=all_vaults,
        file_path=file_path,
        file_context=file_context,
    )

    async def event_generator():
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"
        async for event in stream_claude_response(message, session_id, vault_path, system_prompt):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/claude-code/cancel")
async def claude_code_cancel(request: Request):
    """Cancel an active Claude Code session."""
    body = await request.json()
    session_id = body.get("session_id", "")
    if not session_id:
        raise HTTPException(status_code=400, detail="'session_id' is required")

    killed = await cancel_session(session_id)
    return {"status": "cancelled" if killed else "no_active_session", "session_id": session_id}
```

Also add `import uuid` to the imports at the top of `server/main.py` (if not already present).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code.py -k "status" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/main.py
git commit -m "feat: register Claude Code API endpoints in FastAPI app"
```

---

### Task 3: Frontend — Claude Code chat panel module

**Files:**
- Create: `js/claude-chat.js`

- [ ] **Step 1: Create the module with panel DOM construction**

```javascript
// js/claude-chat.js
import { getContent, getCurrentFilePath } from './editor.js';
import { marked } from 'marked';

let initialized = false;
let sessionId = '';
let isStreaming = false;
let abortController = null;

export function initClaudeChat() {
  if (initialized) return;
  initialized = true;

  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;

  const container = document.getElementById('panel-claude-code');
  if (!container) return;

  const panel = document.createElement('div');
  panel.className = 'cc-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'cc-header';

  const title = document.createElement('span');
  title.className = 'cc-title';
  title.textContent = 'Claude Code';

  const headerActions = document.createElement('div');
  headerActions.className = 'cc-header-actions';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-ghost cc-clear-btn';
  clearBtn.title = 'New session';
  clearBtn.textContent = 'Clear';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-ghost cc-close-btn';
  closeBtn.title = 'Close (Cmd+Shift+K)';
  closeBtn.textContent = '×';

  headerActions.appendChild(clearBtn);
  headerActions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(headerActions);

  // Messages area
  const messagesArea = document.createElement('div');
  messagesArea.className = 'cc-messages';
  messagesArea.id = 'cc-messages';

  // Input area
  const inputArea = document.createElement('div');
  inputArea.className = 'cc-input-area';

  const textarea = document.createElement('textarea');
  textarea.className = 'cc-textarea';
  textarea.id = 'cc-textarea';
  textarea.placeholder = 'Ask Claude Code…';
  textarea.rows = 1;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn btn-primary cc-send-btn';
  sendBtn.id = 'cc-send-btn';
  sendBtn.textContent = 'Send';

  inputArea.appendChild(textarea);
  inputArea.appendChild(sendBtn);

  // Assemble
  panel.appendChild(header);
  panel.appendChild(messagesArea);
  panel.appendChild(inputArea);
  container.appendChild(panel);

  // Event handlers
  closeBtn.addEventListener('click', () => toggleClaudeChat(false));
  clearBtn.addEventListener('click', clearSession);
  sendBtn.addEventListener('click', sendMessage);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });

  // Global shortcut: Cmd+Shift+K
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
      e.preventDefault();
      toggleClaudeChat();
    }
  });

  // Check availability
  checkAvailability();
}


async function checkAvailability() {
  try {
    const resp = await fetch('/api/claude-code/status');
    const data = await resp.json();
    if (!data.available) {
      const btn = document.getElementById('btn-claude-code');
      if (btn) {
        btn.classList.add('disabled');
        btn.title = 'Claude Code not installed';
      }
    }
  } catch {
    // Server not running, ignore
  }
}


export function toggleClaudeChat(forceState) {
  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;

  sidebar.querySelectorAll('.sidebar-right-panel').forEach(p => p.classList.remove('active'));
  const ccPanel = document.getElementById('panel-claude-code');
  if (ccPanel) ccPanel.classList.add('active');

  if (forceState === undefined) {
    const isOpen = !sidebar.classList.contains('collapsed');
    const ccActive = ccPanel && ccPanel.classList.contains('active');
    if (isOpen && ccActive) {
      sidebar.classList.add('collapsed');
    } else {
      sidebar.classList.remove('collapsed');
    }
  } else if (forceState) {
    sidebar.classList.remove('collapsed');
  } else {
    sidebar.classList.add('collapsed');
  }

  if (!sidebar.classList.contains('collapsed')) {
    const textarea = document.getElementById('cc-textarea');
    if (textarea) textarea.focus();
  }
}


function clearSession() {
  sessionId = '';
  const container = document.getElementById('cc-messages');
  if (container) container.innerHTML = '';
}


function scrollToBottom() {
  const container = document.getElementById('cc-messages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}


async function sendMessage() {
  if (isStreaming) {
    await cancelStream();
    return;
  }

  const textarea = document.getElementById('cc-textarea');
  const text = textarea.value.trim();
  if (!text) return;

  textarea.value = '';
  textarea.style.height = 'auto';

  // Show user message
  appendMessage('user', text);
  scrollToBottom();

  // Prepare request
  const payload = {
    message: text,
    session_id: sessionId,
    file_context: getContent() || '',
    file_path: getCurrentFilePath() || '',
  };

  isStreaming = true;
  updateSendButton();

  const aiEl = appendMessage('assistant', '');
  const startTime = Date.now();

  try {
    abortController = new AbortController();
    const response = await fetch('/api/claude-code/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || `Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);
          switch (event.type) {
            case 'session':
              sessionId = event.session_id;
              break;
            case 'text':
              fullText += event.content;
              renderStreamingText(aiEl, fullText);
              scrollToBottom();
              break;
            case 'tool_start':
              appendToolActivity(aiEl, event.tool, event.input);
              scrollToBottom();
              break;
            case 'error':
              appendError(aiEl, event.content);
              break;
            case 'done': {
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              finalizeMessage(aiEl, fullText, elapsed);
              break;
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      appendError(aiEl, err.message);
    }
  } finally {
    isStreaming = false;
    abortController = null;
    updateSendButton();
    scrollToBottom();
  }
}


async function cancelStream() {
  if (abortController) {
    abortController.abort();
  }
  if (sessionId) {
    fetch('/api/claude-code/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {});
  }
  isStreaming = false;
  updateSendButton();
}


function updateSendButton() {
  const btn = document.getElementById('cc-send-btn');
  if (btn) {
    btn.textContent = isStreaming ? 'Stop' : 'Send';
    btn.classList.toggle('cc-stop-btn', isStreaming);
  }
}


function appendMessage(role, content) {
  const container = document.getElementById('cc-messages');
  if (!container) return null;

  const el = document.createElement('div');
  el.className = `cc-message cc-message-${role}`;

  if (role === 'user') {
    el.textContent = content;
  }

  container.appendChild(el);
  return el;
}


let _renderTimer = null;

function renderStreamingText(el, text) {
  if (_renderTimer) return;
  _renderTimer = setTimeout(() => {
    _renderTimer = null;
    let textEl = el.querySelector('.cc-message-text');
    if (!textEl) {
      textEl = document.createElement('div');
      textEl.className = 'cc-message-text';
      el.appendChild(textEl);
    }
    textEl.innerHTML = marked.parse(text);
  }, 100);
}


function finalizeMessage(el, text, elapsed) {
  if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }

  let textEl = el.querySelector('.cc-message-text');
  if (!textEl) {
    textEl = document.createElement('div');
    textEl.className = 'cc-message-text';
    el.appendChild(textEl);
  }
  textEl.innerHTML = marked.parse(text || '');

  if (elapsed) {
    const timerEl = document.createElement('div');
    timerEl.className = 'cc-elapsed';
    timerEl.textContent = `${elapsed}s`;
    el.appendChild(timerEl);
  }
}


function appendToolActivity(messageEl, toolName, input) {
  const block = document.createElement('div');
  block.className = 'cc-tool-activity';

  const header = document.createElement('div');
  header.className = 'cc-tool-header';

  const chevron = document.createElement('span');
  chevron.className = 'cc-tool-chevron';
  chevron.textContent = '▶';

  const label = document.createElement('span');
  label.className = 'cc-tool-label';
  label.textContent = toolName;

  const summary = document.createElement('span');
  summary.className = 'cc-tool-summary';
  summary.textContent = formatToolSummary(toolName, input);

  header.appendChild(chevron);
  header.appendChild(label);
  header.appendChild(summary);

  const details = document.createElement('div');
  details.className = 'cc-tool-details hidden';
  details.textContent = JSON.stringify(input, null, 2);

  header.addEventListener('click', () => {
    details.classList.toggle('hidden');
    chevron.textContent = details.classList.contains('hidden') ? '▶' : '▼';
  });

  block.appendChild(header);
  block.appendChild(details);
  messageEl.appendChild(block);
}


function formatToolSummary(tool, input) {
  if (tool === 'Read' && input.file_path) {
    return input.file_path.split('/').pop();
  }
  if (tool === 'Bash' && input.command) {
    return input.command.length > 40 ? input.command.slice(0, 40) + '…' : input.command;
  }
  if (tool === 'Edit' && input.file_path) {
    return input.file_path.split('/').pop();
  }
  if (tool === 'Write' && input.file_path) {
    return input.file_path.split('/').pop();
  }
  if (input.query) return input.query;
  if (input.file_path) return input.file_path.split('/').pop();
  return '';
}


function appendError(el, message) {
  const errEl = document.createElement('div');
  errEl.className = 'cc-error';
  errEl.textContent = `Error: ${message}`;
  el.appendChild(errEl);
}
```

- [ ] **Step 2: Verify the module loads without syntax errors**

Run: `cd /Users/I342929/projects/SatoriLite && node --check js/claude-chat.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add js/claude-chat.js
git commit -m "feat: add Claude Code chat panel frontend module"
```

---

### Task 4: HTML — Add toolbar icon and panel container

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the Claude Code toolbar button after the existing chat button (line 65-66)**

Insert after the `btn-chat` button:

```html
        <button class="toolbar-btn" id="btn-claude-code" title="Claude Code (Cmd+Shift+K)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </button>
```

- [ ] **Step 2: Add the panel container div inside sidebar-right (after panel-chat, line 87)**

Insert after `<div class="sidebar-right-panel" id="panel-chat"></div>`:

```html
      <div class="sidebar-right-panel" id="panel-claude-code"></div>
```

- [ ] **Step 3: Add the module script import at the bottom of the body (before closing body tag)**

The app already uses ES modules via `import` in `js/app.js`, so no script tag needed — it's imported from `app.js`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Claude Code toolbar icon and panel container to HTML"
```

---

### Task 5: App.js — Wire up the init call

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Add import at the top of app.js**

Add after the `import { initShortcutsPanel }` line (line 24):

```javascript
import { initClaudeChat, toggleClaudeChat } from './claude-chat.js';
```

- [ ] **Step 2: Add initClaudeChat() call in openVault function**

Add after `initAIActions();` (line 320):

```javascript
    initClaudeChat();
```

- [ ] **Step 3: Wire the toolbar button click in openVault**

Add after the `initClaudeChat();` line:

```javascript
    // Wire Claude Code button
    const btnCC = document.getElementById('btn-claude-code');
    if (btnCC) btnCC.addEventListener('click', () => toggleClaudeChat());
```

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: wire Claude Code chat panel init in app.js"
```

---

### Task 6: CSS — Tool activity and panel styles

**Files:**
- Modify: `css/satori.css`

- [ ] **Step 1: Add Claude Code panel styles at the end of the CSS file**

Append to `css/satori.css`:

```css
/* ---------------------------------------------------------------------------
   Claude Code Chat Panel
   --------------------------------------------------------------------------- */

.cc-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.cc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

.cc-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-normal);
}

.cc-header-actions {
  display: flex;
  gap: 4px;
}

.cc-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cc-message {
  max-width: 100%;
  word-wrap: break-word;
}

.cc-message-user {
  background: rgba(198, 107, 107, 0.1);
  border: 1px solid rgba(198, 107, 107, 0.2);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-normal);
  align-self: flex-end;
  max-width: 85%;
}

.cc-message-assistant {
  font-size: 13px;
  color: var(--text-normal);
  line-height: 1.6;
}

.cc-message-assistant .cc-message-text {
  padding: 0;
}

.cc-message-assistant .cc-message-text p {
  margin: 0 0 8px 0;
}

.cc-message-assistant .cc-message-text p:last-child {
  margin-bottom: 0;
}

.cc-message-assistant .cc-message-text pre {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}

.cc-message-assistant .cc-message-text code {
  background: var(--bg-surface0);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}

.cc-message-assistant .cc-message-text pre code {
  background: none;
  padding: 0;
}

.cc-input-area {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  align-items: flex-end;
}

.cc-textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-normal);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.4;
  outline: none;
  transition: border-color 0.15s;
}

.cc-textarea:focus {
  border-color: var(--border-focus);
}

.cc-textarea::placeholder {
  color: var(--text-faint);
}

.cc-send-btn {
  flex-shrink: 0;
  padding: 6px 12px;
  font-size: 12px;
}

.cc-stop-btn {
  background: var(--color-red) !important;
  border-color: var(--color-red) !important;
}

/* Tool activity blocks */
.cc-tool-activity {
  margin: 6px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  font-size: 12px;
}

.cc-tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-tertiary);
  cursor: pointer;
  user-select: none;
}

.cc-tool-header:hover {
  background: var(--bg-surface0);
}

.cc-tool-chevron {
  font-size: 9px;
  color: var(--text-faint);
  width: 10px;
}

.cc-tool-label {
  color: var(--accent);
  font-weight: 600;
}

.cc-tool-summary {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cc-tool-details {
  padding: 8px 10px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-muted);
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.cc-tool-details.hidden {
  display: none;
}

.cc-elapsed {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 4px;
}

.cc-error {
  color: var(--color-red);
  font-size: 12px;
  padding: 6px 10px;
  background: rgba(212, 107, 107, 0.1);
  border-radius: 4px;
  margin-top: 6px;
}

.cc-clear-btn,
.cc-close-btn {
  font-size: 12px;
  padding: 2px 8px;
}

#btn-claude-code.disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Commit**

```bash
git add css/satori.css
git commit -m "feat: add Claude Code chat panel CSS styles"
```

---

### Task 7: Integration test — end-to-end smoke test

**Files:**
- Create: `server/tests/test_claude_code_integration.py`

- [ ] **Step 1: Write integration test that verifies the full flow with a mocked subprocess**

```python
# server/tests/test_claude_code_integration.py
"""Integration test for Claude Code chat endpoint with mocked subprocess."""

import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from server.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _mock_popen_stream(lines: list[str]):
    """Create a mock Popen that yields lines from stdout."""
    proc = MagicMock()
    proc.stdout = iter(lines)
    proc.stdout.readline = MagicMock(side_effect=lines + [''])
    proc.poll = MagicMock(return_value=None)
    proc.kill = MagicMock()
    proc.wait = MagicMock()
    return proc


def test_chat_streams_text_events(client):
    stream_lines = [
        '{"type":"system","subtype":"init","session_id":"test-123"}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]},"session_id":"test-123"}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":" world"}]},"session_id":"test-123"}\n',
        '{"type":"result","subtype":"success","session_id":"test-123"}\n',
    ]

    mock_proc = _mock_popen_stream(stream_lines)

    with patch("server.claude_code.check_claude_available", return_value={"available": True, "version": "2.1.0"}):
        with patch("subprocess.Popen", return_value=mock_proc):
            with patch("server.claude_code._read_line_with_timeout", side_effect=stream_lines + [None]):
                resp = client.post("/api/claude-code/chat", json={
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
    with patch("server.claude_code.check_claude_available", return_value={"available": False, "detail": "not installed"}):
        resp = client.post("/api/claude-code/chat", json={"message": "hi"})
    assert resp.status_code == 503


def test_cancel_no_active_session(client):
    resp = client.post("/api/claude-code/cancel", json={"session_id": "nonexistent"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "no_active_session"
```

- [ ] **Step 2: Run integration tests**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/test_claude_code_integration.py -v`
Expected: All PASS

- [ ] **Step 3: Run full test suite to confirm nothing is broken**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m pytest server/tests/ -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add server/tests/test_claude_code_integration.py
git commit -m "test: add integration tests for Claude Code chat endpoints"
```

---

### Task 8: Manual verification — start server and test in browser

- [ ] **Step 1: Start the server**

Run: `cd /Users/I342929/projects/SatoriLite && server/.venv/bin/python -m server --vault /path/to/your/vault --port 8000`

- [ ] **Step 2: Open in browser and verify**

Open `http://localhost:8000`, open a vault, and verify:
1. The new Claude Code icon appears in the toolbar (stacked layers icon)
2. Clicking it opens the right sidebar with "Claude Code" panel
3. Cmd+Shift+K toggles the panel
4. If Claude Code is installed, the icon is active; if not, it's grayed out
5. Sending a message streams a response with tool activity blocks
6. The "Stop" button appears during streaming
7. "Clear" resets the conversation
8. The existing AI Chat (Cmd+Shift+L) still works independently

- [ ] **Step 3: Final commit with any fixes discovered during manual test**

```bash
git add -A
git commit -m "fix: adjustments from manual testing of Claude Code integration"
```
