"""rag.py — Retrieval-Augmented Generation logic for Satori chat."""

import json
import logging
from pathlib import Path

import boto3

from server.config import RRF_K, AWS_REGION, BEDROCK_MODEL_ID, INDEX_DIR, GRAPH_HOP_WEIGHTS
from server.indexer import chunk_markdown, embed_texts, get_chunk_index, get_doc_index
from server.fts import search_fts
from server.graph import load_link_graph, expand_from_entry_points

logger = logging.getLogger("satori.rag")


def _read_file_cached(path: str, cache: dict[str, str | None]) -> str | None:
    """Read a file with caching to avoid redundant I/O within a single retrieval."""
    if path in cache:
        return cache[path]
    file_path = Path(path)
    if not file_path.exists():
        cache[path] = None
        return None
    try:
        content = file_path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, PermissionError, OSError):
        cache[path] = None
        return None
    cache[path] = content
    return content


def _rrf_fuse(ranked_lists: list[list[dict]], key: str = "path", k: int = RRF_K) -> list[dict]:
    """Reciprocal Rank Fusion across multiple ranked result lists.

    Each result must have `key` field for dedup. Returns fused list sorted by
    RRF score, with the best metadata copy for each unique key.
    """
    scores: dict[str, float] = {}
    best_entry: dict[str, dict] = {}

    for ranked in ranked_lists:
        for rank, item in enumerate(ranked):
            item_key = item[key]
            rrf_score = 1.0 / (k + rank + 1)
            scores[item_key] = scores.get(item_key, 0.0) + rrf_score
            if item_key not in best_entry or item.get("score", 0) > best_entry[item_key].get("score", 0):
                best_entry[item_key] = item

    fused = []
    for item_key, rrf_score in sorted(scores.items(), key=lambda x: -x[1]):
        entry = best_entry[item_key].copy()
        entry["rrf_score"] = rrf_score
        fused.append(entry)
    return fused


def _generate_hyde_doc(query: str) -> str | None:
    """Generate a hypothetical document for HyDE (Hypothetical Document Embeddings).

    Asks the LLM to write a short passage that would answer the query, then
    embeds that passage instead of the raw query for better semantic matching.
    """
    try:
        client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
        response = client.converse(
            modelId=BEDROCK_MODEL_ID,
            messages=[{
                "role": "user",
                "content": [{"text": (
                    "Write a short, factual paragraph (3-5 sentences) that would "
                    "directly answer this question. Write it as if it's an excerpt "
                    "from a knowledge base article. Do not include any preamble.\n\n"
                    f"Question: {query}"
                )}],
            }],
            inferenceConfig={"maxTokens": 200, "temperature": 0.0},
        )
        output = response["output"]["message"]["content"][0]["text"]
        return output.strip()
    except Exception as e:
        logger.warning("HyDE generation failed, falling back to raw query: %s", e)
        return None


def _rerank(query: str, candidates: list[dict], top_k: int = 5) -> list[dict]:
    """Re-rank candidates using the LLM as a cross-encoder judge.

    Sends the query and candidate texts to the LLM, asks it to rank by relevance.
    Falls back to the original ordering if the LLM call fails.
    """
    if len(candidates) <= 1:
        return candidates

    # Build numbered candidate list for the LLM
    candidate_lines = []
    for i, c in enumerate(candidates):
        title = c.get("title", "Untitled")
        breadcrumb = c.get("breadcrumb", "")
        text_preview = c.get("text", "")[:300]
        ctx = f"[{breadcrumb}] " if breadcrumb else ""
        candidate_lines.append(f"[{i}] {ctx}{title}\n{text_preview}")

    candidates_text = "\n---\n".join(candidate_lines)

    try:
        client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
        response = client.converse(
            modelId=BEDROCK_MODEL_ID,
            messages=[{
                "role": "user",
                "content": [{"text": (
                    f"Query: {query}\n\n"
                    f"Rank these passages by relevance to the query. "
                    f"Return ONLY a JSON array of passage indices from most to least relevant. "
                    f"Example: [2, 0, 4, 1, 3]\n\n{candidates_text}"
                )}],
            }],
            inferenceConfig={"maxTokens": 100, "temperature": 0.0},
        )
        text = response["output"]["message"]["content"][0]["text"].strip()
        # Parse the JSON array from the response
        # Handle cases where LLM wraps in markdown code blocks
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        ranking = json.loads(text)
        if isinstance(ranking, list) and all(isinstance(x, int) for x in ranking):
            reranked = []
            seen = set()
            for idx in ranking:
                if 0 <= idx < len(candidates) and idx not in seen:
                    reranked.append(candidates[idx])
                    seen.add(idx)
            # Append any candidates not mentioned by the LLM
            for i, c in enumerate(candidates):
                if i not in seen:
                    reranked.append(c)
            return reranked[:top_k]
    except Exception as e:
        logger.warning("Re-ranking failed, using original order: %s", e)

    return candidates[:top_k]


