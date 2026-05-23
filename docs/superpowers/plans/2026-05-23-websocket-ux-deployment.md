# WebSocket Live Reload, UX Polish, Unified Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebSocket-based live reload for external file changes, breadcrumb/quick-switcher/shortcuts-panel UX features, and unify frontend+API under a single uvicorn process.

**Architecture:** The server gains a `/ws` WebSocket endpoint broadcasting file-change events (already captured by `watcher.py`). The frontend adds a `ws.js` client that triggers tree re-scans and file reloads. Three new UI modules (breadcrumb, switcher, shortcuts) are added as vanilla JS ES modules. Static file serving moves into FastAPI so one process handles everything.

**Tech Stack:** Python/FastAPI/WebSocket (server), Vanilla JS ES modules (frontend), existing CodeMirror 6 + File System Access API

---

## File Structure

| File | Responsibility |
|------|---------------|
| `server/main.py` | Add `/ws` endpoint, WebSocket broadcast task, static file mount |
| `server/__main__.py` | Change default port to 8000 |
| `server/config.py` | Update default PORT |
| `js/ws.js` | **New** — WebSocket client, reconnection, event dispatch |
| `js/breadcrumb.js` | **New** — Breadcrumb bar rendering |
| `js/switcher.js` | **New** — Quick file switcher modal (Cmd+P) |
| `js/shortcuts-panel.js` | **New** — Keyboard shortcuts modal (Cmd+/) |
| `js/app.js` | Import and init new modules |
| `js/chat.js` | Change `SERVER_URL` to relative path |
| `css/satori.css` | Add styles for new components |
| `index.html` | Add breadcrumb-bar div, connection status indicator |
| `serve.sh` | Simplify to single uvicorn command |

---

### Task 1: Unified Deployment — Static File Serving

**Files:**
- Modify: `server/main.py`
- Modify: `server/__main__.py`
- Modify: `server/config.py`
- Modify: `js/chat.js`
- Modify: `serve.sh`

- [ ] **Step 1: Update `server/config.py` — change default port**

Change line:
```python
PORT = int(os.environ.get("SATORILITE_PORT", "8787"))
```
To:
```python
PORT = int(os.environ.get("SATORILITE_PORT", "8000"))
```

- [ ] **Step 2: Update `server/__main__.py` — change default port**

Change:
```python
parser.add_argument("--port", type=int, default=int(os.environ.get("SATORILITE_PORT", "8787")),
                    help="Port to listen on (default: 8787)")
```
To:
```python
parser.add_argument("--port", type=int, default=int(os.environ.get("SATORILITE_PORT", "8000")),
                    help="Port to listen on (default: 8000)")
```

- [ ] **Step 3: Add static file serving to `server/main.py`**

Add import at top of file:
```python
from fastapi.staticfiles import StaticFiles
```

Add this block at the very end of the file (after all route definitions):
```python
# ---------------------------------------------------------------------------
# Static file serving — serves the frontend from the project root
# ---------------------------------------------------------------------------

_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)

app.mount("/", StaticFiles(directory=_PROJECT_ROOT, html=True), name="static")
```

- [ ] **Step 4: Update `js/chat.js` — use relative URLs**

Change line 4:
```javascript
const SERVER_URL = 'http://localhost:8787';
```
To:
```javascript
const SERVER_URL = '';
```

All existing fetch calls like `fetch(\`${SERVER_URL}/api/chat\`, ...)` will now resolve to `/api/chat` on the same origin.

- [ ] **Step 5: Remove CORS middleware from `server/main.py`**

Delete the CORS import and middleware block:
```python
from fastapi.middleware.cors import CORSMiddleware
```
and:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:*", "http://127.0.0.1:*", "null"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 6: Simplify `serve.sh`**

Replace entire file with:
```bash
#!/bin/sh
exec python -m server --vault "${SATORILITE_VAULT:-.}" --port 8000 --host 0.0.0.0
```

- [ ] **Step 7: Verify the server starts and serves frontend**

Run: `cd /Users/I342929/projects/SatoriLite && python -m server --vault . --port 8000`

