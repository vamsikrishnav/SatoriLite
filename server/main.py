"""FastAPI app for SatoriLite RAG server."""

import asyncio
import json
import logging
from pathlib import Path

import boto3
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from server.config import AWS_REGION, BEDROCK_MODEL_ID, VAULT_PATH, INDEX_DIR, index_dir_for_vault
from server.indexer import (
    build_vault_index, reindex_file, remove_file_from_index,
    get_chunk_index, get_doc_index, reconcile_vault_index, embed_texts,
)
from server.rag import retrieve_context, retrieve_context_all_vaults, build_rag_system_prompt
from server.fts import build_fts_index, get_fts_index, reset_fts_index, index_file as fts_index_file, remove_from_fts, search_fts
from server.graph import build_link_graph, save_link_graph, load_link_graph
from server.watcher import VaultWatcher
from server.generate import generate_structured_output, PROMPT_BUILDERS
from server.registry import list_vaults, add_vault, remove_vault as registry_remove_vault

logger = logging.getLogger("satorilite")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="SatoriLite RAG Server")

event_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
ws_clients: set[WebSocket] = set()
vault_watcher: VaultWatcher | None = None

# Runtime vault state (mutable)
active_vault_path: str = VAULT_PATH
active_index_dir: str = INDEX_DIR


def _get_vault_path() -> str:
    return active_vault_path


def _get_index_dir() -> str:
    return active_index_dir


def _read_llms_txt() -> str:
    path = Path(_get_vault_path()) / "llms.txt"
    if path.exists():
        try:
            return path.read_text(encoding="utf-8")
        except OSError:
            pass
    return ""


async def _activate_vault(vault_path: str):
    """Switch to a vault: load FTS + graph, start watcher. Reconcile in background."""
    global active_vault_path, active_index_dir, vault_watcher

    active_vault_path = vault_path
    active_index_dir = index_dir_for_vault(vault_path)
    Path(active_index_dir).mkdir(parents=True, exist_ok=True)

    # Stop existing watcher
    if vault_watcher:
        vault_watcher.stop_all()
        vault_watcher = None

    if not Path(vault_path).is_dir():
        return

    # Load FTS (fast — reads from disk)
    reset_fts_index("default")
    fts_idx = get_fts_index("default", index_dir=active_index_dir)
    if not fts_idx.load() or fts_idx.doc_count() == 0:
        await asyncio.to_thread(build_fts_index, "default", vault_path, active_index_dir)

    # Build link graph
    await asyncio.to_thread(_rebuild_link_graph)

    # Start watcher
    loop = asyncio.get_running_loop()
    vault_watcher = VaultWatcher(event_queue, loop)
    vault_watcher.watch(vault_path)

    # Reconcile FAISS index in background (may call Bedrock for new/changed files)
    asyncio.create_task(_reconcile_background(vault_path, active_index_dir))


async def _reconcile_background(vault_path: str, idx_dir: str):
    """Run FAISS reconciliation in background so startup isn't blocked."""
    try:
        stats = await asyncio.to_thread(reconcile_vault_index, vault_path, idx_dir)
        logger.info("FAISS reconciled for %s: %s", vault_path, stats)
    except Exception as e:
        logger.error("Background reconcile failed for %s: %s", vault_path, e)


@app.on_event("startup")
async def startup():
    global active_vault_path
    Path(active_index_dir).mkdir(parents=True, exist_ok=True)

    if Path(active_vault_path).is_dir() and active_vault_path != ".":
        await _activate_vault(active_vault_path)
    else:
        # Auto-activate first registered vault
        vaults = list_vaults()
        if vaults:
            await _activate_vault(vaults[0]["path"])

    # Pre-load FTS indices for all registered vaults (enables fan-out search)
    await asyncio.to_thread(_ensure_all_fts)

    asyncio.create_task(_process_events())


@app.on_event("shutdown")
async def shutdown():
    if vault_watcher:
        vault_watcher.stop_all()


def _ensure_all_fts():
    """Load or build FTS indices for all registered vaults."""
    vaults = list_vaults()
    for vault in vaults:
        vault_path = vault["path"]
        if not vault.get("has_index"):
            continue
        vault_name = vault.get("name", Path(vault_path).name)
        idx_dir = index_dir_for_vault(vault_path)
        fts_idx = get_fts_index(vault_name, index_dir=idx_dir)
        if not fts_idx.load() or fts_idx.doc_count() == 0:
            build_fts_index(vault_name, vault_path, idx_dir)
            logger.info("FTS built for vault %s (%d docs)", vault_name, fts_idx.doc_count())


