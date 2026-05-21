"""FastAPI app for SatoriLite RAG server."""

import asyncio
import json
import logging
from pathlib import Path

import boto3
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from server.config import AWS_REGION, BEDROCK_MODEL_ID, VAULT_PATH, INDEX_DIR
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

event_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
vault_watcher: VaultWatcher | None = None


def _read_llms_txt() -> str:
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

    Path(INDEX_DIR).mkdir(parents=True, exist_ok=True)

    vault_path = VAULT_PATH
    if Path(vault_path).is_dir():
        try:
            await asyncio.to_thread(reconcile_vault_index, vault_path, INDEX_DIR)
            logger.info("FAISS index reconciled for %s", vault_path)
        except Exception as e:
            logger.error("Failed to reconcile FAISS index: %s", e)

        fts_idx = get_fts_index("default")
        if not fts_idx.load() or fts_idx.doc_count() == 0:
            await asyncio.to_thread(build_fts_index, "default", vault_path)

        await asyncio.to_thread(_rebuild_link_graph)

        vault_watcher = VaultWatcher(event_queue, loop)
        vault_watcher.watch(vault_path)
        asyncio.create_task(_process_events())


@app.on_event("shutdown")
async def shutdown():
    if vault_watcher:
        vault_watcher.stop_all()


def _rebuild_link_graph():
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


@app.get("/api/status")
async def status():
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
    chunk_index = get_chunk_index(INDEX_DIR)
    return {
        "indexed": chunk_index.total_vectors() > 0,
        "total_vectors": chunk_index.total_vectors(),
    }


@app.post("/api/index/build")
async def build_index():
    stats = await asyncio.to_thread(build_vault_index, VAULT_PATH, INDEX_DIR)
    build_fts_index("default", VAULT_PATH)
    await asyncio.to_thread(_rebuild_link_graph)
    return {"status": "ok", **stats}


@app.post("/api/index/reconcile")
async def reconcile_index():
    stats = await asyncio.to_thread(reconcile_vault_index, VAULT_PATH, INDEX_DIR)
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
        sources = await asyncio.to_thread(retrieve_context, last_user_msg, INDEX_DIR, 5, "default")
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
