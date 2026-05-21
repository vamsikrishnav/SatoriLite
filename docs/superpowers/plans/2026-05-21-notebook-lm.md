# NotebookLM Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local Python server that provides graph-enhanced RAG over the vault, and integrate a chat panel into the SatoriLite PWA frontend.

**Architecture:** Local Python server (FastAPI + FAISS) ported from Satori, enhanced with link-graph traversal. The browser chat panel calls localhost:8787. Editor remains fully offline; AI features light up when the server is running.

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, FAISS (faiss-cpu), boto3 (AWS Bedrock), watchdog, numpy. Frontend: vanilla JS (existing SatoriLite codebase).

---

## File structure

### Server (new directory: `server/`)

| File | Responsibility |
|------|---------------|
| `server/__init__.py` | Package marker |
| `server/__main__.py` | CLI entrypoint (argparse, starts uvicorn) |
| `server/config.py` | All configuration constants + env var loading |
| `server/main.py` | FastAPI app, CORS, startup/shutdown lifecycle, API routes |
| `server/indexer.py` | Markdown chunking, embedding, FAISS index management (from Satori) |
| `server/rag.py` | RAG pipeline: HyDE, RRF fusion, LLM re-rank (from Satori) |
| `server/graph.py` | Link graph builder + BFS expansion (NEW) |
| `server/fts.py` | BM25 full-text search (from Satori) |
| `server/watcher.py` | Filesystem watcher, triggers reindex (from Satori) |
| `server/generate.py` | Structured output generation: summary, FAQ, concept-map (NEW) |
| `server/requirements.txt` | Python dependencies |
| `server/tests/__init__.py` | Test package marker |
| `server/tests/test_graph.py` | Tests for link graph builder + traversal |
| `server/tests/test_indexer.py` | Tests for chunking logic |
| `server/tests/test_fts.py` | Tests for BM25 search |
| `server/tests/test_rag.py` | Tests for RAG pipeline integration |
| `server/tests/test_generate.py` | Tests for structured outputs |

### Frontend (modifications to existing files)

| File | Change |
|------|--------|
| `js/chat.js` | NEW: Chat panel (ported from Satori) |
| `js/ai-actions.js` | NEW: AI actions menu (ported from Satori) |
| `js/app.js` | Add chat + AI actions initialization |
| `css/satori.css` | Add chat panel styles |
| `index.html` | Add chat tab to right sidebar |

---

## Task 1: Server scaffolding and config

**Files:**
- Create: `server/__init__.py`
- Create: `server/__main__.py`
- Create: `server/config.py`
- Create: `server/requirements.txt`

- [ ] **Step 1: Create requirements.txt**

```
faiss-cpu>=1.7.4
boto3>=1.28.0
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
watchdog>=3.0.0
numpy>=1.24.0
python-dotenv>=1.0.0
```

- [ ] **Step 2: Create config.py**

```python
"""config.py — Centralized configuration for SatoriLite server."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from vault's .satorilite/ directory if it exists
_vault_path = os.environ.get("SATORILITE_VAULT", ".")
_env_file = Path(_vault_path) / ".satorilite" / ".env"
if _env_file.exists():
    load_dotenv(_env_file)

# Embedding
EMBED_DIM = 1024
EMBED_BATCH_SIZE = 20
TEXT_TRUNCATE_CHARS = 20000

# Chunking
MIN_CHUNK_WORDS = 50
CHUNK_OVERLAP_LINES = 3

# Search
SIMILARITY_THRESHOLD = 0.3
BM25_K1 = 1.2
BM25_B = 0.75

# AWS
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_EMBED_MODEL = os.environ.get("BEDROCK_EMBED_MODEL", "amazon.titan-embed-text-v2:0")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-20250514")

# Server
PORT = int(os.environ.get("SATORILITE_PORT", "8787"))
VAULT_PATH = os.environ.get("SATORILITE_VAULT", ".")

# Paths (index stored inside the vault)
INDEX_DIR = str(Path(VAULT_PATH) / ".satorilite" / "index")

# RAG pipeline
RRF_K = 60

# Graph
GRAPH_MAX_HOPS = 2
GRAPH_HOP_WEIGHTS = {0: 1.0, 1: 0.7, 2: 0.4}
```

- [ ] **Step 3: Create __init__.py**

```python
```

- [ ] **Step 4: Create __main__.py**

```python
"""CLI entrypoint for SatoriLite RAG server."""

import argparse
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="SatoriLite RAG server")
    parser.add_argument("--vault", default=os.environ.get("SATORILITE_VAULT", "."),
                        help="Path to the vault directory")
    parser.add_argument("--port", type=int, default=int(os.environ.get("SATORILITE_PORT", "8787")),
                        help="Port to listen on (default: 8787)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Host to bind to (default: 127.0.0.1)")
    args = parser.parse_args()

    # Set env vars before importing config
    os.environ["SATORILITE_VAULT"] = os.path.abspath(args.vault)
    os.environ["SATORILITE_PORT"] = str(args.port)

    import uvicorn
    uvicorn.run("server.main:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Test that the server starts**

Run: `cd /Users/I342929/projects/SatoriLite && python -m server --vault . --port 8787`

Expected: Server starts, logs "Uvicorn running on http://127.0.0.1:8787". Ctrl+C to stop.

- [ ] **Step 6: Commit**

```bash
git add server/__init__.py server/__main__.py server/config.py server/requirements.txt
git commit -m "feat(server): scaffold server with config and CLI entrypoint"
```

---

## Task 2: Port indexer (chunking + FAISS)

**Files:**
- Create: `server/indexer.py`
- Create: `server/tests/__init__.py`
- Create: `server/tests/test_indexer.py`

- [ ] **Step 1: Write the chunking test**

```python
"""tests/test_indexer.py — Tests for markdown chunking logic."""

from server.indexer import chunk_markdown


def test_chunk_by_headings():
    content = """---
tags: [test]
---

# Main Title

Introduction paragraph.

## Section One

Content of section one.

## Section Two

Content of section two.
"""
    chunks = chunk_markdown(content, file_path="notes/test.md")
    assert len(chunks) >= 2
    assert chunks[0]["path"] == "notes/test.md"
    assert "Section One" in chunks[0]["title"] or "Main Title" in chunks[0]["title"]
    assert chunks[0]["start_line"] > 0
    assert chunks[0]["end_line"] > chunks[0]["start_line"]


