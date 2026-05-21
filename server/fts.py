"""fts.py — BM25-scored full-text search for Satori vault files."""

import json
import logging
import math
import re
import unicodedata
from pathlib import Path

from server.config import BM25_K1, BM25_B, INDEX_DIR

logger = logging.getLogger("satori.fts")

STOP_WORDS = frozenset({
    "the", "is", "at", "which", "on", "a", "an", "and", "or", "but",
    "in", "with", "to", "for", "of", "not", "no", "be", "are", "was",
    "were", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "may", "might", "shall", "can",
    "this", "that", "these", "those", "it", "its", "from", "by", "as",
    "if", "then", "than", "so",
})


def tokenize(text: str) -> list[str]:
    lower = text.lower()
    words = re.findall(r"[a-z0-9]+", lower)
    return [w for w in words if len(w) >= 2 and w not in STOP_WORDS]


def strip_frontmatter(content: str) -> str:
    if not content.startswith("---"):
        return content
    end = content.find("\n---", 3)
    if end == -1:
        return content
    return content[end + 4:].lstrip("\n")


class FTSIndex:
    """BM25 full-text search index with optional disk persistence."""

    def __init__(self, index_dir: str | None = None):
        self._index: dict[str, list[tuple[str, int]]] = {}  # term -> [(path, tf)]
        self._doc_len: dict[str, int] = {}
        self._titles: dict[str, str] = {}
        self._bodies: dict[str, str] = {}
        self._doc_count: int = 0
        self._avg_dl: float = 0.0
        self._index_dir: str | None = index_dir

    def add_doc(self, path: str, title: str, body: str) -> None:
        self.remove_doc(path)
        tokens = tokenize(title + " " + body)
        tf: dict[str, int] = {}
        for t in tokens:
            tf[t] = tf.get(t, 0) + 1

        self._doc_len[path] = len(tokens)
        self._titles[path] = title
        self._bodies[path] = body
        self._doc_count += 1
        self._avg_dl = sum(self._doc_len.values()) / self._doc_count

        for term, count in tf.items():
            if term not in self._index:
                self._index[term] = []
            self._index[term].append((path, count))

    def remove_doc(self, path: str) -> None:
        if path not in self._doc_len:
            return
        del self._doc_len[path]
        self._titles.pop(path, None)
        self._bodies.pop(path, None)
        self._doc_count -= 1

        for term in list(self._index.keys()):
            self._index[term] = [(p, c) for p, c in self._index[term] if p != path]
            if not self._index[term]:
                del self._index[term]

        if self._doc_count > 0:
            self._avg_dl = sum(self._doc_len.values()) / self._doc_count
        else:
            self._avg_dl = 0.0

    def search(self, query: str, limit: int = 20) -> list[dict]:
        terms = tokenize(query)
        if not terms:
            return []

        scores: dict[str, float] = {}

        for term in terms:
            postings = self._index.get(term)
            if not postings:
                continue
            df = len(postings)
            idf = math.log(1 + (self._doc_count - df + 0.5) / (df + 0.5))

            for path, tf in postings:
                dl = self._doc_len[path]
                tf_norm = tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / self._avg_dl))
                scores[path] = scores.get(path, 0.0) + idf * tf_norm

        # Boost title matches and determine field
        query_lower = query.lower()
        match_fields: dict[str, str] = {}
        for path in list(scores.keys()):
            title = self._titles.get(path, "")
            if query_lower in title.lower():
                scores[path] *= 3.0
                match_fields[path] = "title"
            else:
                # Check headings in body
                body = self._bodies.get(path, "")
                found_heading = False
                for line in body.split("\n"):
                    if line.startswith("#") and query_lower in line.lower():
                        match_fields[path] = "heading"
                        found_heading = True
                        break
                if not found_heading:
                    match_fields[path] = "content"

        ranked = sorted(scores.items(), key=lambda x: -x[1])[:limit]
        out = []
        for path, score in ranked:
            snippet = self._extract_snippet(path, terms)
            out.append({
                "path": path,
                "title": self._titles.get(path, ""),
                "score": score,
                "field": match_fields.get(path, "content"),
                "snippet": snippet,
            })
        return out

    def _extract_snippet(self, path: str, terms: list[str]) -> str:
        body = self._bodies.get(path, "")
        if not body:
            return ""
        lower = body.lower()
        best_pos = -1
        for t in terms:
            pos = lower.find(t)
            if pos != -1 and (best_pos == -1 or pos < best_pos):
                best_pos = pos
        if best_pos == -1:
            return body[:150] + "..." if len(body) > 150 else body
        start = max(0, best_pos - 60)
        end = min(len(body), best_pos + 90)
        snippet = body[start:end].strip()
        if start > 0:
            snippet = "..." + snippet
        if end < len(body):
            snippet = snippet + "..."
        return snippet

    def save(self) -> None:
        """Persist the FTS index to disk as JSON."""
        if not self._index_dir:
            return
        dir_path = Path(self._index_dir)
        dir_path.mkdir(parents=True, exist_ok=True)
        data = {
            "index": {term: postings for term, postings in self._index.items()},
            "doc_len": self._doc_len,
            "titles": self._titles,
            "bodies": self._bodies,
            "doc_count": self._doc_count,
            "avg_dl": self._avg_dl,
        }
        path = dir_path / "fts_index.json"
        try:
            path.write_text(json.dumps(data), encoding="utf-8")
        except OSError as e:
            logger.warning("Failed to save FTS index to %s: %s", path, e)

    def load(self) -> bool:
        """Load the FTS index from disk. Returns True on success."""
        if not self._index_dir:
            return False
        path = Path(self._index_dir) / "fts_index.json"
        if not path.exists():
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self._index = {
                term: [tuple(pair) for pair in postings]
                for term, postings in data["index"].items()
            }
            self._doc_len = data["doc_len"]
            self._titles = data["titles"]
            self._bodies = data["bodies"]
            self._doc_count = data["doc_count"]
            self._avg_dl = data["avg_dl"]
            return True
        except (OSError, json.JSONDecodeError, KeyError) as e:
            logger.warning("Failed to load FTS index from %s: %s", path, e)
            return False

    def doc_count(self) -> int:
        return self._doc_count


