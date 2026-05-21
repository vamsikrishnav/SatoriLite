"""Structured output generation (summary, FAQ, concept map, study guide)."""

import logging

import boto3

from server.config import AWS_REGION, BEDROCK_MODEL_ID

logger = logging.getLogger("satorilite.generate")


def _format_sources_block(sources: list[dict]) -> str:
    """Format sources into numbered blocks for prompt injection."""
    blocks = []
    for i, src in enumerate(sources, 1):
        title = src.get("title", "Untitled")
        text = src.get("text", "")
        blocks.append(f"[Source {i}] {src['path']} — \"{title}\"\n{text}")
    return "\n\n---\n\n".join(blocks)


def build_summary_prompt(sources: list[dict]) -> str:
    sources_text = _format_sources_block(sources)
    return f"""Based on the following knowledge base content, generate a structured summary.

Requirements:
- Organize by theme/topic, not by source order.
- Use markdown headings (##) for each theme.
- Under each theme, 3-5 bullet points capturing key information.
- Cite sources using [Source N] inline.
- Be comprehensive but concise.

Sources:
---
{sources_text}
---"""


def build_faq_prompt(sources: list[dict]) -> str:
    sources_text = _format_sources_block(sources)
    return f"""Based on the following knowledge base content, generate a FAQ (5-10 questions and answers).

Requirements:
- Questions should cover the most important concepts, common confusions, and practical "how do I..." queries.
- Each answer must cite which source it draws from using [Source N].
- Format as markdown with ## for each question.
- Answers should be concise (2-4 sentences).

Sources:
---
{sources_text}
---"""


def build_concept_map_prompt(sources: list[dict]) -> str:
    sources_text = _format_sources_block(sources)
    return f"""Based on the following knowledge base content, generate a concept map as a Mermaid diagram.

Requirements:
- Use `flowchart TD` syntax.
- Nodes represent key concepts, systems, or entities mentioned in the sources.
- Edges represent relationships (links to, depends on, part of, uses).
- Label edges with the relationship type.
- Include 8-15 nodes maximum.
- After the diagram, provide a brief legend explaining the key relationships.

Sources:
---
{sources_text}
---"""


def build_study_guide_prompt(sources: list[dict]) -> str:
    sources_text = _format_sources_block(sources)
    return f"""Based on the following knowledge base content, generate a study guide.

Requirements:
- Present as an ordered learning path (numbered sections).
- Each section: heading + 2-3 key takeaways + one "check your understanding" question.
- Cite sources using [Source N].
- Start with fundamentals, build to advanced topics.
- End with a "what to read next" section.

Sources:
---
{sources_text}
---"""


PROMPT_BUILDERS = {
    "summary": build_summary_prompt,
    "faq": build_faq_prompt,
    "concept-map": build_concept_map_prompt,
    "study-guide": build_study_guide_prompt,
}


def generate_structured_output(output_type: str, sources: list[dict], model_id: str | None = None) -> str:
    """Generate a structured output from sources using Bedrock."""
    builder = PROMPT_BUILDERS.get(output_type)
    if not builder:
        raise ValueError(f"Unknown output type: {output_type}. Valid: {list(PROMPT_BUILDERS.keys())}")

    prompt = builder(sources)
    model = model_id or BEDROCK_MODEL_ID

    client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    response = client.converse(
        modelId=model,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": 2000, "temperature": 0.3},
    )
    return response["output"]["message"]["content"][0]["text"]
