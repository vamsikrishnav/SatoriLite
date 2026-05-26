"""FastAPI app for SatoriLite — agentic chat with tool-use loop."""

import asyncio
import concurrent.futures
import json
import logging
import subprocess
from pathlib import Path

import boto3
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from server.config import AWS_REGION, BEDROCK_MODEL_ID, BEDROCK_ROUTER_MODEL_ID, VAULT_PATH, INDEX_DIR, index_dir_for_vault
from server.registry import get_last_active_vault, set_last_active_vault
from server.fts import build_fts_index, get_fts_index, reset_fts_index, index_file as fts_index_file, remove_from_fts, search_fts
from server.watcher import VaultWatcher
from server.tools import execute_tool, TOOL_DEFINITIONS
from server.registry import list_vaults, add_vault, remove_vault as registry_remove_vault

logger = logging.getLogger("satorilite")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="SatoriLite")

event_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
ws_clients: set[WebSocket] = set()
vault_watcher: VaultWatcher | None = None

# Runtime vault state (mutable)
active_vault_path: str = VAULT_PATH
active_index_dir: str = INDEX_DIR

MAX_TOOL_CALLS = 15


def _get_vault_path() -> str:
    return active_vault_path


def _get_index_dir() -> str:
    return active_index_dir


async def _activate_vault(vault_path: str):
    """Switch to a vault: load FTS, start watcher."""
    global active_vault_path, active_index_dir, vault_watcher

    active_vault_path = vault_path
    active_index_dir = index_dir_for_vault(vault_path)
    Path(active_index_dir).mkdir(parents=True, exist_ok=True)
    set_last_active_vault(vault_path)
    logger.info("Activating vault: %s", vault_path)

    if vault_watcher:
        vault_watcher.stop_all()
        vault_watcher = None

    if not Path(vault_path).is_dir():
        return

    # Load or build FTS index
    reset_fts_index("default")
    fts_idx = get_fts_index("default", index_dir=active_index_dir)
    if not fts_idx.load() or fts_idx.doc_count() == 0:
        await asyncio.to_thread(build_fts_index, "default", vault_path, active_index_dir)

    # Start watcher
    loop = asyncio.get_running_loop()
    vault_watcher = VaultWatcher(event_queue, loop)
    vault_watcher.watch(vault_path)


@app.on_event("startup")
async def startup():
    global active_vault_path
    Path(active_index_dir).mkdir(parents=True, exist_ok=True)

    if Path(active_vault_path).is_dir() and active_vault_path != ".":
        await _activate_vault(active_vault_path)
    else:
        last_active = get_last_active_vault()
        if last_active:
            await _activate_vault(last_active)
        else:
            vaults = list_vaults()
            if vaults:
                await _activate_vault(vaults[0]["path"])

    # Pre-load FTS indices for all registered vaults
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
        if not Path(vault_path).is_dir():
            continue
        vault_name = vault.get("name", Path(vault_path).name)
        idx_dir = index_dir_for_vault(vault_path)
        Path(idx_dir).mkdir(parents=True, exist_ok=True)
        fts_idx = get_fts_index(vault_name, index_dir=idx_dir)
        if not fts_idx.load() or fts_idx.doc_count() == 0:
            build_fts_index(vault_name, vault_path, idx_dir)
            logger.info("FTS built for vault %s (%d docs)", vault_name, fts_idx.doc_count())


async def _broadcast(message: str):
    """Send a message to all WebSocket clients."""
    dead: set[WebSocket] = set()
    for ws in ws_clients:
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    ws_clients.difference_update(dead)


_pending_paths: dict[str, str] = {}
_debounce_task: asyncio.Task | None = None
DEBOUNCE_SECONDS = 1.0


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

            _pending_paths[path] = event_type
            if _debounce_task and not _debounce_task.done():
                _debounce_task.cancel()
            _debounce_task = asyncio.create_task(_flush_pending())
        except Exception as e:
            logger.warning("Error processing event: %s", e)


async def _flush_pending():
    """Wait for debounce window, then update FTS index."""
    await asyncio.sleep(DEBOUNCE_SECONDS)

    paths = dict(_pending_paths)
    _pending_paths.clear()

    if not paths:
        return

    for path, event_type in paths.items():
        try:
            if event_type in ("created", "modified"):
                content = Path(path).read_text(encoding="utf-8")
                fts_index_file("default", path, content)
                logger.info("FTS updated: %s", path)
            elif event_type == "deleted":
                remove_from_fts("default", path)
                logger.info("FTS removed: %s", path)
        except (OSError, UnicodeDecodeError) as e:
            logger.warning("Failed to process %s: %s", path, e)