Open `http://localhost:8000` in browser — should load the SatoriLite app. The `/api/status` endpoint should also respond.

- [ ] **Step 8: Commit**

```bash
git add server/main.py server/__main__.py server/config.py js/chat.js serve.sh
git commit -m "feat: unify frontend + API under single uvicorn process

Static files served by FastAPI. Single port (8000). CORS removed
(same-origin). serve.sh simplified to one command."
```

---

### Task 2: WebSocket Server Endpoint

**Files:**
- Modify: `server/main.py`

- [ ] **Step 1: Add WebSocket import and client set**

Add `WebSocket` and `WebSocketDisconnect` to the FastAPI import:
```python
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
```

Add after the `event_queue` definition:
```python
ws_clients: set[WebSocket] = set()
```

- [ ] **Step 2: Add WebSocket broadcast task**

Replace the existing `_process_events` function with a version that both processes indexing AND broadcasts to WebSocket clients:

```python
async def _process_events():
    while True:
        message = await event_queue.get()
        try:
            # Broadcast raw event to all WebSocket clients
            dead: set[WebSocket] = set()
            for ws in ws_clients:
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.add(ws)
            ws_clients.difference_update(dead)

            # Process for indexing
            event = json.loads(message)
            path = event.get("path", "")
            event_type = event.get("type", "")

            if not path.endswith(".md"):
                continue

            # Notify clients that indexing started
            indexing_busy = json.dumps({"type": "indexing", "status": "busy", "path": path})
            for ws in ws_clients:
                try:
                    await ws.send_text(indexing_busy)
                except Exception:
                    pass

            if event_type in ("created", "modified"):
                try:
                    content = Path(path).read_text(encoding="utf-8")
                    await asyncio.to_thread(reindex_file, _get_index_dir(), path, content)
                    fts_index_file("default", path, content)
                    await asyncio.to_thread(_rebuild_link_graph)
                    logger.info("Reindexed: %s", path)
                except (OSError, UnicodeDecodeError) as e:
                    logger.warning("Failed to reindex %s: %s", path, e)
            elif event_type == "deleted":
                await asyncio.to_thread(remove_file_from_index, _get_index_dir(), path)
                remove_from_fts("default", path)
                await asyncio.to_thread(_rebuild_link_graph)
                logger.info("Removed from index: %s", path)

            # Notify clients that indexing finished
            indexing_done = json.dumps({"type": "indexing", "status": "done", "path": path})
            for ws in ws_clients:
                try:
                    await ws.send_text(indexing_done)
                except Exception:
                    pass

        except Exception as e:
            logger.warning("Error processing event: %s", e)
```

- [ ] **Step 3: Add the `/ws` WebSocket endpoint**

Add before the static file mount (before the `app.mount("/", ...)` line):

```python
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    ws_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(websocket)
```

- [ ] **Step 4: Verify WebSocket works**

Start server, then test with:
```bash
python -c "
import asyncio, websockets
async def test():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        print('Connected to /ws')
        await asyncio.sleep(2)
        print('OK')
asyncio.run(test())
"
```

Expected: Prints "Connected to /ws" and "OK" without errors.

- [ ] **Step 5: Commit**

```bash
git add server/main.py
git commit -m "feat: add WebSocket endpoint for live file-change broadcast

Watcher events are broadcast to all connected WS clients. Indexing
status (busy/done) also pushed so frontend can show progress."
```

---

### Task 3: WebSocket Client (`js/ws.js`)

**Files:**
- Create: `js/ws.js`
- Modify: `js/app.js`
- Modify: `index.html`
- Modify: `css/satori.css`

- [ ] **Step 1: Create `js/ws.js`**

