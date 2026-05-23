# SatoriLite: WebSocket Live Reload, UX Polish, Unified Deployment

**Date:** 2026-05-23
**Status:** Approved

## Overview

Three features ported/adapted from Satori to close the UX gap while preserving SatoriLite's offline-first architecture:

1. WebSocket live reload for external file changes
2. Breadcrumb, quick switcher, and keyboard shortcuts panel
3. Single uvicorn command serves frontend + API

## 1. WebSocket Live Reload

### Server Side

Add a `/ws` WebSocket endpoint to `server/main.py`:

- Maintain a set of connected WebSocket clients.
- Background task reads from the existing `event_queue` (fed by `watcher.py`) and broadcasts JSON messages to all clients.
- Message format: `{"type": "created|modified|deleted|moved", "path": "<relative-path>", "isDirectory": bool}`
- Indexing status messages: `{"type": "indexing", "status": "busy|done", "path": "<file>"}`
- Bounded queue (existing 1000-item limit) prevents memory growth.
- Dead client cleanup on send failure.

### Client Side

New module: `js/ws.js`

- Connects to `ws://<host>/ws` on app startup (only if server is reachable).
- **On `created`/`deleted`/`moved`:** Debounced (300ms) re-scan of the vault directory via `scanDirectory()` from `fs.js`, then re-render tree.
- **On `modified`:** Debounced (500ms) reload of the file if it's currently open in the editor. Check `getCurrentFilePath()` before reloading.
- **On `indexing`:** Update status bar indicator (dot + text).
- **Reconnection:** Exponential backoff, max 10 attempts, max 30s delay.
- **Graceful degradation:** If server is unreachable or WebSocket fails, editing works normally. No error UI — just a disconnected status dot in the status bar.

### Integration

- `app.js` calls `initWebSocket()` after vault is opened.
- `disconnectWebSocket()` called on vault switch.
- Status bar shows connection state (green dot = connected, no dot = disconnected/no server).

## 2. UI Polish: Breadcrumb, Quick Switcher, Shortcuts Panel

### 2a. Breadcrumb Bar

New module: `js/breadcrumb.js`

- Rendered between the tab bar and editor content area.
- Format: `VaultName › folder › subfolder › file.md`
- Path derived from the currently open file path (already in editor state).
- Clicking a non-terminal segment finds and expands that folder in the tree sidebar.
- Listens to `satorilite:file-opened` and `satorilite:tab-switch` custom events.
- No server dependency — vault name from `getCurrentVaultName()`, path from editor state.

**DOM location:** New `<div class="breadcrumb-bar" id="breadcrumb-bar"></div>` inserted after the tab bar, before `.editor-content`.

### 2b. Quick Switcher (Cmd+P)

New module: `js/switcher.js`

- Modal overlay (backdrop + modal container + input + results list).
- **Data source:** Flattens the in-memory file tree (from `getVaultTree()` in `app.js`) into a flat list of `{name, path}` objects.
- **Fuzzy matching:** Character-by-character subsequence match (same algorithm as Satori's implementation).
- **UI:** Highlighted match characters, filename + relative path display.
- **Keyboard:** Arrow up/down to navigate, Enter to open, Escape to close.
- **Trigger:** `Cmd+P` (Mac) / `Ctrl+P` (other).
- **Open file:** Dispatches `satorilite:file-open` custom event with the selected path.

### 2c. Shortcuts Panel (Cmd+/)

New module: `js/shortcuts-panel.js`

- Modal overlay with a grid of keyboard shortcuts.
- Static data — no dynamic behavior.
- Shortcuts listed:
  - `Cmd+K` — Command palette
  - `Cmd+S` — Save file
  - `Cmd+P` — Quick switcher
  - `Cmd+Shift+F` — Search vault
  - `Cmd+F` — Find in file
  - `Cmd+H` — Find & replace
  - `Cmd+Shift+E` — Editor mode
  - `Cmd+Shift+P` — Preview mode
  - `Cmd+Shift+S` — Split mode
  - `Cmd+Shift+L` — AI Chat
  - `Cmd+Shift+O` — Table of Contents
  - `Cmd+/` — Keyboard shortcuts
  - `Cmd+B` — Toggle sidebar
  - `Escape` — Close panel
- **Trigger:** `Cmd+/` (Mac) / `Ctrl+/` (other).

### CSS

Add styles for all three components to `css/satori.css`:
- `.breadcrumb-bar` — horizontal bar, small text, muted separators
- `.switcher-backdrop`, `.switcher-modal`, `.switcher-input`, `.switcher-results`, `.switcher-result`, `.switcher-highlight` — modal overlay with search
- `.shortcuts-backdrop`, `.shortcuts-modal`, `.shortcuts-grid`, `.shortcuts-keys kbd`, `.shortcuts-action` — modal overlay with grid

Style approach: Port CSS from Satori's `satori.css` (lines 313-334, 1645-1722, 2332-2435), adapting variable names if needed.

## 3. Unified uvicorn Deployment

### Changes to `server/main.py`

- Compute `FRONTEND_DIR` as the project root (parent of `server/` directory).
- Mount static files: `app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")`
- The `html=True` parameter makes it serve `index.html` for `/` automatically.
- API routes (`/api/*`, `/ws`) are registered before the static mount, so they take priority.

### Changes to `serve.sh`

Replace the two-process script with:
```bash
#!/bin/sh
exec uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Or with vault argument:
```bash
#!/bin/sh
exec python -m server --vault "${SATORILITE_VAULT:-.}" --port 8000 --host 0.0.0.0
```

### Changes to `server/__main__.py`

- Default port changes from 8787 to 8000.
- Add static file mounting logic (or keep it in main.py and just change the port default).

### CORS Removal

Since frontend and API are now same-origin, the CORS middleware can be removed from `main.py`. Keep it conditionally for development scenarios where someone might still run them separately.

### Frontend URL Changes

- `js/chat.js` and `js/ai-actions.js` currently call the RAG server at `http://localhost:8787/api/*`.
- Change all API calls to use relative URLs (`/api/*`) — same origin, no port needed.
- WebSocket URL: `ws://${window.location.host}/ws`

## File Changes Summary

| File | Action |
|------|--------|
| `server/main.py` | Add `/ws` endpoint, add static file mount, remove CORS |
| `server/__main__.py` | Change default port to 8000 |
| `server/config.py` | Update default PORT to 8000 |
| `js/ws.js` | New — WebSocket client |
| `js/breadcrumb.js` | New — breadcrumb bar |
| `js/switcher.js` | New — quick file switcher |
| `js/shortcuts-panel.js` | New — keyboard shortcuts modal |
| `js/app.js` | Import and init new modules |
| `js/chat.js` | Change API URLs to relative |
| `js/ai-actions.js` | Change API URLs to relative |
| `css/satori.css` | Add styles for breadcrumb, switcher, shortcuts |
| `index.html` | Add breadcrumb-bar div |
| `serve.sh` | Simplify to single uvicorn command |

## Non-Goals

- No changes to File System Access API usage
- No changes to Service Worker or offline caching
- No server-side file read/write API
- No Firefox/Safari support changes
- No changes to the RAG pipeline, search, or AI features