# Global FTS index instances per vault
_vault_indices: dict[str, FTSIndex] = {}


def _fts_index_dir(vault_name: str) -> str:
    """Return the storage directory for the FTS index."""
    return INDEX_DIR


def get_fts_index(vault_name: str) -> FTSIndex:
    if vault_name not in _vault_indices:
        _vault_indices[vault_name] = FTSIndex(index_dir=_fts_index_dir(vault_name))
    return _vault_indices[vault_name]


def build_fts_index(vault_name: str, vault_path: str) -> int:
    """Scan vault and build the FTS index. Returns number of documents indexed."""
    index_dir = _fts_index_dir(vault_name)
    index = FTSIndex(index_dir=index_dir)
    vault = Path(vault_path)

    for md_file in vault.rglob("*.md"):
        parts = md_file.relative_to(vault).parts
        if any(p.startswith(".") for p in parts):
            continue
        try:
            content = md_file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue

        body = strip_frontmatter(content)
        title = md_file.stem
        # Extract title from first H1
        for line in body.split("\n"):
            if line.startswith("# "):
                title = line[2:].strip()
                break

        index.add_doc(str(md_file), title, body)

    _vault_indices[vault_name] = index
    index.save()
    return index.doc_count()


def index_file(vault_name: str, file_path: str, content: str) -> None:
    """Add or update a single file in the FTS index."""
    index = get_fts_index(vault_name)
    body = strip_frontmatter(content)
    title = Path(file_path).stem
    for line in body.split("\n"):
        if line.startswith("# "):
            title = line[2:].strip()
            break
    index.add_doc(file_path, title, body)
    index.save()


def remove_from_fts(vault_name: str, file_path: str) -> None:
    """Remove a file from the FTS index."""
    index = get_fts_index(vault_name)
    index.remove_doc(file_path)
    index.save()


def search_fts(vault_name: str, query: str, limit: int = 20) -> list[dict]:
    """Search the FTS index for a vault."""
    index = get_fts_index(vault_name)
    return index.search(query, limit=limit)