# ---------------------------------------------------------------------------
# Chat — agentic tool-use loop
# ---------------------------------------------------------------------------


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    file_context = body.get("file_context", "")
    file_path = body.get("file_path", "")
    model = body.get("model", "")

    if not messages:
        raise HTTPException(status_code=400, detail="messages are required")

    model_id = model or BEDROCK_ROUTER_MODEL_ID
    vault_path = _get_vault_path()
    vault_name = "default"

    last_user_msg = messages[-1]["content"] if messages[-1]["role"] == "user" else ""

    async def event_generator():
        # -------------------------------------------------------------------
        # Phase 1: Deterministic parallel pre-fetch (no LLM, ~50ms)
        # Stream progress events as each step completes
        # -------------------------------------------------------------------
        yield f"data: {json.dumps({'type': 'progress', 'tool': 'search', 'input': {'query': last_user_msg}})}\n\n"

        def _prefetch_search():
            return search_fts(vault_name, last_user_msg, limit=5)

        def _prefetch_grep():
            words = last_user_msg.lower().split()
            pattern = " ".join(words[:4]) if len(words) >= 2 else last_user_msg
            try:
                result = subprocess.run(
                    ["grep", "-rin", "--include=*.md", "-l", pattern, vault_path],
                    capture_output=True, text=True, timeout=5,
                )
                return [p.strip() for p in result.stdout.strip().split("\n") if p.strip()][:10]
            except (subprocess.TimeoutExpired, OSError):
                return []

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            search_future = pool.submit(_prefetch_search)
            grep_future = pool.submit(_prefetch_grep)
            search_results = search_future.result()
            grep_paths = grep_future.result()

        # Merge results
        seen_paths = set()
        ranked_paths = []
        for r in search_results:
            if r["path"] not in seen_paths:
                seen_paths.add(r["path"])
                ranked_paths.append(r["path"])
        for p in grep_paths:
            if p not in seen_paths:
                seen_paths.add(p)
                ranked_paths.append(p)

        yield f"data: {json.dumps({'type': 'progress', 'tool': 'grep', 'input': {'pattern': last_user_msg[:50], 'matches': len(ranked_paths)}})}\n\n"

        # Read top files in parallel
        def _read_file(path, max_lines=200):
            try:
                content = Path(path).read_text(errors="replace")
                lines = content.split("\n")[:max_lines]
                return path, "\n".join(lines)
            except OSError:
                return path, ""

        files_to_read = ranked_paths[:5]
        file_contents = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(_read_file, p): p for p in files_to_read}
            for f in concurrent.futures.as_completed(futures):
                path, content = f.result()
                if content:
                    file_contents[path] = content

        for path in file_contents:
            rel_path = path.replace(vault_path + "/", "")
            yield f"data: {json.dumps({'type': 'progress', 'tool': 'read', 'input': {'path': rel_path}})}\n\n"

        # -------------------------------------------------------------------
        # Phase 2: Build system prompt with pre-loaded content
        # -------------------------------------------------------------------
        system_parts = []
        vaults = list_vaults()
        vault_list = ", ".join(f"{v['name']} ({v['path']})" for v in vaults)
        system_parts.append(
            f"You are a knowledge assistant for the user's personal notes vault.\n"
            f"The relevant vault content has been pre-loaded below. Answer directly from it.\n"
            f"Only use tools if the pre-loaded content is clearly insufficient.\n"
            f"Do not fabricate information — if you can't find it, say so.\n"
            f"Cite file paths when referencing specific information.\n"
            f"Format responses with markdown for readability.\n\n"
            f"Active vault: {vault_path}\n"
            f"Available vaults: {vault_list}"
        )
        if file_context:
            filename = Path(file_path).name if file_path else "current file"
            system_parts.append(f"The user currently has this file open ({filename}):\n\n{file_context}")

        if file_contents:
            context_blocks = []
            for path, content in file_contents.items():
                rel_path = path.replace(vault_path + "/", "")
                context_blocks.append(f"### {rel_path}\n```\n{content}\n```")
            system_parts.append(
                "## Pre-loaded vault content\n\n" + "\n\n".join(context_blocks)
            )

        system_prompt = [{"text": "\n\n---\n\n".join(system_parts)}]

        bedrock_messages = []
        for msg in messages:
            bedrock_messages.append({
                "role": msg["role"],
                "content": [{"text": msg["content"]}],
            })

        files_read = set(file_contents.keys())
        client = boto3.client("bedrock-runtime", region_name=AWS_REGION)

        # -------------------------------------------------------------------
        # Phase 3: Stream LLM response token-by-token
        # -------------------------------------------------------------------
        try:
            stream_response = await asyncio.to_thread(
                client.converse_stream,
                modelId=model_id,
                messages=bedrock_messages,
                system=system_prompt,
            )

            full_text = ""
            for event in stream_response["stream"]:
                if "contentBlockDelta" in event:
                    delta = event["contentBlockDelta"].get("delta", {})
                    if "text" in delta:
                        chunk = delta["text"]
                        full_text += chunk
                        yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"

            # If answer is too short/uncertain, fall back to agent loop
            needs_more = (
                len(full_text) < 100
                or "don't have enough" in full_text.lower()
                or "cannot find" in full_text.lower()
                or "no information" in full_text.lower()
            ) and file_contents

            if needs_more:
                tool_config = {"tools": TOOL_DEFINITIONS}
                tool_calls_made = 0

                bedrock_messages_with_tools = []
                for msg in messages:
                    bedrock_messages_with_tools.append({
                        "role": msg["role"],
                        "content": [{"text": msg["content"]}],
                    })

                response = await asyncio.to_thread(
                    client.converse,
                    modelId=model_id,
                    messages=bedrock_messages_with_tools,
                    system=system_prompt,
                    toolConfig=tool_config,
                )
                stop_reason = response.get("stopReason", "")
                assistant_message = response["output"]["message"]
                bedrock_messages_with_tools.append(assistant_message)

                while stop_reason == "tool_use" and tool_calls_made < MAX_TOOL_CALLS:
                    tool_results = []
                    for block in assistant_message["content"]:
                        if "toolUse" not in block:
                            continue
                        tool_use = block["toolUse"]
                        tool_name = tool_use["name"]
                        tool_input = tool_use["input"]
                        tool_id = tool_use["toolUseId"]

                        yield f"data: {json.dumps({'type': 'progress', 'tool': tool_name, 'input': tool_input})}\n\n"

                        result = await asyncio.to_thread(
                            execute_tool, tool_name, tool_input, vault_path, vault_name
                        )

                        if tool_name == "read" and "content" in result:
                            files_read.add(tool_input.get("path", ""))

                        tool_results.append({
                            "toolUseId": tool_id,
                            "content": [{"text": json.dumps(result)}],
                        })
                        tool_calls_made += 1

                    bedrock_messages_with_tools.append({
                        "role": "user",
                        "content": [{"toolResult": tr} for tr in tool_results],
                    })

                    response = await asyncio.to_thread(
                        client.converse,
                        modelId=model_id,
                        messages=bedrock_messages_with_tools,
                        system=system_prompt,
                        toolConfig=tool_config,
                    )
                    stop_reason = response.get("stopReason", "")
                    assistant_message = response["output"]["message"]
                    bedrock_messages_with_tools.append(assistant_message)

                # Stream the fallback answer
                fallback_text = ""
                for block in assistant_message["content"]:
                    if "text" in block:
                        fallback_text += block["text"]
                if fallback_text:
                    yield f"data: {json.dumps({'type': 'text', 'content': fallback_text})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

        # Sources and done
        if files_read:
            yield f"data: {json.dumps({'type': 'sources', 'paths': list(files_read)})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ---------------------------------------------------------------------------