def _rebuild_link_graph():
    vault = Path(_get_vault_path())
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
    save_link_graph(graph, _get_index_dir())
    logger.info("Link graph built: %d nodes", len(graph))


async def _broadcast(message: str):
    """Send a message to all WebSocket clients, removing dead connections."""
    dead: set[WebSocket] = set()
    for ws in ws_clients:
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    ws_clients.difference_update(dead)


_pending_paths: dict[str, str] = {}  # path -> latest event_type
_debounce_task: asyncio.Task | None = None
_graph_dirty: bool = False
_graph_rebuild_task: asyncio.Task | None = None

DEBOUNCE_SECONDS = 1.0
GRAPH_DEBOUNCE_SECONDS = 3.0


async def _process_events():
    global _debounce_task
    while True:
        message = await event_queue.get()
        try:
            await _broadcast(message)

            event = json.loads(message)
            path = event.get("path", "")
            event_type = event.get("type", "")

            if not path.endswith(".md"):
                continue

            # Coalesce: keep only the latest event per path
            _pending_paths[path] = event_type

            # Reset debounce timer
            if _debounce_task and not _debounce_task.done():
                _debounce_task.cancel()
            _debounce_task = asyncio.create_task(_flush_pending())

        except Exception as e:
            logger.warning("Error processing event: %s", e)


async def _flush_pending():
    """Wait for debounce window, then process all coalesced events."""
    global _graph_dirty, _graph_rebuild_task
    await asyncio.sleep(DEBOUNCE_SECONDS)

    paths = dict(_pending_paths)
    _pending_paths.clear()

    if not paths:
        return

    await _broadcast(json.dumps({"type": "indexing", "status": "busy", "path": ""}))

    for path, event_type in paths.items():
        try:
            if event_type in ("created", "modified"):
                content = Path(path).read_text(encoding="utf-8")
                changed = await asyncio.to_thread(reindex_file, _get_index_dir(), path, content)
                if changed:
                    fts_index_file("default", path, content)
                    logger.info("Reindexed: %s", path)
            elif event_type == "deleted":
                await asyncio.to_thread(remove_file_from_index, _get_index_dir(), path)
                remove_from_fts("default", path)
                logger.info("Removed from index: %s", path)
        except (OSError, UnicodeDecodeError) as e:
            logger.warning("Failed to process %s: %s", path, e)

    await _broadcast(json.dumps({"type": "indexing", "status": "done", "path": ""}))

    # Debounce graph rebuild separately (expensive)
    _graph_dirty = True
    if _graph_rebuild_task and not _graph_rebuild_task.done():
        _graph_rebuild_task.cancel()
    _graph_rebuild_task = asyncio.create_task(_debounced_graph_rebuild())


async def _debounced_graph_rebuild():
    """Rebuild link graph after a longer debounce (it scans all files)."""
    global _graph_dirty
    await asyncio.sleep(GRAPH_DEBOUNCE_SECONDS)
    if _graph_dirty:
        _graph_dirty = False
        await asyncio.to_thread(_rebuild_link_graph)


@app.get("/api/status")
async def status():
    chunk_index = get_chunk_index(_get_index_dir())
    doc_index = get_doc_index(_get_index_dir())
    graph = load_link_graph(_get_index_dir())
    return {
        "status": "ok",
        "vault": _get_vault_path(),
        "chunks": chunk_index.total_vectors(),
        "docs": doc_index.total_vectors(),
        "graph_nodes": len(graph),
        "graph_edges": sum(len(n.get("outgoing", [])) for n in graph.values()),
    }


@app.get("/api/index/status")
async def index_status():
    vaults = list_vaults()
    total = 0
    vault_count = 0
    for v in vaults:
        if v.get("has_index"):
            idx = get_chunk_index(index_dir_for_vault(v["path"]))
            total += idx.total_vectors()
            vault_count += 1
    return {
        "indexed": total > 0,
        "total_vectors": total,
        "vault_count": vault_count,
    }


@app.post("/api/index/build")
async def build_index():
    stats = await asyncio.to_thread(build_vault_index, _get_vault_path(), _get_index_dir())
    build_fts_index("default", _get_vault_path())
    await asyncio.to_thread(_rebuild_link_graph)
    return {"status": "ok", **stats}


@app.post("/api/index/reconcile")
async def reconcile_index():
    stats = await asyncio.to_thread(reconcile_vault_index, _get_vault_path(), _get_index_dir())
    return {"status": "ok", **stats}


