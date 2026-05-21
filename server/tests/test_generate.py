from server.generate import build_summary_prompt, build_faq_prompt, build_concept_map_prompt


def test_build_summary_prompt():
    sources = [{"path": "a.md", "title": "Alpha", "text": "Content about alpha."}]
    prompt = build_summary_prompt(sources)
    assert "summary" in prompt.lower() or "summarize" in prompt.lower()
    assert "Content about alpha" in prompt
    assert "Source" in prompt


def test_build_faq_prompt():
    sources = [{"path": "b.md", "title": "Beta", "text": "Detailed explanation of beta."}]
    prompt = build_faq_prompt(sources)
    assert "question" in prompt.lower() or "FAQ" in prompt
    assert "Detailed explanation" in prompt


def test_build_concept_map_prompt():
    sources = [
        {"path": "a.md", "title": "Auth", "text": "Auth handles login."},
        {"path": "b.md", "title": "RBAC", "text": "RBAC manages permissions."},
    ]
    prompt = build_concept_map_prompt(sources)
    assert "mermaid" in prompt.lower() or "diagram" in prompt.lower()
    assert "Auth" in prompt
    assert "RBAC" in prompt
