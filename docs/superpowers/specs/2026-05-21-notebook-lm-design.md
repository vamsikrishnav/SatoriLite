# NotebookLM Feature — Design Specification

## Overview

Add a NotebookLM-style AI assistant to SatoriLite: source-grounded Q&A over the user's vault, structured output generation (summaries, FAQs, concept maps), and multi-source synthesis — all powered by a local Python server with FAISS and AWS Bedrock.

### Design principles

- Editor stays offline-first. AI features are additive — the PWA works fully without the server.
- Reuse Satori's proven RAG pipeline (rag.py, indexer.py, chat.js) with minimal changes.
- Graph-enhanced retrieval leverages the vault's existing link structure — no Neo4j, no entity extraction.
- Zero UI for credentials — env vars only, server handles all Bedrock auth.

---

## Architecture

### System diagram

```
 BROWSER (SatoriLite PWA)
 +--------------------------------------------------+
 |                                                  |
 |  +-------------+    +-------------------------+  |
 |  | Editor      |    | Chat Panel (sidebar)    |  |
 |  | - CodeMirror|    | - Multi-turn Q&A        |  |
 |  | - Preview   |    | - Source citations      |  |
 |  | - File ops  |    | - Structured outputs    |  |
 |  | (OFFLINE OK)|    | - AI actions menu       |  |
 |  +-------------+    +------------+------------+  |
 |                                  |               |
 +----------------------------------|---------------+
                                    | HTTP/SSE
                                    | localhost:8787
 LOCAL SERVER (Python)              |
 +----------------------------------|---------------+
 |                                  v               |
 |  +------------------------------------------+   |
 |  |            API Layer (FastAPI)            |   |
 |  | POST /api/chat     - RAG + LLM stream    |   |
 |  | POST /api/index    - Build/rebuild index |   |
 |  | GET  /api/status   - Index health        |   |
 |  | POST /api/generate - Structured outputs  |   |
 |  +------------------------------------------+   |
 |       |              |              |            |
 |  +--------+    +-----------+   +---------+      |
 |  | RAG    |    | Indexer   |   | Watcher |      |
 |  | Engine |    | (chunk +  |   | (fs     |      |
 |  | - HyDE |    |  embed +  |   |  events)|      |
 |  | - RRF  |    |  FAISS)   |   |         |      |
 |  | - Rerank|   +-----------+   +---------+      |
 |  | - Graph|         |                           |
 |  +--------+    +---------+                      |
 |       |        | FAISS   |                      |
 |  +--------+   | Indices |                      |
 |  | Bedrock|   | chunk + |                      |
 |  | (LLM + |   | doc lvl |                      |
 |  |  Embed)|   +---------+                      |
 |  +--------+                                     |
 +--------------------------------------------------+
        |                     |
        v                     v
  AWS Bedrock API       Vault (filesystem)
  (us-east-1)           ~/vaults/my-wiki/
```

### Components

| Component | Source | Notes |
|-----------|--------|-------|
| Chat panel UI | Port from Satori `frontend/js/chat.js` | Replace `/api/chat` server URL, add sidebar tab integration |
| AI actions menu | Port from Satori `frontend/js/ai-actions.js` | Nearly drop-in |
| RAG pipeline | Port from Satori `server/rag.py` | Add graph expansion step |
| Indexer | Port from Satori `server/indexer.py` | Add link parsing on index |
| FTS (BM25) | Port from Satori `server/fts.py` | As-is |
| Graph module | NEW | Link graph builder + BFS traversal |
| File watcher | NEW | watchdog-based, triggers reindex |
| Structured outputs | NEW | `/api/generate` endpoint |
| Chat CSS | From Satori `css/satori.css` | Already in SatoriLite's design system |

---

## Data flow

### Query flow

```
User types question
  → Browser POST /api/chat {messages, vault}
  → Server: embed query (Bedrock Titan Embeddings V2)
  → Server: HyDE — generate hypothetical answer, embed that too
  → Server: vector search (FAISS chunk + doc level)
  → Server: graph expansion (parse links from hits, BFS 1-2 hops)
  → Server: BM25 keyword search
  → Server: RRF fusion (vector + graph-expanded + BM25)
  → Server: LLM rerank (top candidates scored by Bedrock)
  → Server: build prompt (llms.txt + sources + user question)
  → Server: stream response (Bedrock ConverseStream → SSE to browser)
  → Browser: render streamed markdown + source citation chips
```

