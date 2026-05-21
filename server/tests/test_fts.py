from server.fts import FTSIndex, tokenize


def test_tokenize_basic():
    tokens = tokenize("Hello World! This is a test.")
    assert "hello" in tokens
    assert "world" in tokens
    assert "test" in tokens
    assert "this" not in tokens
    assert "is" not in tokens


def test_fts_add_and_search():
    idx = FTSIndex()
    idx.add_doc("notes/k8s.md", "Kubernetes Deployment", "Deploy containers to production using kubectl apply.")
    idx.add_doc("notes/docker.md", "Docker Basics", "Build container images with Dockerfile.")

    results = idx.search("deploy containers")
    assert len(results) >= 1
    assert results[0]["path"] == "notes/k8s.md"


def test_fts_remove_doc():
    idx = FTSIndex()
    idx.add_doc("notes/a.md", "Alpha", "First document content.")
    idx.add_doc("notes/b.md", "Beta", "Second document content.")
    idx.remove_doc("notes/a.md")

    results = idx.search("first")
    assert len(results) == 0


def test_fts_title_boost():
    idx = FTSIndex()
    idx.add_doc("notes/auth.md", "Authentication Guide", "This covers login flows.")
    idx.add_doc("notes/other.md", "Other Topic", "Authentication is mentioned here once.")

    results = idx.search("authentication")
    assert results[0]["path"] == "notes/auth.md"
