"""indexer.py — Chunking, embedding, and FAISS index management for Satori RAG."""

import functools
import hashlib
import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

logger = logging.getLogger("satori.indexer")

import boto3
import faiss
import numpy as np

from server.config import (
    EMBED_DIM, MIN_CHUNK_WORDS, EMBED_BATCH_SIZE,
    TEXT_TRUNCATE_CHARS, SIMILARITY_THRESHOLD,
    BEDROCK_EMBED_MODEL, AWS_REGION, CHUNK_OVERLAP_LINES,
)


def _build_breadcrumb(heading_stack: list[str]) -> str:
    """Build a breadcrumb string from the current heading ancestry."""
    if not heading_stack:
        return ""
    return " > ".join(heading_stack)


def chunk_markdown(content: str, file_path: str) -> list[dict[str, Any]]:
    """Split markdown content into chunks by heading boundaries.

    Each chunk contains:
      - path: source file path
      - title: heading text (or filename if no headings)
      - breadcrumb: heading ancestry trail for context
      - start_line: 1-based line number where chunk begins
      - end_line: 1-based line number where chunk ends
      - text: the chunk content (breadcrumb prefix + heading + body)
    """
    # Strip frontmatter
    body = content
    offset = 0
    if content.startswith("---"):
        end = content.find("\n---", 3)
        if end != -1:
            body = content[end + 4:]
            offset = content[:end + 4].count("\n")
            leading_newlines = len(body) - len(body.lstrip("\n"))
            offset += leading_newlines

    lines = body.lstrip("\n").split("\n")
    # Find heading positions with their levels
    headings: list[tuple[int, int, str]] = []
    for i, line in enumerate(lines):
        m = re.match(r"^(#{1,6})\s+(.+)$", line)
        if m:
            headings.append((i, len(m.group(1)), m.group(2).strip()))

    filename = Path(file_path).stem

    if not headings:
        text = body.strip()
        if not text:
            return []
        return [{
            "path": file_path,
            "title": filename,
            "breadcrumb": filename,
            "start_line": offset + 1,
            "end_line": offset + len(lines),
            "text": text,
        }]

    # Build chunks with heading breadcrumbs and overlap
    raw_chunks: list[dict[str, Any]] = []
    heading_stack: list[tuple[int, str]] = []

    for idx, (line_idx, level, title) in enumerate(headings):
        # Maintain a stack of ancestor headings
        while heading_stack and heading_stack[-1][0] >= level:
            heading_stack.pop()
        breadcrumb_parts = [filename] + [h[1] for h in heading_stack] + [title]
        breadcrumb = " > ".join(breadcrumb_parts)
        heading_stack.append((level, title))

        start = line_idx
        end = headings[idx + 1][0] if idx + 1 < len(headings) else len(lines)
        chunk_lines = lines[start:end]
        chunk_text = "\n".join(chunk_lines).strip()

        # Add overlap from previous chunk's trailing lines
        if idx > 0 and CHUNK_OVERLAP_LINES > 0:
            prev_end = start
            prev_start = headings[idx - 1][0]
            prev_lines = lines[prev_start:prev_end]
            overlap = prev_lines[-CHUNK_OVERLAP_LINES:]
            if overlap:
                overlap_text = "\n".join(overlap).strip()
                if overlap_text:
                    chunk_text = overlap_text + "\n\n" + chunk_text

        # Prepend breadcrumb as context for the embedding
        text_with_context = f"[{breadcrumb}]\n{chunk_text}"

        raw_chunks.append({
            "path": file_path,
            "title": title,
            "breadcrumb": breadcrumb,
            "start_line": offset + start + 2,
            "end_line": offset + end,
            "text": text_with_context,
        })

    # Merge small chunks with the next one
    merged: list[dict[str, Any]] = []
    i = 0
    while i < len(raw_chunks):
        chunk = raw_chunks[i]
        while len(chunk["text"].split()) < MIN_CHUNK_WORDS and i + 1 < len(raw_chunks):
            i += 1
            next_chunk = raw_chunks[i]
            chunk["text"] += "\n\n" + next_chunk["text"]
            chunk["end_line"] = next_chunk["end_line"]
        merged.append(chunk)
        i += 1

    return merged