# Status and models
# ---------------------------------------------------------------------------


@app.get("/api/status")
async def status():
    fts_idx = get_fts_index("default", index_dir=_get_index_dir())
    return {
        "status": "ok",
        "vault": _get_vault_path(),
        "fts_docs": fts_idx.doc_count(),
    }


@app.get("/api/index/status")
async def index_status():
    vaults = list_vaults()
    total = 0
    vault_count = 0
    for v in vaults:
        if not Path(v["path"]).is_dir():
            continue
        vault_name = v.get("name", Path(v["path"]).name)
        idx = get_fts_index(vault_name, index_dir=index_dir_for_vault(v["path"]))
        count = idx.doc_count()
        if count > 0:
            total += count
            vault_count += 1
    return {
        "indexed": total > 0,
        "total_docs": total,
        "vault_count": vault_count,
    }


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
    """Switch active vault — loads FTS, starts watcher."""
    body = await request.json()
    path = body.get("path", "")

    if not path:
        raise HTTPException(status_code=400, detail="'path' is required")

    abs_path = str(Path(path).expanduser().resolve())
    if not Path(abs_path).is_dir():
        raise HTTPException(status_code=400, detail=f"Not a valid directory: {abs_path}")

    await _activate_vault(abs_path)
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
# Static file serving
# ---------------------------------------------------------------------------

_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent)

app.mount("/", StaticFiles(directory=_PROJECT_ROOT, html=True), name="static")
