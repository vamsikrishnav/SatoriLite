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
from server.rag import retrieve_context, build_rag_system_prompt
from server.fts import build_fts_index, get_fts_index, index_file as fts_index_file, remove_from_fts, search_fts
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
    """Switch to a vault: reconcile index, rebuild FTS + graph, start watcher."""
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

    # Reconcile FAISS index
    try:
        await asyncio.to_thread(reconcile_vault_index, vault_path, active_index_dir)
        logger.info("FAISS index reconciled for %s", vault_path)
    except Exception as e:
        logger.error("Failed to reconcile FAISS index: %s", e)

    # Build/load FTS
    fts_idx = get_fts_index("default")
    if not fts_idx.load() or fts_idx.doc_count() == 0:
        await asyncio.to_thread(build_fts_index, "default", vault_path)

    # Build link graph
    await asyncio.to_thread(_rebuild_link_graph)

    # Start watcher
    loop = asyncio.get_running_loop()
    vault_watcher = VaultWatcher(event_queue, loop)
    vault_watcher.watch(vault_path)


@app.on_event("startup")
async def startup():
    Path(active_index_dir).mkdir(parents=True, exist_ok=True)

    if Path(active_vault_path).is_dir() and active_vault_path != ".":
        await _activate_vault(active_vault_path)

    asyncio.create_task(_process_events())


@app.on_event("shutdown")
async def shutdown():
    if vault_watcher:
        vault_watcher.stop_all()


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


async def _process_events():
    while True:
        message = await event_queue.get()
        try:
            # Broadcast raw file-change event to all WebSocket clients
            await _broadcast(message)

            event = json.loads(message)
            path = event.get("path", "")
            event_type = event.get("type", "")

            if not path.endswith(".md"):
                continue

            # Notify clients that indexing started
            await _broadcast(json.dumps({"type": "indexing", "status": "busy", "path": path}))

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
            await _broadcast(json.dumps({"type": "indexing", "status": "done", "path": path}))

        except Exception as e:
            logger.warning("Error processing event: %s", e)


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
    chunk_index = get_chunk_index(_get_index_dir())
    return {
        "indexed": chunk_index.total_vectors() > 0,
        "total_vectors": chunk_index.total_vectors(),
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
    context = body.get("context", "")
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

    if not context:
        last_user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        sources = await asyncio.to_thread(retrieve_context, last_user_msg, _get_index_dir(), 5, "default", model_id=model_id)
        sources_meta = sources
        rag_prompt = build_rag_system_prompt(sources)
        full_system = ""
        if llms_txt:
            full_system = llms_txt + "\n\n---\n\n"
        full_system += rag_prompt
        system_prompts.append({"text": full_system})
    else:
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