@functools.lru_cache(maxsize=128)
def _embed_single_cached(text: str, region: str, model_id: str) -> tuple:
    """Embed a single text and return the result as a tuple (hashable for LRU cache).

    This cache benefits repeated queries (search, RAG) but is bypassed for bulk
    indexing which goes through the batch path in embed_texts().
    """
    client = boto3.client("bedrock-runtime", region_name=region)
    for char_limit in [TEXT_TRUNCATE_CHARS, 12000, 6000]:
        truncated = text[:char_limit]
        body = json.dumps({
            "inputText": truncated,
            "dimensions": 1024,
            "normalize": True,
        })
        try:
            response = client.invoke_model(modelId=model_id, body=body)
            response_body = json.loads(response["body"].read())
            return tuple(response_body["embedding"])
        except client.exceptions.ValidationException:
            logger.warning("Text too long at %d chars, retrying shorter", char_limit)
            continue
    raise RuntimeError(f"Failed to embed text even at 6000 chars")


_EMBED_THREAD_POOL = ThreadPoolExecutor(max_workers=8)


def _embed_one(client, model_id: str, text: str) -> list[float]:
    """Embed a single text via Bedrock. Used as a unit of work for parallel execution.

    Retries with progressively shorter text if the input exceeds token limits.
    """
    for char_limit in [TEXT_TRUNCATE_CHARS, 12000, 6000]:
        truncated = text[:char_limit]
        body = json.dumps({
            "inputText": truncated,
            "dimensions": 1024,
            "normalize": True,
        })
        try:
            response = client.invoke_model(modelId=model_id, body=body)
            response_body = json.loads(response["body"].read())
            return response_body["embedding"]
        except client.exceptions.ValidationException:
            logger.warning("Text too long at %d chars, retrying shorter", char_limit)
            continue
    raise RuntimeError(f"Failed to embed text even at 6000 chars (first 80: {text[:80]})")


def embed_texts(texts: list[str], region: str | None = None) -> np.ndarray:
    """Embed texts using AWS Bedrock Titan Embeddings V2.

    For single texts the result is served from an LRU cache when possible
    (helps repeated search/RAG queries). Batches are embedded in parallel
    using a thread pool to maximize throughput during bulk indexing.

    Args:
        texts: List of strings to embed
        region: AWS region (defaults to AWS_REGION env var or us-east-1)

    Returns:
        numpy array of shape (len(texts), 1024)
    """
    model_id = BEDROCK_EMBED_MODEL
    region = region or AWS_REGION

    # Single-text fast path — use LRU cache
    if len(texts) == 1:
        vec = _embed_single_cached(texts[0], region, model_id)
        return np.array([vec], dtype="float32")

    # Batch path — parallel Bedrock calls via thread pool
    client = boto3.client("bedrock-runtime", region_name=region)
    embeddings: list[tuple[int, list[float]]] = []
    futures = {
        _EMBED_THREAD_POOL.submit(_embed_one, client, model_id, text): i
        for i, text in enumerate(texts)
    }
    for future in as_completed(futures):
        idx = futures[future]
        embeddings.append((idx, future.result()))

    embeddings.sort(key=lambda x: x[0])
    return np.array([e[1] for e in embeddings], dtype="float32")