def test_chunk_no_headings():
    content = "Just a plain paragraph with no headings at all."
    chunks = chunk_markdown(content, file_path="notes/plain.md")
    assert len(chunks) == 1
    assert chunks[0]["title"] == "plain"
    assert "plain paragraph" in chunks[0]["text"]


def test_chunk_strips_frontmatter():
    content = """---
tags: [meta]
created: 2026-01-01
---

# Real Content

Body here.
"""
    chunks = chunk_markdown(content, file_path="notes/fm.md")
    assert len(chunks) >= 1
    assert "tags:" not in chunks[0]["text"]
    assert "Body here" in chunks[0]["text"]


def test_chunk_includes_breadcrumb():
    content = """# Top

## Sub Section

Deep content.
"""
    chunks = chunk_markdown(content, file_path="notes/deep.md")
    found = [c for c in chunks if "Sub Section" in c["title"]]
    assert len(found) == 1
    assert "deep" in found[0]["breadcrumb"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_indexer.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'server.indexer'`

- [ ] **Step 3: Create indexer.py (port from Satori)**

Copy `/Users/I342929/projects/Satori/server/indexer.py` to `/Users/I342929/projects/SatoriLite/server/indexer.py`.

Change the import line from:
```python
from config import (
    EMBED_DIM, MIN_CHUNK_WORDS, EMBED_BATCH_SIZE,
    TEXT_TRUNCATE_CHARS, SIMILARITY_THRESHOLD,
    BEDROCK_EMBED_MODEL, AWS_REGION, CHUNK_OVERLAP_LINES,
)
```
to:
```python
from server.config import (
    EMBED_DIM, MIN_CHUNK_WORDS, EMBED_BATCH_SIZE,
    TEXT_TRUNCATE_CHARS, SIMILARITY_THRESHOLD,
    BEDROCK_EMBED_MODEL, AWS_REGION, CHUNK_OVERLAP_LINES,
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_indexer.py -v`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/indexer.py server/tests/__init__.py server/tests/test_indexer.py
git commit -m "feat(server): port chunking and FAISS indexer from Satori"
```

---

## Task 3: Port FTS (BM25 keyword search)

**Files:**
- Create: `server/fts.py`
- Create: `server/tests/test_fts.py`

- [ ] **Step 1: Write the FTS test**

```python
"""tests/test_fts.py — Tests for BM25 full-text search."""

from server.fts import FTSIndex, tokenize


def test_tokenize_basic():
    tokens = tokenize("Hello World! This is a test.")
    assert "hello" in tokens
    assert "world" in tokens
    assert "test" in tokens
    # Stop words removed
    assert "this" not in tokens
    assert "is" not in tokens


def test_fts_add_and_search():
    idx = FTSIndex()
    idx.add_doc("notes/k8s.md", "Kubernetes Deployment", "Deploy containers to production using kubectl apply.")
    idx.add_doc("notes/docker.md", "Docker Basics", "Build container images with Dockerfile.")

    results = idx.search("deploy containers")
    assert len(results) >= 1
    assert results[0]["path"] == "notes/k8s.md"


def test_fts_remove_doc():
    idx = FTSIndex()
    idx.add_doc("notes/a.md", "Alpha", "First document content.")
    idx.add_doc("notes/b.md", "Beta", "Second document content.")
    idx.remove_doc("notes/a.md")

    results = idx.search("first")
    assert len(results) == 0


def test_fts_title_boost():
    idx = FTSIndex()
    idx.add_doc("notes/auth.md", "Authentication Guide", "This covers login flows.")
    idx.add_doc("notes/other.md", "Other Topic", "Authentication is mentioned here once.")

    results = idx.search("authentication")
    assert results[0]["path"] == "notes/auth.md"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_fts.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'server.fts'`

- [ ] **Step 3: Create fts.py (port from Satori)**

Copy `/Users/I342929/projects/Satori/server/fts.py` to `/Users/I342929/projects/SatoriLite/server/fts.py`.

Change the import:
```python
from config import BM25_K1, BM25_B, SATORI_CONFIG_DIR
```
to:
```python
from server.config import BM25_K1, BM25_B, INDEX_DIR
```

Replace the `_fts_index_dir` function:
```python
def _fts_index_dir(vault_name: str) -> str:
    """Return the storage directory for the FTS index."""
    return INDEX_DIR
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_fts.py -v`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/fts.py server/tests/test_fts.py
git commit -m "feat(server): port BM25 full-text search from Satori"
```

---

## Task 4: Link graph builder and BFS traversal (NEW)

**Files:**
- Create: `server/graph.py`
- Create: `server/tests/test_graph.py`

- [ ] **Step 1: Write the graph tests**

```python
"""tests/test_graph.py — Tests for link graph builder and BFS traversal."""

from server.graph import parse_links, build_link_graph, expand_from_entry_points


def test_parse_links_basic():
    content = """# My Note

See [other note](other.md) and [deep link](folder/deep.md).
Also a [web link](https://example.com) which should be ignored.
"""
    links = parse_links(content, file_path="notes/my-note.md")
    assert "notes/other.md" in links
    assert "notes/folder/deep.md" in links
    assert "https://example.com" not in links


def test_parse_links_relative_parent():
    content = "See [parent note](../parent.md)"
    links = parse_links(content, file_path="notes/sub/child.md")
    assert "notes/parent.md" in links


def test_build_link_graph():
    files = {
        "notes/a.md": "Link to [B](b.md) and [C](c.md).",
        "notes/b.md": "Link to [A](a.md).",
        "notes/c.md": "No links here.",
    }
    graph = build_link_graph(files)
    assert "notes/b.md" in graph["notes/a.md"]["outgoing"]
    assert "notes/c.md" in graph["notes/a.md"]["outgoing"]
    assert "notes/a.md" in graph["notes/b.md"]["outgoing"]
    # Backlinks
    assert "notes/a.md" in graph["notes/b.md"]["backlinks"]
    assert "notes/a.md" in graph["notes/c.md"]["backlinks"]


def test_expand_from_entry_points_1_hop():
    graph = {
        "a.md": {"outgoing": ["b.md", "c.md"], "backlinks": [], "tags": [], "folder": ""},
        "b.md": {"outgoing": ["d.md"], "backlinks": ["a.md"], "tags": [], "folder": ""},
        "c.md": {"outgoing": [], "backlinks": ["a.md"], "tags": [], "folder": ""},
        "d.md": {"outgoing": [], "backlinks": ["b.md"], "tags": [], "folder": ""},
    }
    expanded = expand_from_entry_points(["a.md"], graph, max_hops=1)
    assert expanded["a.md"] == 0
    assert expanded["b.md"] == 1
    assert expanded["c.md"] == 1
    assert "d.md" not in expanded  # 2 hops away, max_hops=1


def test_expand_from_entry_points_2_hops():
    graph = {
        "a.md": {"outgoing": ["b.md"], "backlinks": [], "tags": [], "folder": ""},
        "b.md": {"outgoing": ["c.md"], "backlinks": ["a.md"], "tags": [], "folder": ""},
        "c.md": {"outgoing": [], "backlinks": ["b.md"], "tags": [], "folder": ""},
    }
    expanded = expand_from_entry_points(["a.md"], graph, max_hops=2)
    assert expanded["a.md"] == 0
    assert expanded["b.md"] == 1
    assert expanded["c.md"] == 2


def test_expand_handles_cycles():
    graph = {
        "a.md": {"outgoing": ["b.md"], "backlinks": ["b.md"], "tags": [], "folder": ""},
        "b.md": {"outgoing": ["a.md"], "backlinks": ["a.md"], "tags": [], "folder": ""},
    }
    expanded = expand_from_entry_points(["a.md"], graph, max_hops=5)
    assert len(expanded) == 2  # Does not loop forever
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_graph.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'server.graph'`

- [ ] **Step 3: Implement graph.py**

```python
"""graph.py — Link graph builder and BFS traversal for graph-enhanced RAG."""

import json
import logging
import re
from collections import deque
from pathlib import Path

from server.config import GRAPH_MAX_HOPS, GRAPH_HOP_WEIGHTS

logger = logging.getLogger("satorilite.graph")


def parse_links(content: str, file_path: str) -> list[str]:
    """Parse all internal markdown links from content. Returns resolved paths."""
    pattern = re.compile(r'\[([^\]]*)\]\(([^)]+)\)')
    file_dir = str(Path(file_path).parent)
    links = []

    for match in pattern.finditer(content):
        target = match.group(2)
        # Skip external URLs, anchors, and non-md targets
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        if not target.endswith(".md"):
            continue
        # Remove anchor fragments
        target = target.split("#")[0]
        # Resolve relative path
        resolved = str(Path(file_dir) / target)
        # Normalize (resolve ../  etc.)
        resolved = str(Path(resolved).resolve()) if ".." in resolved else resolved
        # Normalize to posix-style relative path
        resolved = str(Path(resolved))
        links.append(resolved)

    return links


def build_link_graph(files: dict[str, str]) -> dict[str, dict]:
    """Build a link graph from a dict of {file_path: content}.

    Returns: {path: {"outgoing": [...], "backlinks": [...], "tags": [...], "folder": "..."}}
    """
    graph: dict[str, dict] = {}

    # Initialize all nodes
    for path in files:
        folder = str(Path(path).parent)
        graph[path] = {"outgoing": [], "backlinks": [], "tags": [], "folder": folder}

    # Parse outgoing links
    for path, content in files.items():
        outgoing = parse_links(content, path)
        # Only keep links to files that exist in the graph
        valid_outgoing = [link for link in outgoing if link in graph]
        graph[path]["outgoing"] = valid_outgoing

    # Compute backlinks (reverse of outgoing)
    for path, node in graph.items():
        for target in node["outgoing"]:
            if target in graph and path not in graph[target]["backlinks"]:
                graph[target]["backlinks"].append(path)

    # Extract tags from frontmatter
    for path, content in files.items():
        if content.startswith("---"):
            end = content.find("\n---", 3)
            if end != -1:
                frontmatter = content[3:end]
                tag_match = re.search(r'tags:\s*\[([^\]]*)\]', frontmatter)
                if tag_match:
                    tags = [t.strip().strip("'\"") for t in tag_match.group(1).split(",")]
                    graph[path]["tags"] = [t for t in tags if t]

    return graph


def expand_from_entry_points(
    entry_points: list[str],
    graph: dict[str, dict],
    max_hops: int = GRAPH_MAX_HOPS,
) -> dict[str, int]:
    """BFS expand from entry points, returning {path: distance}.

    Traverses outgoing links and backlinks up to max_hops.
    """
    expanded: dict[str, int] = {}
    queue: deque[tuple[str, int]] = deque()

    for path in entry_points:
        if path in graph:
            queue.append((path, 0))

    while queue:
        current, distance = queue.popleft()
        if current in expanded:
            continue
        expanded[current] = distance

        if distance >= max_hops:
            continue

        node = graph.get(current)
        if not node:
            continue

        for neighbor in node["outgoing"]:
            if neighbor not in expanded:
                queue.append((neighbor, distance + 1))
        for neighbor in node["backlinks"]:
            if neighbor not in expanded:
                queue.append((neighbor, distance + 1))

    return expanded


def save_link_graph(graph: dict[str, dict], index_dir: str) -> None:
    """Persist link graph to disk as JSON."""
    path = Path(index_dir) / "link_graph.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(graph, indent=2), encoding="utf-8")


def load_link_graph(index_dir: str) -> dict[str, dict]:
    """Load link graph from disk. Returns empty dict if not found."""
    path = Path(index_dir) / "link_graph.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to load link graph: %s", e)
        return {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_graph.py -v`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/graph.py server/tests/test_graph.py
git commit -m "feat(server): add link graph builder and BFS expansion"
```

---

## Task 5: Port RAG pipeline with graph integration

**Files:**
- Create: `server/rag.py`
- Create: `server/tests/test_rag.py`

- [ ] **Step 1: Write the RAG integration test**

```python
"""tests/test_rag.py — Tests for RAG pipeline (unit-level, no Bedrock calls)."""

from server.rag import build_rag_system_prompt, _rrf_fuse


def test_rrf_fuse_basic():
    list1 = [{"path": "a.md", "score": 0.9}, {"path": "b.md", "score": 0.7}]
    list2 = [{"path": "b.md", "score": 0.8}, {"path": "c.md", "score": 0.6}]
    fused = _rrf_fuse([list1, list2])
    # b.md appears in both lists, should score highest
    assert fused[0]["path"] == "b.md"
    assert len(fused) == 3


def test_rrf_fuse_empty():
    fused = _rrf_fuse([[], []])
    assert fused == []


def test_build_rag_system_prompt_with_sources():
    sources = [{
        "path": "notes/k8s.md",
        "title": "Kubernetes Basics",
        "breadcrumb": "notes > k8s > Basics",
        "start_line": 10,
        "end_line": 25,
        "text": "Kubernetes orchestrates containers across a cluster.",
    }]
    prompt = build_rag_system_prompt(sources)
    assert "Source 1" in prompt
    assert "Kubernetes Basics" in prompt
    assert "notes/k8s.md" in prompt or "k8s.md" in prompt
    assert "ONLY" in prompt  # Instruction to answer only from context


def test_build_rag_system_prompt_no_sources():
    prompt = build_rag_system_prompt([])
    assert "no relevant sources" in prompt.lower() or "could not find" in prompt.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_rag.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'server.rag'`

- [ ] **Step 3: Create rag.py (port from Satori + add graph expansion)**

Copy `/Users/I342929/projects/Satori/server/rag.py` to `/Users/I342929/projects/SatoriLite/server/rag.py`.

Change imports from:
```python
from config import RRF_K, AWS_REGION, BEDROCK_MODEL_ID
from indexer import chunk_markdown, embed_texts, get_chunk_index, get_doc_index
from fts import search_fts
```
to:
```python
from server.config import RRF_K, AWS_REGION, BEDROCK_MODEL_ID, INDEX_DIR, GRAPH_HOP_WEIGHTS
from server.indexer import chunk_markdown, embed_texts, get_chunk_index, get_doc_index
from server.fts import search_fts
from server.graph import load_link_graph, expand_from_entry_points
```

Add graph expansion to the `retrieve_context` function. After the existing Step 4 (RRF fusion), insert:

```python
    # Step 4b: Graph expansion — traverse link graph from entry points
    link_graph = load_link_graph(index_dir)
    if link_graph:
        entry_paths = list({r["path"] for r in fused[:k]})
        expanded = expand_from_entry_points(entry_paths, link_graph)
        # Build a ranked list from graph-expanded results (excluding entry points)
        graph_results = []
        for path, distance in sorted(expanded.items(), key=lambda x: x[1]):
            if distance == 0:
                continue  # Already in fused results
            weight = GRAPH_HOP_WEIGHTS.get(distance, 0.3)
            graph_results.append({
                "path": path,
                "title": Path(path).stem,
                "breadcrumb": "",
                "start_line": 1,
                "end_line": 1,
                "text": "",
                "score": weight,
            })
        if graph_results:
            fused = _rrf_fuse([fused, graph_results])
```

Also add at the top of the file:
```python
from pathlib import Path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_rag.py -v`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/rag.py server/tests/test_rag.py
git commit -m "feat(server): port RAG pipeline with graph-enhanced retrieval"
```

---

## Task 6: Port file watcher

**Files:**
- Create: `server/watcher.py`

- [ ] **Step 1: Create watcher.py (port from Satori)**

Copy `/Users/I342929/projects/Satori/server/watcher.py` to `/Users/I342929/projects/SatoriLite/server/watcher.py`.

No import changes needed — this file only uses `asyncio`, `json`, `pathlib`, and `watchdog` (no internal imports).

- [ ] **Step 2: Verify import works**

Run: `cd /Users/I342929/projects/SatoriLite && python -c "from server.watcher import VaultWatcher; print('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/watcher.py
git commit -m "feat(server): port filesystem watcher from Satori"
```

---

## Task 7: Structured output generation (NEW)

**Files:**
- Create: `server/generate.py`
- Create: `server/tests/test_generate.py`

- [ ] **Step 1: Write the test**

```python
"""tests/test_generate.py — Tests for structured output prompt builders."""

from server.generate import build_summary_prompt, build_faq_prompt, build_concept_map_prompt


def test_build_summary_prompt():
    sources = [{"path": "a.md", "title": "Alpha", "text": "Content about alpha."}]
    prompt = build_summary_prompt(sources)
    assert "summary" in prompt.lower() or "summarize" in prompt.lower()
    assert "Content about alpha" in prompt
    assert "Source" in prompt


def test_build_faq_prompt():
    sources = [{"path": "b.md", "title": "Beta", "text": "Detailed explanation of beta."}]
    prompt = build_faq_prompt(sources)
    assert "question" in prompt.lower() or "FAQ" in prompt
    assert "Detailed explanation" in prompt


def test_build_concept_map_prompt():
    sources = [
        {"path": "a.md", "title": "Auth", "text": "Auth handles login."},
        {"path": "b.md", "title": "RBAC", "text": "RBAC manages permissions."},
    ]
    prompt = build_concept_map_prompt(sources)
    assert "mermaid" in prompt.lower() or "diagram" in prompt.lower()
    assert "Auth" in prompt
    assert "RBAC" in prompt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_generate.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'server.generate'`

- [ ] **Step 3: Implement generate.py**

```python
"""generate.py — Structured output generation (summary, FAQ, concept map)."""

import json
import logging

import boto3

from server.config import AWS_REGION, BEDROCK_MODEL_ID

logger = logging.getLogger("satorilite.generate")


def _format_sources_block(sources: list[dict]) -> str:
    """Format sources into numbered blocks for prompt injection."""
    blocks = []
    for i, src in enumerate(sources, 1):
        title = src.get("title", "Untitled")
        text = src.get("text", "")
        blocks.append(f"[Source {i}] {src['path']} — \"{title}\"\n{text}")
    return "\n\n---\n\n".join(blocks)


def build_summary_prompt(sources: list[dict]) -> str:
    """Build prompt for structured summary generation."""
    sources_text = _format_sources_block(sources)
    return f"""Based on the following knowledge base content, generate a structured summary.

Requirements:
- Organize by theme/topic, not by source order.
- Use markdown headings (##) for each theme.
- Under each theme, 3-5 bullet points capturing key information.
- Cite sources using [Source N] inline.
- Be comprehensive but concise.

Sources:
---
{sources_text}
---"""


def build_faq_prompt(sources: list[dict]) -> str:
    """Build prompt for FAQ generation."""
    sources_text = _format_sources_block(sources)
    return f"""Based on the following knowledge base content, generate a FAQ (5-10 questions and answers).

Requirements:
- Questions should cover the most important concepts, common confusions, and practical "how do I..." queries.
- Each answer must cite which source it draws from using [Source N].
- Format as markdown with ## for each question.
- Answers should be concise (2-4 sentences).

Sources:
---
{sources_text}
---"""


def build_concept_map_prompt(sources: list[dict]) -> str:
    """Build prompt for concept map (Mermaid diagram) generation."""
    sources_text = _format_sources_block(sources)
    return f"""Based on the following knowledge base content, generate a concept map as a Mermaid diagram.

Requirements:
- Use `flowchart TD` syntax.
- Nodes represent key concepts, systems, or entities mentioned in the sources.
- Edges represent relationships (links to, depends on, part of, uses).
- Label edges with the relationship type.
- Include 8-15 nodes maximum.
- After the diagram, provide a brief legend explaining the key relationships.

Sources:
---
{sources_text}
---"""


def build_study_guide_prompt(sources: list[dict]) -> str:
    """Build prompt for study guide generation."""
    sources_text = _format_sources_block(sources)
    return f"""Based on the following knowledge base content, generate a study guide.

Requirements:
- Present as an ordered learning path (numbered sections).
- Each section: heading + 2-3 key takeaways + one "check your understanding" question.
- Cite sources using [Source N].
- Start with fundamentals, build to advanced topics.
- End with a "what to read next" section.

Sources:
---
{sources_text}
---"""


PROMPT_BUILDERS = {
    "summary": build_summary_prompt,
    "faq": build_faq_prompt,
    "concept-map": build_concept_map_prompt,
    "study-guide": build_study_guide_prompt,
}


def generate_structured_output(output_type: str, sources: list[dict], model_id: str | None = None) -> str:
    """Generate a structured output from sources using Bedrock.

    Args:
        output_type: One of "summary", "faq", "concept-map", "study-guide".
        sources: List of source dicts with "path", "title", "text".
        model_id: Override model (defaults to config).

    Returns:
        Generated markdown content.
    """
    builder = PROMPT_BUILDERS.get(output_type)
    if not builder:
        raise ValueError(f"Unknown output type: {output_type}. Valid: {list(PROMPT_BUILDERS.keys())}")

    prompt = builder(sources)
    model = model_id or BEDROCK_MODEL_ID

    client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    response = client.converse(
        modelId=model,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": 2000, "temperature": 0.3},
    )
    return response["output"]["message"]["content"][0]["text"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_generate.py -v`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/generate.py server/tests/test_generate.py
git commit -m "feat(server): add structured output generation (summary, FAQ, concept map)"
```

---

## Task 8: FastAPI main app with all routes

**Files:**
- Create: `server/main.py`

- [ ] **Step 1: Create main.py**

```python
"""main.py — FastAPI app for SatoriLite RAG server."""

import asyncio
import json
import logging
import os
from pathlib import Path

import boto3
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from server.config import (
    AWS_REGION, BEDROCK_MODEL_ID, VAULT_PATH, INDEX_DIR,
)
from server.indexer import (
    build_vault_index, reindex_file, remove_file_from_index,
    get_chunk_index, get_doc_index, reconcile_vault_index, embed_texts,
)
from server.rag import retrieve_context, build_rag_system_prompt
from server.fts import build_fts_index, get_fts_index, index_file as fts_index_file, remove_from_fts, search_fts
from server.graph import build_link_graph, save_link_graph, load_link_graph
from server.watcher import VaultWatcher
from server.generate import generate_structured_output, PROMPT_BUILDERS

logger = logging.getLogger("satorilite")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="SatoriLite RAG Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:*", "http://127.0.0.1:*", "null"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Event queue for watcher
event_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
vault_watcher: VaultWatcher | None = None


def _read_llms_txt() -> str:
    """Read llms.txt from vault root if it exists."""
    path = Path(VAULT_PATH) / "llms.txt"
    if path.exists():
        try:
            return path.read_text(encoding="utf-8")
        except OSError:
            pass
    return ""


@app.on_event("startup")
async def startup():
    global vault_watcher
    loop = asyncio.get_running_loop()

    # Ensure index dir exists
    Path(INDEX_DIR).mkdir(parents=True, exist_ok=True)

    # Reconcile FAISS index
    vault_path = VAULT_PATH
    if Path(vault_path).is_dir():
        try:
            await asyncio.to_thread(reconcile_vault_index, vault_path, INDEX_DIR)
            logger.info("FAISS index reconciled for %s", vault_path)
        except Exception as e:
            logger.error("Failed to reconcile FAISS index: %s", e)

        # Build/load FTS index
        fts_idx = get_fts_index("default")
        if not fts_idx.load() or fts_idx.doc_count() == 0:
            await asyncio.to_thread(build_fts_index, "default", vault_path)

        # Build link graph
        await asyncio.to_thread(_rebuild_link_graph)

        # Start watcher
        vault_watcher = VaultWatcher(event_queue, loop)
        vault_watcher.watch(vault_path)
        asyncio.create_task(_process_events())


@app.on_event("shutdown")
async def shutdown():
    if vault_watcher:
        vault_watcher.stop_all()


def _rebuild_link_graph():
    """Rebuild the link graph from all markdown files in the vault."""
    vault = Path(VAULT_PATH)
    files: dict[str, str] = {}
    for md_file in vault.rglob("*.md"):
        parts = md_file.relative_to(vault).parts
        if any(p.startswith(".") for p in parts):
            continue
        try:
            files[str(md_file)] = md_file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
    graph = build_link_graph(files)
    save_link_graph(graph, INDEX_DIR)
    logger.info("Link graph built: %d nodes", len(graph))


async def _process_events():
    """Process file watcher events — reindex changed files."""
    while True:
        message = await event_queue.get()
        try:
            event = json.loads(message)
            path = event.get("path", "")
            event_type = event.get("type", "")

            if not path.endswith(".md"):
                continue

            if event_type in ("created", "modified"):
                try:
                    content = Path(path).read_text(encoding="utf-8")
                    await asyncio.to_thread(reindex_file, INDEX_DIR, path, content)
                    fts_index_file("default", path, content)
                    await asyncio.to_thread(_rebuild_link_graph)
                    logger.info("Reindexed: %s", path)
                except (OSError, UnicodeDecodeError) as e:
                    logger.warning("Failed to reindex %s: %s", path, e)
            elif event_type == "deleted":
                await asyncio.to_thread(remove_file_from_index, INDEX_DIR, path)
                remove_from_fts("default", path)
                await asyncio.to_thread(_rebuild_link_graph)
                logger.info("Removed from index: %s", path)
        except Exception as e:
            logger.warning("Error processing event: %s", e)


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------


@app.get("/api/status")
async def status():
    """Health check and index stats."""
    chunk_index = get_chunk_index(INDEX_DIR)
    doc_index = get_doc_index(INDEX_DIR)
    graph = load_link_graph(INDEX_DIR)
    return {
        "status": "ok",
        "vault": VAULT_PATH,
        "chunks": chunk_index.total_vectors(),
        "docs": doc_index.total_vectors(),
        "graph_nodes": len(graph),
        "graph_edges": sum(len(n.get("outgoing", [])) for n in graph.values()),
    }


@app.get("/api/index/status")
async def index_status():
    """Detailed index health."""
    chunk_index = get_chunk_index(INDEX_DIR)
    return {
        "indexed": chunk_index.total_vectors() > 0,
        "total_vectors": chunk_index.total_vectors(),
    }


@app.post("/api/index/build")
async def build_index():
    """Full rebuild of all indices."""
    stats = await asyncio.to_thread(build_vault_index, VAULT_PATH, INDEX_DIR)
    build_fts_index("default", VAULT_PATH)
    await asyncio.to_thread(_rebuild_link_graph)
    return {"status": "ok", **stats}


@app.post("/api/index/reconcile")
async def reconcile_index():
    """Incremental index update — only re-embeds changed files."""
    stats = await asyncio.to_thread(reconcile_vault_index, VAULT_PATH, INDEX_DIR)
    return {"status": "ok", **stats}


@app.get("/api/models")
async def list_models():
    """List available Claude models from Bedrock."""
    try:
        client = boto3.client("bedrock", region_name=AWS_REGION)
        profiles = client.list_inference_profiles()["inferenceProfileSummaries"]
        results = []
        for p in profiles:
            pid = p["inferenceProfileId"]
            name = p.get("inferenceProfileName", pid)
            if "claude" in pid.lower():
                results.append({"id": pid, "name": name})
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bedrock error: {str(e)}")


@app.post("/api/chat")
async def chat(request: Request):
    """RAG-powered chat with SSE streaming."""
    body = await request.json()
    messages = body.get("messages", [])
    context = body.get("context", "")
    model = body.get("model", "")

    if not messages:
        raise HTTPException(status_code=400, detail="messages are required")

    model_id = model or BEDROCK_MODEL_ID

    # Build Bedrock messages
    bedrock_messages = []
    for msg in messages:
        bedrock_messages.append({
            "role": msg["role"],
            "content": [{"text": msg["content"]}],
        })

    # System prompt
    system_prompts = []
    sources_meta = []
    llms_txt = _read_llms_txt()

    if not context:
        # Vault mode — use RAG
        last_user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        sources = await asyncio.to_thread(retrieve_context, last_user_msg, INDEX_DIR, 5, "default")
        sources_meta = sources
        rag_prompt = build_rag_system_prompt(sources)
        full_system = ""
        if llms_txt:
            full_system = llms_txt + "\n\n---\n\n"
        full_system += rag_prompt
        system_prompts.append({"text": full_system})
    else:
        # File mode — current file as context
        prefix = (llms_txt + "\n\n---\n\n") if llms_txt else ""
        system_prompts.append({"text": f"{prefix}Context from the user's current note:\n\n{context}"})

    try:
        client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
        kwargs = {"modelId": model_id, "messages": bedrock_messages}
        if system_prompts:
            kwargs["system"] = system_prompts
        response = client.converse_stream(**kwargs)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bedrock error: {str(e)}")

    async def event_generator():
        if sources_meta:
            sources_event = json.dumps({
                "type": "sources",
                "sources": [
                    {"path": s["path"], "title": s["title"],
                     "start_line": s["start_line"], "end_line": s["end_line"],
                     "score": s.get("score", 0)}
                    for s in sources_meta
                ]
            })
            yield f"data: {sources_event}\n\n"

        try:
            stream = response.get("stream")
            if stream:
                for event in stream:
                    if "contentBlockDelta" in event:
                        delta = event["contentBlockDelta"].get("delta", {})
                        text = delta.get("text", "")
                        if text:
                            yield f"data: {json.dumps({'type': 'text', 'content': text})}\n\n"
                    elif "messageStop" in event:
                        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/generate")
async def generate(request: Request):
    """Generate structured outputs (summary, FAQ, concept map, study guide)."""
    body = await request.json()
    output_type = body.get("type", "")
    source_paths = body.get("sources", [])
    query = body.get("query", "")

    if output_type not in PROMPT_BUILDERS:
        raise HTTPException(status_code=400, detail=f"Invalid type. Valid: {list(PROMPT_BUILDERS.keys())}")

    # Get sources: either from explicit paths or via RAG retrieval
    sources = []
    if source_paths:
        for path in source_paths:
            try:
                content = Path(path).read_text(encoding="utf-8")
                title = Path(path).stem
                sources.append({"path": path, "title": title, "text": content})
            except (OSError, UnicodeDecodeError):
                continue
    elif query:
        sources = await asyncio.to_thread(retrieve_context, query, INDEX_DIR, 5, "default")
    else:
        raise HTTPException(status_code=400, detail="Provide 'sources' (paths) or 'query' (text)")

    if not sources:
        raise HTTPException(status_code=404, detail="No sources found")

    try:
        result = await asyncio.to_thread(generate_structured_output, output_type, sources)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Generation failed: {str(e)}")

    return {"content": result, "sources": [{"path": s["path"], "title": s["title"]} for s in sources]}
```

- [ ] **Step 2: Verify server starts and /api/status works**

Run:
```bash
cd /Users/I342929/projects/SatoriLite
pip install -r server/requirements.txt
python -m server --vault . --port 8787 &
sleep 2
curl http://localhost:8787/api/status
kill %1
```

Expected: JSON response with `{"status": "ok", "vault": "...", "chunks": 0, "docs": 0, ...}`

- [ ] **Step 3: Commit**

```bash
git add server/main.py
git commit -m "feat(server): add FastAPI app with chat, index, and generate routes"
```

---

## Task 9: Frontend — chat panel

**Files:**
- Create: `js/chat.js`
- Modify: `js/app.js`
- Modify: `index.html`
- Modify: `css/satori.css`

- [ ] **Step 1: Create js/chat.js (port from Satori)**

Copy `/Users/I342929/projects/Satori/frontend/js/chat.js` to `/Users/I342929/projects/SatoriLite/js/chat.js`.

Changes to make:
1. Replace the import line:
```javascript
import { getContent, getCurrentFilePath } from './editor.js';
import { getCurrentVault } from './app.js';
import { marked } from 'marked';
```
with:
```javascript
import { getContent } from './editor.js';
import { marked } from '../lib/marked.js';
```

2. Replace the `getCurrentVault()` calls. In `sendMessage()`, change:
```javascript
  if (mode === 'vault') {
    const vault = getCurrentVault();
    payload.vault = vault ? vault.name : '';
  } else {
    payload.context = getContent() || '';
  }
```
to:
```javascript
  if (mode === 'vault') {
    // Vault mode — server uses RAG (no vault name needed, server knows its vault)
  } else {
    payload.context = getContent() || '';
  }
```

3. Replace the fetch URL `'/api/chat'` with the configurable server URL:
```javascript
const SERVER_URL = 'http://localhost:8787';
```
And change all fetch calls from `'/api/...'` to `${SERVER_URL}/api/...`.

4. In `checkIndexStatus()`, replace the vault-based URL with:
```javascript
const resp = await fetch(`${SERVER_URL}/api/index/status`);
```

5. In `buildIndex()`, change to:
```javascript
const resp = await fetch(`${SERVER_URL}/api/index/build`, { method: 'POST' });
```

6. In `loadModels()`, change to:
```javascript
const resp = await fetch(`${SERVER_URL}/api/models`);
```

7. Add a server connectivity check at the top of `initChat()`:
```javascript
  // Check if server is reachable
  try {
    const resp = await fetch(`${SERVER_URL}/api/status`);
    if (!resp.ok) throw new Error('Server unavailable');
  } catch {
    // Show offline state
    const offline = document.createElement('div');
    offline.className = 'chat-offline';
    offline.textContent = 'AI offline. Start server: python -m server --vault /path/to/vault';
    panel.appendChild(offline);
    sidebar.appendChild(panel);
    return;
  }
```

- [ ] **Step 2: Add chat tab to index.html**

In the right sidebar section of `index.html`, add the Chat tab button alongside existing tabs (ToC, Backlinks):

Find the right sidebar tab buttons and add:
```html
<button class="sidebar-tab" data-panel="chat" title="AI Chat (Cmd+Shift+L)">Chat</button>
```

Add a chat panel container:
```html
<div id="panel-chat" class="sidebar-panel" style="display:none;"></div>
```

- [ ] **Step 3: Add chat initialization to app.js**

At the top of `js/app.js`, add:
```javascript
import { initChat } from './chat.js';
```

In the initialization section, add:
```javascript
initChat();
```

- [ ] **Step 4: Add chat CSS to satori.css**

Add the following chat panel styles to the end of `css/satori.css`:

```css
/* Chat panel */
.chat-panel { display: flex; flex-direction: column; height: 100%; }
.chat-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.chat-title { font-weight: 600; font-size: 13px; }
.chat-header-actions { display: flex; gap: 4px; }
.chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.chat-message { padding: 8px 12px; border-radius: 8px; font-size: 13px; line-height: 1.5; max-width: 90%; }
.chat-message-user { background: var(--accent); color: var(--bg); align-self: flex-end; }
.chat-message-ai { background: var(--surface); align-self: flex-start; }
.chat-message-ai p { margin: 0 0 8px; }
.chat-message-ai p:last-child { margin-bottom: 0; }
.chat-message-ai code { background: var(--bg); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.chat-message-ai pre { background: var(--bg); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 8px 0; }
.chat-input-area { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); }
.chat-textarea { flex: 1; resize: none; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px; font-size: 13px; color: var(--text); font-family: inherit; }
.chat-textarea:focus { outline: none; border-color: var(--accent); }
.chat-send-btn { padding: 6px 12px; }
.chat-model-bar, .chat-mode-bar, .chat-index-bar { display: flex; align-items: center; gap: 8px; padding: 4px 12px; font-size: 11px; color: var(--text-muted); }
.chat-model-select, .chat-mode-select { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; font-size: 11px; color: var(--text); }
.chat-index-status.indexed { color: var(--green); }
.chat-loading { display: flex; gap: 4px; padding: 8px 12px; }
.chat-loading .dot { width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; animation: chatBounce 1.2s infinite; }
.chat-loading .dot:nth-child(2) { animation-delay: 0.2s; }
.chat-loading .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes chatBounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
.chat-sources { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.chat-sources-label { font-size: 11px; color: var(--text-muted); margin-right: 4px; }
.chat-source-chip { font-size: 11px; padding: 2px 8px; border-radius: 12px; background: var(--accent-muted, rgba(var(--accent-rgb), 0.15)); color: var(--accent); border: none; cursor: pointer; }
.chat-source-chip:hover { background: var(--accent); color: var(--bg); }
.chat-offline { padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px; }
```

- [ ] **Step 5: Test the chat panel in browser**

Run:
```bash
cd /Users/I342929/projects/SatoriLite
python -m http.server 8000 &
python -m server --vault . --port 8787 &
open http://localhost:8000
```

Expected: Chat tab visible in right sidebar. Click it. If server is running: chat interface loads with model selector. If not: "AI offline" message shows.

- [ ] **Step 6: Commit**

```bash
git add js/chat.js js/app.js index.html css/satori.css
git commit -m "feat(frontend): add AI chat panel to right sidebar"
```

---

## Task 10: Frontend — AI actions menu

**Files:**
- Create: `js/ai-actions.js`
- Modify: `js/app.js`
- Modify: `css/satori.css`

- [ ] **Step 1: Create js/ai-actions.js (port from Satori)**

Copy `/Users/I342929/projects/Satori/frontend/js/ai-actions.js` to `/Users/I342929/projects/SatoriLite/js/ai-actions.js`.

Change the import:
```javascript
import { getContent, getEditorView } from './editor.js';
import { sendToChat } from './chat.js';
```

This should work as-is since SatoriLite's `editor.js` already exports `getContent` and has `getEditorView` or equivalent. Verify the function names match SatoriLite's editor module.

- [ ] **Step 2: Add AI actions initialization to app.js**

```javascript
import { initAIActions } from './ai-actions.js';
```

And in init:
```javascript
initAIActions();
```

- [ ] **Step 3: Add AI actions CSS to satori.css**

```css
/* AI actions menu */
.ai-actions-menu { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 4px; min-width: 200px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); z-index: 1000; }
.ai-actions-item { padding: 8px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; color: var(--text); }
.ai-actions-item:hover { background: var(--accent-muted, rgba(var(--accent-rgb), 0.1)); }
.ai-actions-item.disabled { opacity: 0.4; cursor: default; }
.ai-actions-item.disabled:hover { background: none; }
```

- [ ] **Step 4: Test Cmd+Shift+A opens the actions menu**

Open the app in browser. Press Cmd+Shift+A. Expected: actions menu appears with options (Summarize note, Generate TOC, etc.).

- [ ] **Step 5: Commit**

```bash
git add js/ai-actions.js js/app.js css/satori.css
git commit -m "feat(frontend): add AI actions menu (Cmd+Shift+A)"
```

---

## Task 11: Update serve.sh and add .gitignore entries

**Files:**
- Modify: `serve.sh`
- Modify: `.gitignore` (create if needed)

- [ ] **Step 1: Update serve.sh**

```bash
#!/bin/sh
# Start PWA static server
python3 -m http.server 8000 &

# RAG server starts only if vault path is set or current dir contains .md files
if [ -n "$SATORILITE_VAULT" ] || find . -maxdepth 1 -name "*.md" -print -quit 2>/dev/null | grep -q .; then
  python3 -m server --vault "${SATORILITE_VAULT:-.}" --port 8787 &
fi

open "http://localhost:8000" 2>/dev/null
wait
```

- [ ] **Step 2: Add .gitignore entries**

Ensure `.gitignore` includes:
```
.satorilite/index/
.satorilite/.env
.superpowers/
server/.venv/
server/__pycache__/
server/tests/__pycache__/
*.pyc
```

- [ ] **Step 3: Commit**

```bash
git add serve.sh .gitignore
git commit -m "chore: update serve.sh for dual-server startup, add gitignore"
```

---

## Task 12: End-to-end integration test

**Files:**
- Create: `server/tests/test_integration.py`

- [ ] **Step 1: Write integration test (uses actual server, mocks Bedrock)**

```python
"""tests/test_integration.py — End-to-end test with mocked Bedrock."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def vault_dir(tmp_path):
    """Create a temporary vault with test markdown files."""
    (tmp_path / "note1.md").write_text("""---
tags: [test, alpha]
---

# Note One

This is the first note about Kubernetes deployment.
It links to [note two](note2.md).
""")
    (tmp_path / "note2.md").write_text("""---
tags: [test, beta]
---

# Note Two

This is the second note about container networking.
""")
    (tmp_path / ".satorilite").mkdir()
    (tmp_path / ".satorilite" / "index").mkdir()
    return tmp_path


@pytest.fixture
def client(vault_dir):
    """Create a test client with mocked vault path."""
    import os
    os.environ["SATORILITE_VAULT"] = str(vault_dir)
    # Re-import to pick up new env
    import importlib
    import server.config
    importlib.reload(server.config)
    from server.main import app
    return TestClient(app)


def test_status_endpoint(client):
    resp = client.get("/api/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


def test_index_build(client):
    with patch("server.indexer.embed_texts") as mock_embed:
        mock_embed.return_value = __import__("numpy").random.rand(1, 1024).astype("float32")
        resp = client.post("/api/index/build")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["files_indexed"] >= 1


def test_generate_requires_type(client):
    resp = client.post("/api/generate", json={"type": "invalid"})
    assert resp.status_code == 400
```

- [ ] **Step 2: Run integration tests**

Run: `cd /Users/I342929/projects/SatoriLite && python -m pytest server/tests/test_integration.py -v`

Expected: All tests PASS (Bedrock calls are mocked).

- [ ] **Step 3: Commit**

```bash
git add server/tests/test_integration.py
git commit -m "test: add end-to-end integration tests with mocked Bedrock"
```

---

## Summary

| Task | Description | New/Port |
|------|-------------|----------|
| 1 | Server scaffolding, config, CLI | New |
| 2 | Indexer (chunking + FAISS) | Port from Satori |
| 3 | FTS (BM25 search) | Port from Satori |
| 4 | Link graph builder + BFS traversal | New |
| 5 | RAG pipeline + graph integration | Port + enhance |
| 6 | File watcher | Port from Satori |
| 7 | Structured output generation | New |
| 8 | FastAPI main app with all routes | New (using Satori as reference) |
| 9 | Frontend chat panel | Port from Satori |
| 10 | Frontend AI actions menu | Port from Satori |
| 11 | serve.sh + gitignore | Update |
| 12 | Integration tests | New |
