from server.indexer import chunk_markdown


def test_chunk_by_headings():
    # Needs enough content per section to exceed MIN_CHUNK_WORDS (50)
    content = """---
tags: [test]
---

# Main Title

This is a detailed introduction paragraph that contains enough words to pass the minimum chunk size threshold configured in the system. It discusses several concepts in depth.

## Section One

Content of section one with enough detail to form a complete chunk on its own. This section covers deployment strategies, rolling updates, blue-green deployments, and canary releases for production systems.

## Section Two

Content of section two that also has enough words. It discusses monitoring, alerting, distributed tracing, log aggregation, and observability best practices for cloud-native applications.
"""
    chunks = chunk_markdown(content, file_path="notes/test.md")
    assert len(chunks) >= 2
    assert chunks[0]["path"] == "notes/test.md"
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
    # With 3 sections each having enough words, we get separate chunks with breadcrumbs
    content = """# Top

## Section A

Section A covers deployment strategies including rolling updates, blue-green deployments, canary releases, feature flags, and traffic shifting for zero-downtime releases in production Kubernetes clusters.

## Section B

Section B discusses monitoring and observability including distributed tracing with OpenTelemetry, log aggregation with Loki, metrics collection with Prometheus, alerting rules, and dashboard design for SRE teams managing hundreds of microservices.
"""
    chunks = chunk_markdown(content, file_path="notes/deep.md")
    # File name appears in breadcrumbs
    assert any("deep" in c["breadcrumb"].lower() for c in chunks)
    # At least one chunk has a breadcrumb with hierarchy
    assert any(">" in c["breadcrumb"] for c in chunks)