@app.get("/api/models")
async def list_models():
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
    body = await request.json()
    messages = body.get("messages", [])
    file_context = body.get("file_context", "")
    file_path = body.get("file_path", "")
    model = body.get("model", "")

    if not messages:
        raise HTTPException(status_code=400, detail="messages are required")

    model_id = model or BEDROCK_MODEL_ID

    bedrock_messages = []
    for msg in messages:
        bedrock_messages.append({
            "role": msg["role"],
            "content": [{"text": msg["content"]}],
        })

    system_prompts = []
    sources_meta = []
    llms_txt = _read_llms_txt()

    # Always do RAG across all indexed vaults
    last_user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    vaults = list_vaults()
    indexed_vaults = [v for v in vaults if v.get("has_index")]
    if len(indexed_vaults) > 1:
        sources = await asyncio.to_thread(
            retrieve_context_all_vaults, last_user_msg, indexed_vaults, 5,
            use_hyde=True, use_rerank=True, model_id=None,
        )
    elif indexed_vaults:
        sources = await asyncio.to_thread(
            retrieve_context, last_user_msg, _get_index_dir(), 5, "default",
        )
    else:
        sources = []
    sources_meta = sources

    # Build system prompt: llms.txt + RAG sources + current file context
    rag_prompt = build_rag_system_prompt(sources)
    parts = []
    if llms_txt:
        parts.append(llms_txt)
    parts.append(rag_prompt)
    if file_context:
        filename = Path(file_path).name if file_path else "current file"
        parts.append(f"The user currently has this file open ({filename}):\n\n{file_context}")
    system_prompts.append({"text": "\n\n---\n\n".join(parts)})

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
    body = await request.json()
    output_type = body.get("type", "")
    source_paths = body.get("sources", [])
    query = body.get("query", "")

    if output_type not in PROMPT_BUILDERS:
        raise HTTPException(status_code=400, detail=f"Invalid type. Valid: {list(PROMPT_BUILDERS.keys())}")

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
        vaults = list_vaults()
        indexed_vaults = [v for v in vaults if v.get("has_index")]
        if len(indexed_vaults) > 1:
            sources = await asyncio.to_thread(
                retrieve_context_all_vaults, query, indexed_vaults, 5,
            )
        else:
            sources = await asyncio.to_thread(retrieve_context, query, _get_index_dir(), 5, "default")
    else:
        raise HTTPException(status_code=400, detail="Provide 'sources' (paths) or 'query' (text)")

    if not sources:
        raise HTTPException(status_code=404, detail="No sources found")

    try:
        result = await asyncio.to_thread(generate_structured_output, output_type, sources)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Generation failed: {str(e)}")

    return {"content": result, "sources": [{"path": s["path"], "title": s["title"]} for s in sources]}


# ---------------------------------------------------------------------------
# Vault management
# ---------------------------------------------------------------------------


@app.get("/api/vaults")
async def get_vaults():
    """List all registered vaults with index status."""
    vaults = list_vaults()
    active = _get_vault_path()
    for v in vaults:
        v["active"] = (v["path"] == active)
    return vaults


@app.post("/api/vaults/add")
async def add_vault_endpoint(request: Request):
    """Register a new vault path."""
    body = await request.json()
    path = body.get("path", "")
    name = body.get("name", "")

    if not path:
        raise HTTPException(status_code=400, detail="'path' is required")

    try:
        result = add_vault(name, path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return result


@app.post("/api/vaults/remove")
async def remove_vault_endpoint(request: Request):
    """Unregister a vault."""
    body = await request.json()
    path = body.get("path", "")

    if not path:
        raise HTTPException(status_code=400, detail="'path' is required")

    removed = registry_remove_vault(path)
    if not removed:
        raise HTTPException(status_code=404, detail="Vault not found in registry")
    return {"status": "removed", "path": path}


@app.post("/api/vault/switch")
async def switch_vault(request: Request):
    """Switch active vault — reconciles index, starts watcher."""
    body = await request.json()
    path = body.get("path", "")

    if not path:
        raise HTTPException(status_code=400, detail="'path' is required")

    abs_path = str(Path(path).expanduser().resolve())
    if not Path(abs_path).is_dir():
        raise HTTPException(status_code=400, detail=f"Not a valid directory: {abs_path}")

    await _activate_vault(abs_path)

    # Auto-register if not already in registry
    add_vault("", abs_path)

    return {
        "status": "ok",
        "vault": abs_path,
        "index_dir": _get_index_dir(),
    }


# ---------------------------------------------------------------------------
# WebSocket: live file-change notifications
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Static file serving — serves the frontend from the project root
# ---------------------------------------------------------------------------

_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)

app.mount("/", StaticFiles(directory=_PROJECT_ROOT, html=True), name="static")