```javascript
import { scanDirectory } from './fs.js';
import { getVaultTree, getCurrentVaultName } from './app.js';
import { getCurrentFilePath, openFile } from './editor.js';
import { getRootHandle } from './fs.js';

let socket = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let treeRefreshTimer = null;
let fileReloadTimers = new Map();

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 30000;
const TREE_DEBOUNCE_MS = 300;
const FILE_RELOAD_DEBOUNCE_MS = 500;

export function initWebSocket() {
  connect();
}

export function disconnectWebSocket() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempts = 0;
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  setStatus(false);
}

function setStatus(connected) {
  const dot = document.getElementById('ws-status-dot');
  if (dot) {
    dot.classList.toggle('connected', connected);
    dot.title = connected ? 'Live reload connected' : 'Live reload disconnected';
  }
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;

  try {
    socket = new WebSocket(url);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectAttempts = 0;
    setStatus(true);
  };

  socket.onmessage = (event) => {
    handleMessage(event.data);
  };

  socket.onclose = () => {
    setStatus(false);
    scheduleReconnect();
  };

  socket.onerror = () => {
    setStatus(false);
  };
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
  const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), MAX_BACKOFF_MS);
  reconnectAttempts++;
  reconnectTimer = setTimeout(connect, delay);
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    return;
  }

  const { type, path, isDirectory, status } = msg;

  if (type === 'indexing') {
    const dot = document.getElementById('ws-status-dot');
    if (dot) {
      dot.classList.toggle('indexing', status === 'busy');
    }
    return;
  }

  switch (type) {
    case 'created':
    case 'deleted':
    case 'moved':
      debouncedTreeRefresh();
      break;
    case 'modified':
      if (!isDirectory) {
        debouncedTreeRefresh();
        debouncedFileReload(path);
      }
      break;
  }
}

function debouncedTreeRefresh() {
  clearTimeout(treeRefreshTimer);
  treeRefreshTimer = setTimeout(async () => {
    const rootHandle = getRootHandle();
    if (rootHandle) {
      window.dispatchEvent(new CustomEvent('satorilite:tree-refresh'));
    }
  }, TREE_DEBOUNCE_MS);
}

function debouncedFileReload(changedPath) {
  const currentPath = getCurrentFilePath();
  if (!currentPath) return;

  // The watcher sends absolute paths; currentPath is relative.
  // Match if the absolute path ends with the relative path.
  if (!changedPath.endsWith(currentPath)) return;

  if (fileReloadTimers.has(currentPath)) {
    clearTimeout(fileReloadTimers.get(currentPath));
  }

  const timer = setTimeout(() => {
    fileReloadTimers.delete(currentPath);
    if (getCurrentFilePath() === currentPath) {
      openFile(currentPath);
    }
  }, FILE_RELOAD_DEBOUNCE_MS);

  fileReloadTimers.set(currentPath, timer);
}
```

- [ ] **Step 2: Add WebSocket status dot to `index.html`**

In the status bar left section (line 89-91 of `index.html`), add the dot:

Change:
```html
      <div class="status-bar-left">
        <span class="status-item" id="status-path"></span>
      </div>
```
To:
```html
      <div class="status-bar-left">
        <span class="ws-status-dot" id="ws-status-dot" title="Live reload disconnected"></span>
        <span class="status-item" id="status-path"></span>
      </div>
```

- [ ] **Step 3: Add CSS for the WebSocket status dot**

Append to end of `css/satori.css`:
```css

/* WebSocket status dot */
.ws-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  opacity: 0.4;
  margin-right: 6px;
  transition: background 0.3s, opacity 0.3s;
}
.ws-status-dot.connected {
  background: var(--green, #a6e3a1);
  opacity: 1;
}
.ws-status-dot.indexing {
  background: var(--yellow, #f9e2af);
  opacity: 1;
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

- [ ] **Step 4: Wire up in `js/app.js`**

Add import at top:
```javascript
import { initWebSocket, disconnectWebSocket } from './ws.js';
```

Add `initWebSocket()` call inside `openVault()`, after `initAIActions()` (line 222):
```javascript
    initWebSocket();
```

- [ ] **Step 5: Verify live reload works**

1. Start server: `python -m server --vault /path/to/test-vault --port 8000`
2. Open `http://localhost:8000` — green dot should appear in status bar.
3. Edit a `.md` file externally (e.g., `echo "# test" >> /path/to/test-vault/notes/test.md`)
4. Tree should refresh and if that file is open, content should reload.

