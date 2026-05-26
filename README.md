# SatoriLite

A lightweight, offline-first markdown editor and knowledge base with AI-powered RAG search. Built for developers who want Obsidian-like features without the Electron overhead — runs entirely in the browser with a Python backend for semantic search.

## Features

### Editor
- **CodeMirror 6** — full-featured markdown editor with syntax highlighting, line numbers, code folding
- **Live preview** — inline rendering of headings, bold, italic, links, and code blocks directly in the editor
- **Split view** — side-by-side editor and rendered preview with synchronized scrolling
- **Three view modes** — Editor only, Preview only, or Split (toggle with keyboard shortcuts)
- **Auto-save** — files saved to disk automatically with 1-second debounce
- **Tabs** — multiple files open simultaneously with tab bar

### Knowledge Base
- **File tree sidebar** — browse vault contents with expand/collapse directories
- **Multi-vault support** — register multiple vaults, switch between them instantly
- **Quick switcher** — fuzzy file search (`Cmd+P`)
- **Command palette** — access all actions from keyboard (`Cmd+K`)
- **Full-text search** — instant vault-wide search (`Cmd+Shift+F`) powered by MiniSearch
- **Link autocomplete** — type `[` to fuzzy-search and insert inter-note links
- **Link preview** — hover over `[[wikilinks]]` to see note content inline
- **Backlinks** — see which notes link to the current file
- **Table of contents** — auto-generated from headings in the right sidebar
- **Breadcrumb navigation** — see your current location in the vault hierarchy

### AI-Powered Search (RAG)
- **Semantic search** — find notes by meaning, not just keywords
- **Hybrid retrieval** — combines vector similarity (FAISS), full-text search (BM25), and link-graph expansion with Reciprocal Rank Fusion
- **HyDE** — Hypothetical Document Embeddings for better query-to-document matching
- **LLM reranking** — Claude reranks candidates for relevance before presenting results
- **Fan-out search** — queries all registered vaults simultaneously
- **AI chat** — ask questions about your notes with streamed responses grounded in retrieved context
- **AI actions** — summarize, explain, or ask questions about selected text

### Live Reload
- **File watcher** — server monitors vault directory for changes (watchdog)
- **WebSocket push** — file tree and content update in real-time when files change externally
- **Incremental indexing** — new/modified files are indexed automatically within ~1 second
- **Link graph rebuild** — relationships between notes stay up-to-date

### Design
- **8 themes** — Catppuccin Mocha, Catppuccin Macchiato, Catppuccin Frappe, Tokyo Night, Nord, Gruvbox Dark, Rose Pine, Tactical
- **Mermaid diagrams** — rendered inline in preview
- **KaTeX math** — LaTeX equations rendered in preview
- **PWA** — installable, works offline (editor features without server)
- **Resizable panels** — drag to resize sidebar and editor/preview split

## Architecture

```
SatoriLite/
├── index.html              Entry point (PWA shell)
├── manifest.json           PWA manifest
├── sw.js                   Service Worker for offline caching
├── serve.sh                Launch script
├── css/
│   └── satori.css          Themes, layout, all styling (2200 lines)
├── js/
│   ├── app.js              App initialization, vault management
│   ├── editor.js           CodeMirror 6 setup, file open/save
│   ├── renderer.js         Markdown → HTML (marked.js + mermaid + KaTeX)
│   ├── fs.js               File System Access API abstraction
│   ├── tree.js             File tree sidebar component
│   ├── chat.js             AI chat panel (streaming responses)
│   ├── search.js           Client-side full-text search (MiniSearch)
│   ├── rag.js              RAG search UI (fan-out across vaults)
│   ├── ws.js               WebSocket client (live reload)
│   ├── sync-scroll.js      Synchronized editor/preview scrolling
│   ├── link-complete.js    [[wikilink]] autocomplete
│   ├── link-preview.js     Hover preview for links
│   ├── backlinks.js        Backlinks panel
│   ├── toc.js              Table of contents panel
│   ├── tabs.js             Tab bar for open files
│   ├── file-ops.js         Move, rename, delete operations
│   ├── switcher.js         Quick file switcher (Cmd+P)
│   ├── command-palette.js  Command palette (Cmd+K)
│   ├── themes.js           Theme definitions and switcher
│   ├── breadcrumb.js       Breadcrumb navigation
│   ├── live-preview.js     Inline markdown decorations
│   ├── viewmode.js         Editor/Preview/Split toggle
│   ├── vault-db.js         IndexedDB for vault persistence
│   ├── shortcuts-panel.js  Keyboard shortcuts overlay
│   ├── ai-actions.js       Context menu AI actions
│   ├── resize.js           Draggable panel resizers
│   └── status-bar.js       Bottom status bar
├── lib/
│   ├── codemirror-bundle.js  Pre-bundled CodeMirror 6
│   ├── marked.js             Markdown parser
│   └── minisearch.js         Client-side search engine
└── server/
    ├── main.py             FastAPI app, WebSocket, event processing
    ├── indexer.py          FAISS vector index, chunking, embeddings
    ├── fts.py              Full-text search (BM25 scoring)
    ├── rag.py              RAG pipeline (HyDE, RRF fusion, reranking)
    ├── graph.py            Link graph builder and traversal
    ├── watcher.py          Filesystem watcher (watchdog → WebSocket)
    ├── registry.py         Multi-vault registry (~/.satorilite/)
    ├── generate.py         LLM text generation (streaming)
    ├── config.py           Configuration and defaults
    └── tests/              Unit tests
```