### Index flow

```
File change detected (watcher or startup reconcile)
  → Read file, compute content hash (SHA-256, first 16 chars)
  → If hash differs from stored:
    → Chunk by headings (with breadcrumbs, overlap, min-size merging)
    → Embed chunks via Bedrock Titan (parallel, 8 threads)
    → Embed full document (doc-level index)
    → Update FAISS indices + metadata JSON
    → Parse markdown links → update link graph adjacency list
  → If file deleted:
    → Remove vectors from both FAISS indices
    → Remove edges from link graph
```

---

## Graph-enhanced retrieval

### Link graph construction (at index time)

When a file is indexed:
1. Parse all `[text](*.md)` links → outgoing edges.
2. Compute reverse map → backlinks.
3. Extract frontmatter `tags` → tag co-occurrence edges (files sharing 2+ tags).
4. Note folder co-location → weak sibling edges.

Stored as `.satorilite/index/link_graph.json`:

```json
{
  "notes/auth-middleware.md": {
    "outgoing": ["notes/session-tokens.md", "notes/rbac.md"],
    "backlinks": ["notes/api-gateway.md", "notes/user-service.md"],
    "tags": ["auth", "security"],
    "folder": "notes/"
  }
}
```

### Graph expansion (at query time)

After FAISS returns top-K entry points:

1. For each unique file in results, BFS traverse outgoing + backlinks.
2. Max depth: 2 hops.
3. Score by distance: hop 0 = 1.0, hop 1 = 0.7, hop 2 = 0.4.
4. Feed expanded set into RRF as a third ranked list (alongside vector + BM25).

### When graph expansion is skipped

- Vault has no links (fall back to pure vector + BM25).
- Query is a direct factual lookup (single entry point is sufficient).
- Expansion adds fewer than 2 new nodes (no meaningful graph to traverse).

---

## Server architecture

### Stack

- Python 3.11+
- FastAPI + Uvicorn
- FAISS (faiss-cpu)
- boto3 (AWS Bedrock)
- watchdog (filesystem events)
- numpy

### Directory structure

```
SatoriLite/
  server/
    __init__.py
    main.py            FastAPI app, CORS, startup/shutdown hooks
    config.py          Bedrock region, model IDs, tuning params
    indexer.py         Chunking + embedding + FAISS (from Satori)
    rag.py             HyDE + RRF + rerank + graph expansion
    graph.py           Link graph builder + BFS traversal
    fts.py             BM25 keyword search (from Satori)
    watcher.py         Filesystem watcher, triggers reindex
    generate.py        Structured output generation
    requirements.txt
```

### API surface

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/api/status` | Health + index stats | JSON: `{status, vault, chunks, docs, edges, last_updated}` |
| POST | `/api/chat` | RAG chat | SSE stream: `data: {type: "sources"|"text"|"done", ...}` |
| POST | `/api/index/build` | Full rebuild | JSON: `{files_indexed, total_chunks}` |
| POST | `/api/index/reconcile` | Incremental update | JSON: `{added, updated, removed, unchanged}` |
| GET | `/api/index/status` | Index health | JSON: `{indexed, total_vectors, stale_files, graph_edges}` |
| POST | `/api/generate` | Structured outputs | JSON: `{content, sources}` |
| GET | `/api/models` | Available Bedrock models | JSON array: `[{id, name}]` |

### CORS

Allow origins: `http://localhost:*`, `http://127.0.0.1:*`, `file://`.

### Startup sequence

1. Load config from env vars / `.satorilite/.env`.
2. Load FAISS indices from `.satorilite/index/` (if exist).
3. Load link graph from `.satorilite/index/link_graph.json`.
4. Run `reconcile_vault_index()` — re-embed changed files.
5. Start filesystem watcher.
6. Serve API.

---

## Frontend integration

### Chat panel (right sidebar)

Ported from Satori's `chat.js` with these changes:

1. Configurable server base URL (default `http://localhost:8787`).
2. Server detection: ping `GET /api/status` on load. Unreachable → "AI offline" state.
3. Added as third tab in right sidebar (alongside ToC, Backlinks).
4. Context mode toggle: "Current file" vs "Search vault".
5. Source citation chips dispatch `satori:file-open` event on click.

### AI actions menu

Ported from Satori's `ai-actions.js`. Trigger: `Cmd+Shift+A`.

Actions: Summarize note, Generate TOC, Explain selection, Rewrite selection, Continue writing.