- [ ] **Step 6: Commit**

```bash
git add js/ws.js js/app.js index.html css/satori.css
git commit -m "feat: add WebSocket client for live file-change reload

Green dot in status bar shows connection state. External edits
trigger tree refresh and file reload with debouncing."
```

---

### Task 4: Breadcrumb Bar (`js/breadcrumb.js`)

**Files:**
- Create: `js/breadcrumb.js`
- Modify: `index.html`
- Modify: `css/satori.css`
- Modify: `js/app.js`

- [ ] **Step 1: Add breadcrumb-bar div to `index.html`**

Insert after the tab-bar div (line 65) and before the editor-content div (line 66):

Change:
```html
      <div class="tab-bar" id="tab-bar"></div>
      <div class="editor-content mode-split">
```
To:
```html
      <div class="tab-bar" id="tab-bar"></div>
      <div class="breadcrumb-bar" id="breadcrumb-bar"></div>
      <div class="editor-content mode-split">
```

- [ ] **Step 2: Create `js/breadcrumb.js`**

```javascript
import { getCurrentVaultName } from './app.js';
import { getCurrentFilePath } from './editor.js';

let bar = null;

export function initBreadcrumb() {
  bar = document.getElementById('breadcrumb-bar');
  if (!bar) return;

  window.addEventListener('satorilite:file-loaded', (e) => {
    render(e.detail.path);
  });

  window.addEventListener('satorilite:content-changed', (e) => {
    if (e.detail.path) {
      render(e.detail.path);
    }
  });
}

function render(filePath) {
  if (!bar) return;
  bar.textContent = '';
  if (!filePath) return;

  const vaultName = getCurrentVaultName();
  const parts = filePath.split('/');
  const segments = vaultName ? [vaultName, ...parts] : parts;

  segments.forEach((seg, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-separator';
      sep.textContent = '›';
      bar.appendChild(sep);
    }

    const el = document.createElement('span');
    el.className = 'breadcrumb-segment';
    if (i === segments.length - 1) {
      el.classList.add('current');
    } else {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const folderName = seg;
        const allFolders = document.querySelectorAll('.tree-folder-name, .tree-item-label');
        for (const folder of allFolders) {
          if (folder.textContent === folderName) {
            folder.closest('.tree-item, .tree-folder')?.click();
            folder.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            break;
          }
        }
      });
    }
    el.textContent = seg;
    bar.appendChild(el);
  });
}
```

- [ ] **Step 3: Add breadcrumb CSS**

Append to `css/satori.css`:
```css

/* Breadcrumb bar */
.breadcrumb-bar {
  display: flex;
  align-items: center;
  padding: 2px 12px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-primary);
  min-height: 20px;
  gap: 2px;
  overflow: hidden;
  white-space: nowrap;
}
.breadcrumb-bar:empty {
  display: none;
}
.breadcrumb-segment {
  color: var(--text-muted);
  padding: 1px 3px;
  border-radius: 3px;
}
.breadcrumb-segment:hover {
  color: var(--text-primary);
  background: var(--bg-hover, rgba(255,255,255,0.05));
}
.breadcrumb-segment.current {
  color: var(--text-primary);
  font-weight: 500;
}
.breadcrumb-segment.current:hover {
  background: none;
  cursor: default;
}
.breadcrumb-separator {
  color: var(--text-muted);
  opacity: 0.5;
  margin: 0 1px;
}
```

- [ ] **Step 4: Wire up in `js/app.js`**

Add import:
```javascript
import { initBreadcrumb } from './breadcrumb.js';
```

Add `initBreadcrumb()` call inside `openVault()`, after `initTabs()` (around line 214):
```javascript
    initBreadcrumb();
```

- [ ] **Step 5: Verify breadcrumb renders**

Open a file in the app. The breadcrumb should show `VaultName › folder › file.md` between the tab bar and the editor.

- [ ] **Step 6: Commit**