class BaseIndex:
    """Base FAISS index with metadata sidecar. Shared by chunk and document indices."""

    def __init__(self, index_dir: str, index_file: str, meta_file: str):
        self.index_dir = Path(index_dir)
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self._index_file = index_file
        self._meta_file = meta_file

        base_index = faiss.IndexFlatIP(EMBED_DIM)
        self._index = faiss.IndexIDMap(base_index)
        self._meta: dict[int, dict] = {}
        self._next_id: int = 0

    def total_vectors(self) -> int:
        return self._index.ntotal

    def remove_by_path(self, file_path: str) -> None:
        ids_to_remove = [
            vid for vid, meta in self._meta.items()
            if meta["path"] == file_path
        ]
        if not ids_to_remove:
            return
        self._index.remove_ids(np.array(ids_to_remove, dtype="int64"))
        for vid in ids_to_remove:
            del self._meta[vid]

    def search(self, query_vector: np.ndarray, k: int = 5, threshold: float = SIMILARITY_THRESHOLD) -> list[dict]:
        if self._index.ntotal == 0:
            return []
        k = min(k, self._index.ntotal)
        scores, indices = self._index.search(query_vector, k)
        results = []
        for i in range(k):
            vid = int(indices[0][i])
            score = float(scores[0][i])
            if score < threshold:
                continue
            if vid in self._meta:
                result = self._meta[vid].copy()
                result["score"] = score
                results.append(result)
        return results

    def save(self) -> None:
        faiss.write_index(self._index, str(self.index_dir / self._index_file))
        with open(self.index_dir / self._meta_file, "w") as f:
            json.dump({"next_id": self._next_id, "meta": self._meta}, f, indent=2)

    def load(self) -> bool:
        index_path = self.index_dir / self._index_file
        meta_path = self.index_dir / self._meta_file
        if not index_path.exists() or not meta_path.exists():
            return False
        self._index = faiss.read_index(str(index_path))
        with open(meta_path, "r") as f:
            data = json.load(f)
        self._next_id = data["next_id"]
        self._meta = {int(k): v for k, v in data["meta"].items()}
        return True


class VaultIndex(BaseIndex):
    """Chunk-level FAISS index — one embedding per heading section."""

    def __init__(self, index_dir: str):
        super().__init__(index_dir, "index.faiss", "index_meta.json")

    def add(self, chunks: list[dict], vectors: np.ndarray) -> None:
        num_chunks = len(chunks)
        ids = np.arange(self._next_id, self._next_id + num_chunks, dtype="int64")
        self._index.add_with_ids(vectors, ids)
        for i, chunk in enumerate(chunks):
            chunk_id = int(ids[i])
            meta_entry = {
                "path": chunk["path"],
                "title": chunk["title"],
                "breadcrumb": chunk.get("breadcrumb", ""),
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"],
                "text": chunk["text"][:500],
            }
            if "content_hash" in chunk:
                meta_entry["content_hash"] = chunk["content_hash"]
            self._meta[chunk_id] = meta_entry
        self._next_id += num_chunks


class DocIndex(BaseIndex):
    """Document-level FAISS index — one embedding per file for broad relevance matching."""

    def __init__(self, index_dir: str):
        super().__init__(index_dir, "doc_index.faiss", "doc_index_meta.json")

    def add(self, path: str, content_hash: str, vector: np.ndarray) -> None:
        doc_id = np.array([self._next_id], dtype="int64")
        self._index.add_with_ids(vector.reshape(1, -1), doc_id)
        self._meta[self._next_id] = {"path": path, "content_hash": content_hash}
        self._next_id += 1