## How It Works

### Frontend (Browser)

The frontend is a vanilla JavaScript PWA — no build step, no framework. It uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) to read and write real `.md` files on disk. This means your notes are always plain files, accessible by git, Obsidian, vim, or any other tool.

Dependencies are pre-bundled in `lib/` for offline-first operation. The Service Worker caches all assets so the editor works without network on subsequent visits.

### Backend (Python)

The server provides AI-powered features that can't run in the browser:

1. **Embedding** — files are chunked and embedded via Amazon Bedrock (Titan Embed v2, 1024 dimensions)
2. **Vector search** — FAISS index for semantic similarity
3. **Full-text search** — custom BM25 implementation for keyword matching
4. **Link graph** — bidirectional link graph with multi-hop expansion
5. **RAG pipeline** — HyDE query expansion → hybrid retrieval → RRF fusion → LLM reranking → context assembly
6. **Chat** — Claude generates answers grounded in retrieved note context
7. **Live reload** — watchdog monitors files, pushes changes via WebSocket

The server is optional — the editor works standalone for reading/writing/searching notes. The server adds semantic search and AI chat.

## Prerequisites

- **Browser:** Chromium-based (Chrome, Edge, Arc, Brave) — required for File System Access API
- **Python 3.11+** — for the server
- **AWS credentials** — configured for Amazon Bedrock access (embeddings + LLM)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/vamsikrishnav/SatoriLite.git
cd SatoriLite
```

### 2. Install server dependencies

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Configure AWS credentials

The server uses Amazon Bedrock for embeddings (Titan Embed v2) and LLM responses (Claude). Ensure your AWS credentials are configured:

```bash
aws configure
# Or set environment variables:
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

### 4. Start the server

```bash
# From the project root:
./serve.sh

# Or manually:
uvicorn server.main:app --port 8000
```

### 5. Open in browser

Navigate to `http://localhost:8000`. Click "Open Folder" to select a directory containing your markdown files.

## Configuration

Environment variables (set in shell or in `<vault>/.satorilite/.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `SATORILITE_VAULT` | `.` | Default vault path |
| `SATORILITE_PORT` | `8000` | Server port |
| `AWS_REGION` | `us-east-1` | AWS region for Bedrock |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-opus-4-6-v1` | Model for chat |
| `BEDROCK_RAG_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Model for RAG (HyDE + reranking) |
| `BEDROCK_EMBED_MODEL` | `amazon.titan-embed-text-v2:0` | Embedding model |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Command palette |
| `Cmd+P` | Quick file switcher |
| `Cmd+S` | Save file |
| `Cmd+B` | Toggle sidebar |
| `Cmd+Shift+F` | Search vault |
| `Cmd+F` | Find in file |
| `Cmd+H` | Find & replace |
| `Cmd+Shift+E` | Editor mode |
| `Cmd+Shift+P` | Preview mode |
| `Cmd+Shift+S` | Split mode |
| `Cmd+Shift+L` | AI Chat |
| `Cmd+Shift+O` | Table of Contents |
| `Cmd+/` | Keyboard shortcuts |
| `Escape` | Close panel |

## Vault Management

SatoriLite supports multiple vaults. Vault registry is stored at `~/.satorilite/vaults.json`. The last active vault is persisted and restored on server restart.

Each vault gets its own index directory at `<vault>/.satorilite/index/` containing:
- `index.faiss` — chunk-level vector index
- `doc_index.faiss` — document-level vector index
- `index_meta.json` — chunk metadata
- `doc_index_meta.json` — document metadata
- `fts_index.json` — full-text search index
- `link_graph.json` — bidirectional link graph

## Running Without the Server

SatoriLite works as a standalone editor without the Python server — just open `index.html` directly or serve with any static file server. You get:

- Full editor (CodeMirror 6)
- File tree and navigation
- Client-side search (MiniSearch)
- Link autocomplete and preview
- All themes and UI features
- Offline PWA support

You lose: semantic search, AI chat, live reload from external changes.

## Tech Stack

**Frontend:**
- Vanilla JavaScript (ES modules, importmaps)
- CodeMirror 6 (editor)
- marked.js (markdown rendering)
- Mermaid.js (diagrams)
- KaTeX (math)
- MiniSearch (client-side full-text search)
- File System Access API (filesystem)

**Backend:**
- Python 3.11+ / FastAPI / Uvicorn
- FAISS (vector similarity search)
- Amazon Bedrock (embeddings + LLM)
- watchdog (filesystem monitoring)
- WebSocket (live reload)

## License

MIT