```bash
git add js/breadcrumb.js index.html css/satori.css js/app.js
git commit -m "feat: add breadcrumb bar showing file path below tab bar"
```

---

### Task 5: Quick Switcher (`js/switcher.js`)

**Files:**
- Create: `js/switcher.js`
- Modify: `css/satori.css`
- Modify: `js/app.js`

- [ ] **Step 1: Create `js/switcher.js`**

```javascript
import { getVaultTree } from './app.js';

let modal = null;
let input = null;
let resultsList = null;
let files = [];
let filteredFiles = [];
let selectedIndex = 0;

function flattenTree(tree, prefix = '') {
  const result = [];
  if (!tree) return result;
  for (const node of tree) {
    const nodePath = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.kind === 'file') {
      result.push({ name: node.name, path: node.path || nodePath, relativePath: nodePath });
    } else if (node.kind === 'directory' && node.children) {
      result.push(...flattenTree(node.children, nodePath));
    }
  }
  return result;
}

function fuzzyMatch(query, target) {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const indices = [];
  let qi = 0;
  for (let ti = 0; ti < lowerTarget.length && qi < lowerQuery.length; ti++) {
    if (lowerTarget[ti] === lowerQuery[qi]) {
      indices.push(ti);
      qi++;
    }
  }
  return qi === lowerQuery.length ? indices : null;
}

function highlightMatches(name, indices) {
  const set = new Set(indices);
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < name.length; i++) {
    if (set.has(i)) {
      const span = document.createElement('span');
      span.className = 'switcher-highlight';
      span.textContent = name[i];
      fragment.appendChild(span);
    } else {
      fragment.appendChild(document.createTextNode(name[i]));
    }
  }
  return fragment;
}

function filterAndRender() {
  const query = input.value.trim();
  if (!query) {
    filteredFiles = files.map(f => ({ ...f, matchIndices: null }));
  } else {
    filteredFiles = [];
    for (const file of files) {
      const indices = fuzzyMatch(query, file.name);
      if (indices) {
        filteredFiles.push({ ...file, matchIndices: indices });
      }
    }
  }
  selectedIndex = 0;
  renderResults();
}

function renderResults() {
  resultsList.replaceChildren();
  const maxShow = 20;
  const toShow = filteredFiles.slice(0, maxShow);
  for (let i = 0; i < toShow.length; i++) {
    const file = toShow[i];
    const div = document.createElement('div');
    div.className = 'switcher-result' + (i === selectedIndex ? ' selected' : '');

    const nameEl = document.createElement('div');
    nameEl.className = 'switcher-result-name';
    if (file.matchIndices) {
      nameEl.appendChild(highlightMatches(file.name, file.matchIndices));
    } else {
      nameEl.textContent = file.name;
    }

    const pathEl = document.createElement('div');
    pathEl.className = 'switcher-result-path';
    pathEl.textContent = file.relativePath;

    div.appendChild(nameEl);
    div.appendChild(pathEl);
    div.addEventListener('click', () => openSelected(i));
    resultsList.appendChild(div);
  }
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  const selected = resultsList.querySelector('.switcher-result.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

function openSelected(index) {
  const file = filteredFiles[index];
  if (!file) return;
  window.dispatchEvent(new CustomEvent('satorilite:file-open', { detail: { path: file.path } }));
  closeSwitcher();
}

function openSwitcher() {
  if (!modal) return;
  files = flattenTree(getVaultTree());
  filteredFiles = files.map(f => ({ ...f, matchIndices: null }));
  selectedIndex = 0;
  modal.classList.remove('hidden');
  input.value = '';
  renderResults();
  input.focus();
}

function closeSwitcher() {
  if (!modal) return;
  modal.classList.add('hidden');
  input.value = '';
}

export function initSwitcher() {
  if (modal) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'switcher-backdrop hidden';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSwitcher();
  });

  const modalEl = document.createElement('div');
  modalEl.className = 'switcher-modal';

  const inputEl = document.createElement('input');
  inputEl.className = 'switcher-input';
  inputEl.type = 'text';
  inputEl.placeholder = 'Quick open file...';
  inputEl.addEventListener('input', filterAndRender);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectedIndex < filteredFiles.length - 1) { selectedIndex++; renderResults(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectedIndex > 0) { selectedIndex--; renderResults(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelected(selectedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSwitcher();
    }
  });

  const resultsEl = document.createElement('div');
  resultsEl.className = 'switcher-results';

  modalEl.appendChild(inputEl);
  modalEl.appendChild(resultsEl);
  backdrop.appendChild(modalEl);
  document.body.appendChild(backdrop);

  modal = backdrop;
  input = inputEl;
  resultsList = resultsEl;

  document.addEventListener('keydown', (e) => {
    const modifier = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
    if (modifier && e.key === 'p') {
      e.preventDefault();
      if (getVaultTree()) openSwitcher();
    }
  });
}
```