def build_vault_index(vault_path: str, index_dir: str) -> dict[str, int]:
    """Scan a vault directory, chunk all markdown files, embed, and build both indices.

    Returns stats: {files_indexed, total_chunks}.
    """
    vault = Path(vault_path)
    chunk_index = VaultIndex(index_dir=index_dir)
    doc_index = DocIndex(index_dir=index_dir)

    all_chunks: list[dict[str, Any]] = []
    doc_texts: list[tuple[str, str, str]] = []  # (path, content_hash, text)

    for md_file in vault.rglob("*.md"):
        # Skip hidden files and directories
        parts = md_file.relative_to(vault).parts
        if any(p.startswith(".") for p in parts):
            continue

        try:
            content = md_file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue

        chunks = chunk_markdown(content, file_path=str(md_file))
        all_chunks.extend(chunks)
        doc_texts.append((str(md_file), _content_hash(content), content))

    if not all_chunks:
        chunk_index.save()
        doc_index.save()
        return {"files_indexed": 0, "total_chunks": 0}

    # Embed chunks in batches
    texts = [c["text"] for c in all_chunks]
    all_vectors: list[np.ndarray] = []

    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i:i + EMBED_BATCH_SIZE]
        vectors = embed_texts(batch)
        all_vectors.append(vectors)

    vectors_array = np.vstack(all_vectors)
    chunk_index.add(all_chunks, vectors_array)
    chunk_index.save()

    # Embed documents (full file content) in batches
    doc_contents = [t[2] for t in doc_texts]
    doc_vectors: list[np.ndarray] = []

    for i in range(0, len(doc_contents), EMBED_BATCH_SIZE):
        batch = doc_contents[i:i + EMBED_BATCH_SIZE]
        vectors = embed_texts(batch)
        doc_vectors.append(vectors)

    doc_vectors_array = np.vstack(doc_vectors)
    for i, (path, content_hash, _) in enumerate(doc_texts):
        doc_index.add(path, content_hash, doc_vectors_array[i])
    doc_index.save()

    # Populate the in-memory cache with the freshly built indices
    _chunk_indices[index_dir] = chunk_index
    _doc_indices[index_dir] = doc_index

    files_indexed = len(set(c["path"] for c in all_chunks))
    logger.info("Built vault index: %d files, %d chunks", files_indexed, len(all_chunks))
    return {"files_indexed": files_indexed, "total_chunks": len(all_chunks)}


# ---------------------------------------------------------------------------
# In-memory index cache — avoids disk I/O on every search/reindex
# ---------------------------------------------------------------------------

_chunk_indices: dict[str, VaultIndex] = {}
_doc_indices: dict[str, DocIndex] = {}


def get_chunk_index(index_dir: str) -> VaultIndex:
    """Get or load the cached chunk index for an index directory."""
    if index_dir not in _chunk_indices:
        idx = VaultIndex(index_dir=index_dir)
        idx.load()
        _chunk_indices[index_dir] = idx
    return _chunk_indices[index_dir]


def get_doc_index(index_dir: str) -> DocIndex:
    """Get or load the cached document index for an index directory."""
    if index_dir not in _doc_indices:
        idx = DocIndex(index_dir=index_dir)
        idx.load()
        _doc_indices[index_dir] = idx
    return _doc_indices[index_dir]


def _content_hash(content: str) -> str:
    """Compute a short hash of content for cache invalidation."""
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def reindex_file(index_dir: str, file_path: str, content: str) -> bool:
    """Re-index a single file in both chunk and document indices. Returns True if content changed."""
    if not content.strip():
        return False

    chunk_index = get_chunk_index(index_dir)

    # Check if content has changed via hash
    new_hash = _content_hash(content)
    existing_hashes = {
        meta.get("content_hash")
        for meta in chunk_index._meta.values()
        if meta["path"] == file_path
    }
    if existing_hashes and all(h == new_hash for h in existing_hashes):
        return False

    # Update chunk index
    chunk_index.remove_by_path(file_path)
    chunks = chunk_markdown(content, file_path=file_path)
    if chunks:
        texts = [c["text"] for c in chunks]
        vectors = embed_texts(texts)
        for c in chunks:
            c["content_hash"] = new_hash
        chunk_index.add(chunks, vectors)
    chunk_index.save()

    # Update document index
    doc_index = get_doc_index(index_dir)
    doc_index.remove_by_path(file_path)
    doc_vector = embed_texts([content])
    doc_index.add(file_path, new_hash, doc_vector[0])
    doc_index.save()
    return True


