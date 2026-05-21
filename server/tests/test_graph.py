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
    # resolve() makes it absolute, so check it ends correctly
    assert any(link.endswith("notes/parent.md") for link in links)


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
    assert "d.md" not in expanded


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
    assert len(expanded) == 2