- [ ] **Step 2: Add switcher CSS**

Append to `css/satori.css`:
```css

/* Quick Switcher */
.switcher-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 20vh;
  z-index: 9999;
}
.switcher-backdrop.hidden {
  display: none;
}
.switcher-modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  width: 500px;
  max-width: 90vw;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.switcher-input {
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}
.switcher-input:focus {
  background: var(--bg-primary);
}
.switcher-results {
  max-height: 300px;
  overflow-y: auto;
}
.switcher-result {
  padding: 8px 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.switcher-result:hover {
  background: rgba(137, 180, 250, 0.08);
}
.switcher-result.selected {
  background: rgba(137, 180, 250, 0.15);
}
.switcher-result-name {
  font-size: 13px;
  color: var(--text-primary);
}
.switcher-result-path {
  font-size: 11px;
  color: var(--text-muted);
}
.switcher-highlight {
  color: var(--accent-primary);
  font-weight: 600;
}
```

- [ ] **Step 3: Wire up in `js/app.js`**

Add import:
```javascript
import { initSwitcher } from './switcher.js';
```

Add `initSwitcher()` call in the global init section at the bottom of the file (alongside `initCommandPalette()` and `initTree()`, before `init()`):
```javascript
initSwitcher();
```

- [ ] **Step 4: Verify quick switcher works**

Open a vault, press Cmd+P. The modal should appear with a list of all `.md` files. Type a filename — fuzzy matching should filter the list. Arrow keys navigate, Enter opens, Escape closes.

- [ ] **Step 5: Commit**

```bash
git add js/switcher.js css/satori.css js/app.js
git commit -m "feat: add quick file switcher (Cmd+P) with fuzzy matching"
```

---

### Task 6: Shortcuts Panel (`js/shortcuts-panel.js`)

**Files:**
- Create: `js/shortcuts-panel.js`
- Modify: `css/satori.css`
- Modify: `js/app.js`

- [ ] **Step 1: Create `js/shortcuts-panel.js`**