def retrieve_context(query: str, index_dir: str, k: int = 5,
                     vault_name: str | None = None,
                     use_hyde: bool = True,
                     use_rerank: bool = True) -> list[dict]:
    """Multi-signal retrieval with RRF fusion, HyDE, and LLM re-ranking.

    Pipeline:
    1. Optionally generate a HyDE document for better semantic matching
    2. Semantic search (chunk-level + document-level via FAISS)
    3. BM25 keyword search (if vault_name provided)
    4. Fuse results via Reciprocal Rank Fusion
    5. Optionally re-rank top candidates via LLM
    6. Enrich with fresh file content
    """
    read_cache: dict[str, str | None] = {}

    # Step 1: HyDE — generate hypothetical document for embedding
    hyde_doc = None
    if use_hyde:
        hyde_doc = _generate_hyde_doc(query)

    embed_text = hyde_doc if hyde_doc else query
    query_vector = embed_texts([embed_text])
    # Also embed raw query for direct matching if HyDE was used
    raw_query_vector = embed_texts([query]) if hyde_doc else query_vector

    # Step 2: Semantic search — chunk-level
    chunk_index = get_chunk_index(index_dir)
    semantic_results = []
    if chunk_index.total_vectors() > 0:
        hyde_results = chunk_index.search(query_vector, k=k * 2)
        if hyde_doc:
            raw_results = chunk_index.search(raw_query_vector, k=k)
            # Merge both sets via RRF for robustness
            semantic_results = _rrf_fuse([hyde_results, raw_results])[:k * 2]
        else:
            semantic_results = hyde_results

    # Document-level complement
    doc_index = get_doc_index(index_dir)
    doc_results = []
    if doc_index.total_vectors() > 0:
        doc_results = doc_index.search(raw_query_vector, k=3)

    # Expand doc-level hits into chunk results
    seen_paths = {r["path"] for r in semantic_results}
    for doc in doc_results:
        if doc["path"] in seen_paths:
            continue
        content = _read_file_cached(doc["path"], read_cache)
        if content is None:
            continue
        chunks = chunk_markdown(content, file_path=doc["path"])
        if chunks:
            best = max(chunks, key=lambda c: len(c["text"]))
            best["score"] = doc["score"]
            semantic_results.append(best)
            seen_paths.add(doc["path"])

    # Step 3: BM25 keyword search
    bm25_results = []
    if vault_name:
        bm25_raw = search_fts(vault_name, query, limit=k * 2)
        for r in bm25_raw:
            bm25_results.append({
                "path": r["path"],
                "title": r["title"],
                "breadcrumb": "",
                "start_line": 1,
                "end_line": 1,
                "text": r.get("snippet", ""),
                "score": r["score"],
            })

    # Step 4: RRF fusion of semantic + BM25
    if bm25_results and semantic_results:
        fused = _rrf_fuse([semantic_results, bm25_results])
    elif semantic_results:
        fused = semantic_results
    elif bm25_results:
        fused = bm25_results
    else:
        return []

    # Step 4b: Graph expansion — traverse link graph from entry points
    link_graph = load_link_graph(index_dir)
    if link_graph:
        entry_paths = list({r["path"] for r in fused[:k]})
        expanded = expand_from_entry_points(entry_paths, link_graph)
        graph_results = []
        for path, distance in sorted(expanded.items(), key=lambda x: x[1]):
            if distance == 0:
                continue
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

    # Take top candidates for re-ranking
    candidates = fused[:k * 2]

    # Enrich candidates with fresh file content before re-ranking
    for result in candidates:
        content = _read_file_cached(result["path"], read_cache)
        if content is None:
            continue
        lines = content.split("\n")
        start = max(0, result.get("start_line", 1) - 1)
        end = min(len(lines), result.get("end_line", len(lines)))
        fresh_text = "\n".join(lines[start:end]).strip()
        if fresh_text:
            result["text"] = fresh_text

    # Step 5: LLM re-ranking
    if use_rerank and len(candidates) > 1:
        return _rerank(query, candidates, top_k=k)

    return candidates[:k]


def build_rag_system_prompt(sources: list[dict]) -> str:
    """Build a system prompt that instructs Claude to answer from sources with citations."""
    if not sources:
        return (
            "The user is asking about their knowledge base, but no relevant sources were found. "
            "Let them know you could not find matching content in their vault. "
            "Offer to help if they rephrase their question."
        )

    source_blocks = []
    for i, src in enumerate(sources, 1):
        filename = Path(src["path"]).name
        breadcrumb = src.get("breadcrumb", "")
        location = f" ({breadcrumb})" if breadcrumb else ""
        source_blocks.append(
            f"[Source {i}] {filename} — \"{src['title']}\"{location} (lines {src['start_line']}-{src['end_line']})\n"
            f"{src['text']}"
        )

    sources_text = "\n\n---\n\n".join(source_blocks)

    return f"""You are a knowledge assistant for the user's personal notes vault.
Answer questions based ONLY on the provided context. If the context doesn't contain enough information to answer, say so.
Do not fabricate information. Cite which notes you drew from using [Source N] inline.
Format your response with markdown for readability (headings, lists, code blocks where appropriate).

Context:
---
{sources_text}
---"""
