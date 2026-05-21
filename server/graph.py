"""Link graph builder and BFS traversal for graph-enhanced RAG."""

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
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        if not target.endswith(".md"):
            continue
        target = target.split("#")[0]
        resolved = str(Path(file_dir) / target)
        if ".." in resolved:
            resolved = str(Path(resolved).resolve())
        resolved = str(Path(resolved))
        links.append(resolved)

    return links


def build_link_graph(files: dict[str, str]) -> dict[str, dict]:
    """Build a link graph from a dict of {file_path: content}.

    Returns: {path: {"outgoing": [...], "backlinks": [...], "tags": [...], "folder": "..."}}
    """
    graph: dict[str, dict] = {}

    for path in files:
        folder = str(Path(path).parent)
        graph[path] = {"outgoing": [], "backlinks": [], "tags": [], "folder": folder}

    for path, content in files.items():
        outgoing = parse_links(content, path)
        valid_outgoing = [link for link in outgoing if link in graph]
        graph[path]["outgoing"] = valid_outgoing

    for path, node in graph.items():
        for target in node["outgoing"]:
            if target in graph and path not in graph[target]["backlinks"]:
                graph[target]["backlinks"].append(path)

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
    """BFS expand from entry points, returning {path: distance}."""
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