```javascript
let backdrop = null;
let modal = null;

const isMac = navigator.platform.includes('Mac');
const mod = isMac ? '⌘' : 'Ctrl';

const shortcuts = [
  { keys: `${mod}+K`, action: 'Command palette' },
  { keys: `${mod}+P`, action: 'Quick switcher' },
  { keys: `${mod}+S`, action: 'Save file' },
  { keys: `${mod}+B`, action: 'Toggle sidebar' },
  { keys: `${mod}+Shift+F`, action: 'Search vault' },
  { keys: `${mod}+F`, action: 'Find in file' },
  { keys: `${mod}+H`, action: 'Find & replace' },
  { keys: `${mod}+Shift+E`, action: 'Editor mode' },
  { keys: `${mod}+Shift+P`, action: 'Preview mode' },
  { keys: `${mod}+Shift+S`, action: 'Split mode' },
  { keys: `${mod}+Shift+L`, action: 'AI Chat' },
  { keys: `${mod}+Shift+O`, action: 'Table of Contents' },
  { keys: `${mod}+/`, action: 'Keyboard shortcuts' },
  { keys: 'Escape', action: 'Close panel' },
];

function show() {
  backdrop.classList.remove('hidden');
  modal.focus();
}

function hide() {
  backdrop.classList.add('hidden');
}

function toggle() {
  if (backdrop.classList.contains('hidden')) show();
  else hide();
}

export function initShortcutsPanel() {
  backdrop = document.createElement('div');
  backdrop.className = 'shortcuts-backdrop hidden';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hide();
  });

  modal = document.createElement('div');
  modal.className = 'shortcuts-modal';
  modal.tabIndex = -1;

  const title = document.createElement('h3');
  title.textContent = 'Keyboard Shortcuts';
  modal.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'shortcuts-grid';

  for (const s of shortcuts) {
    const keyEl = document.createElement('span');
    keyEl.className = 'shortcuts-keys';
    const parts = s.keys.split('+');
    for (let i = 0; i < parts.length; i++) {
      const kbd = document.createElement('kbd');
      kbd.textContent = parts[i];
      keyEl.appendChild(kbd);
      if (i < parts.length - 1) {
        keyEl.appendChild(document.createTextNode(' + '));
      }
    }
    grid.appendChild(keyEl);

    const desc = document.createElement('span');
    desc.className = 'shortcuts-action';
    desc.textContent = s.action;
    grid.appendChild(desc);
  }

  modal.appendChild(grid);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); hide(); }
  });

  document.addEventListener('keydown', (e) => {
    const modifier = isMac ? e.metaKey : e.ctrlKey;
    if (modifier && e.key === '/') {
      e.preventDefault();
      toggle();
    }
  });
}
```

- [ ] **Step 2: Add shortcuts panel CSS**

Append to `css/satori.css`:
```css

/* Shortcuts panel */
.shortcuts-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}
.shortcuts-backdrop.hidden {
  display: none;
}
.shortcuts-modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 24px;
  width: 420px;
  max-width: 90vw;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  outline: none;
}
.shortcuts-modal h3 {
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.shortcuts-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  align-items: center;
}
.shortcuts-keys {
  display: flex;
  align-items: center;
  gap: 4px;
}
.shortcuts-keys kbd {
  display: inline-block;
  padding: 2px 6px;
  font-size: 11px;
  font-family: inherit;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  color: var(--text-primary);
}
.shortcuts-action {
  font-size: 13px;
  color: var(--text-muted);
}
```

- [ ] **Step 3: Wire up in `js/app.js`**

Add import:
```javascript
import { initShortcutsPanel } from './shortcuts-panel.js';
```

Add `initShortcutsPanel()` call in the global init section at the bottom of the file (alongside `initSwitcher()`, before `init()`):
```javascript
initShortcutsPanel();
```

- [ ] **Step 4: Verify shortcuts panel works**

Press Cmd+/ — modal should appear showing all keyboard shortcuts. Press Escape or click outside to close.

- [ ] **Step 5: Commit**

```bash
git add js/shortcuts-panel.js css/satori.css js/app.js
git commit -m "feat: add keyboard shortcuts panel (Cmd+/)"
```

---

### Task 7: Final Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Full end-to-end test**

1. Start: `cd /Users/I342929/projects/SatoriLite && python -m server --vault ~/path/to/test-vault --port 8000`
2. Open `http://localhost:8000`
3. Verify: Vault chooser appears, open a folder
4. Verify: Green WebSocket dot in status bar
5. Verify: Breadcrumb shows `VaultName › file.md`
6. Verify: Cmd+P opens quick switcher, fuzzy search works, Enter opens file
7. Verify: Cmd+/ opens shortcuts panel
8. Verify: Edit a file externally → tree refreshes, open file reloads
9. Verify: AI Chat still works (all `/api/*` calls use relative URLs)

- [ ] **Step 2: Test graceful degradation**

1. Open `index.html` directly (no server) via another local HTTP server or File System Access
2. Verify: Editing works, WebSocket dot is grey (not connected), no JS errors in console
3. Verify: AI Chat shows offline state (expected — no server)

- [ ] **Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: integration fixups from end-to-end testing"
```