def remove_file_from_index(index_dir: str, file_path: str) -> None:
    """Remove all index entries for a deleted file from both indices."""
    chunk_index = get_chunk_index(index_dir)
    chunk_index.remove_by_path(file_path)
    chunk_index.save()

    doc_index = get_doc_index(index_dir)
    doc_index.remove_by_path(file_path)
    doc_index.save()


def reconcile_vault_index(vault_path: str, index_dir: str) -> dict[str, int]:
    """Reconcile FAISS indices against actual vault files on disk.

    Compares content hashes to detect new, changed, and deleted files.
    Only embeds the diff — no Bedrock calls if nothing changed.

    Returns stats: {added, updated, removed, unchanged}.
    """
    vault = Path(vault_path)
    chunk_index = get_chunk_index(index_dir)
    doc_index = get_doc_index(index_dir)

    disk_files: dict[str, tuple[str, str]] = {}
    for md_file in vault.rglob("*.md"):
        parts = md_file.relative_to(vault).parts
        if any(p.startswith(".") for p in parts):
            continue
        try:
            content = md_file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        disk_files[str(md_file)] = (_content_hash(content), content)

    indexed_hashes: dict[str, set[str]] = {}
    for meta in chunk_index._meta.values():
        path = meta["path"]
        h = meta.get("content_hash", "")
        indexed_hashes.setdefault(path, set()).add(h)

    added = 0
    updated = 0
    removed = 0
    unchanged = 0

    indexed_all = set(indexed_hashes.keys())
    disk_all = set(disk_files.keys())
    for path in indexed_all - disk_all:
        chunk_index.remove_by_path(path)
        doc_index.remove_by_path(path)
        removed += 1

    files_to_index: list[tuple[str, str, str]] = []
    for path, (content_hash, content) in disk_files.items():
        if path not in indexed_hashes:
            files_to_index.append((path, content_hash, content))
            added += 1
        elif content_hash not in indexed_hashes[path]:
            chunk_index.remove_by_path(path)
            doc_index.remove_by_path(path)
            files_to_index.append((path, content_hash, content))
            updated += 1
        else:
            unchanged += 1

    if files_to_index:
        all_chunks: list[dict[str, Any]] = []
        doc_texts: list[tuple[str, str, str]] = []
        for path, content_hash, content in files_to_index:
            if not content.strip():
                logger.info("Skipping empty file: %s", path)
                continue
            chunks = chunk_markdown(content, file_path=path)
            for c in chunks:
                c["content_hash"] = content_hash
            all_chunks.extend(chunks)
            doc_texts.append((path, content_hash, content))

        if all_chunks:
            texts = [c["text"] for c in all_chunks]
            all_vectors: list[np.ndarray] = []
            for i in range(0, len(texts), EMBED_BATCH_SIZE):
                batch = texts[i:i + EMBED_BATCH_SIZE]
                vectors = embed_texts(batch)
                all_vectors.append(vectors)
            vectors_array = np.vstack(all_vectors)
            chunk_index.add(all_chunks, vectors_array)

        if doc_texts:
            doc_contents = [t[2] for t in doc_texts]
            doc_vectors: list[np.ndarray] = []
            for i in range(0, len(doc_contents), EMBED_BATCH_SIZE):
                batch = doc_contents[i:i + EMBED_BATCH_SIZE]
                vectors = embed_texts(batch)
                doc_vectors.append(vectors)
            doc_vectors_array = np.vstack(doc_vectors)
            for i, (path, content_hash, _) in enumerate(doc_texts):
                doc_index.add(path, content_hash, doc_vectors_array[i])

    if added or updated or removed:
        chunk_index.save()
        doc_index.save()
        logger.info("Reconciled index: +%d added, ~%d updated, -%d removed, =%d unchanged",
                     added, updated, removed, unchanged)
    else:
        logger.info("Index up to date: %d files unchanged", unchanged)

    return {"added": added, "updated": updated, "removed": removed, "unchanged": unchanged}