### Structured output quick-actions

Added to chat panel header. Buttons: "Summarize", "FAQ", "Concept Map".
Call `/api/generate` and render result as markdown in the chat area.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+L` | Toggle chat panel |
| `Cmd+Shift+A` | AI actions menu |

---

## Configuration and credentials

### Environment variables

```bash
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-20250514
BEDROCK_EMBED_MODEL=amazon.titan-embed-text-v2:0
SATORILITE_VAULT=/path/to/vault
SATORILITE_PORT=8787
```

Or stored in `.satorilite/.env` (gitignored).

### No credentials UI

The PWA never touches AWS credentials. Server handles all Bedrock authentication. The browser talks to localhost only.

---

## Structured outputs (`/api/generate`)

### Types

| Type | Input | Output |
|------|-------|--------|
| `summary` | 1-5 note paths or a topic query | Structured summary by theme, with citations |
| `faq` | Topic or note paths | 5-10 Q&A pairs with source citations |
| `concept-map` | Topic or note paths | Mermaid diagram of concept relationships |
| `study-guide` | Topic or note paths | Ordered learning path with key takeaways |

### Flow

1. If paths provided, read those files directly. If topic provided, run RAG retrieval.
2. Build type-specific generation prompt.
3. Call Bedrock with tailored system prompt.
4. Return structured markdown + source list.

---

## `llms.txt` integration

The vault's `llms.txt` file (if present) is prepended to every LLM system prompt as orientation context. It tells the LLM:
- What the vault contains and how it's organized.
- Naming conventions and article types.
- Query routing hints (where to look for specific information).
- Content conventions and formatting rules.

### Prompt structure

```
[System]
{llms.txt content}

You are a knowledge assistant for the user's vault.
Answer based ONLY on the provided context. Cite using [Source N].
Format your response with markdown.

Context:
---
[Source 1] file.md — "Section title" (lines 10-25)
{chunk text}

[Source 2] other.md — "Section title" (lines 5-18)
{chunk text}
---

[User]
{question}
```

---

## Launch and operations

### Starting the system

```bash
# Single command (extend existing serve.sh)
./serve.sh

# Or manually
cd SatoriLite/server
python3 -m server --vault ~/vaults/my-wiki --port 8787
```

### Updated `serve.sh`

```bash
#!/bin/sh
python3 -m http.server 8000 &

# RAG server starts only if vault path is set or current dir contains .md files
if [ -n "$SATORILITE_VAULT" ] || find . -maxdepth 1 -name "*.md" -quit 2>/dev/null; then
  python3 -m server --vault "${SATORILITE_VAULT:-.}" --port 8787 &
fi

open "http://localhost:8000"
wait
```

### First-time setup

```bash
cd SatoriLite/server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
python3 -m server --vault ~/vaults/my-wiki
# First startup builds the full index
```

---

## Graceful degradation

| Server state | PWA behavior |
|---|---|
| Running, index built | Full AI features: chat, actions, structured outputs |
| Running, no index | Chat shows "Building index..." then becomes available |
| Not running | Chat tab shows "AI offline. Start server with `python -m server`". All editor features work normally. |
| Running, Bedrock unreachable | Server reports error. Chat shows "API unavailable". Index remains valid for future use. |

---

## Storage layout

```
vault/
  .satorilite/
    config.json          App preferences (theme, font size, etc.)
    .env                 Bedrock credentials (gitignored)
    index/
      index.faiss        Chunk-level FAISS index
      index_meta.json    Chunk metadata (path, title, breadcrumb, lines, text preview)
      doc_index.faiss    Document-level FAISS index
      doc_index_meta.json Document metadata
      link_graph.json    Adjacency list (outgoing, backlinks, tags, folder)
      fts.db             SQLite FTS5 index for BM25
    chats/               Conversation history (optional persistence)
```

---

## Scope boundaries

### In scope (v1)

- Chat panel with RAG-powered Q&A
- Graph-enhanced retrieval (link traversal)
- File watcher with auto-reindex
- Structured outputs (summary, FAQ, concept map, study guide)
- llms.txt orientation context
- AI actions menu (summarize, explain, rewrite, continue)
- Source citations with click-to-open

### Out of scope (future)

- Audio/podcast generation
- Multi-user / shared server
- Non-Bedrock providers (OpenAI, Ollama) — design doesn't preclude, just not implemented
- Embedding model in-browser (transformers.js)
- Real-time collaboration
- Custom prompt templates
