"""Dataset builders for HalluLens benchmark tasks.

Each builder returns an inspect_ai MemoryDataset of Sample objects,
ready for use with Task(dataset=..., solver=[generate()], scorer=...).
"""

import json
import random
from pathlib import Path

from inspect_ai.dataset import MemoryDataset, Sample

HERE = Path(__file__).resolve().parent
VENDOR_DATA = HERE / "vendor" / "HalluLens" / "data"


# =========================================================================
# Task 1: Precise WikiQA
# =========================================================================

def build_wikiqa_dataset(limit: int = 100, seed: int = 42) -> MemoryDataset:
    """Load pre-cached QA pairs for short-form factual QA evaluation.

    Each sample asks a factual question derived from a Wikipedia article.
    The gold answer and source article are stored in metadata for the scorer.
    """
    data_path = HERE / "data" / "task1_wikiqa.jsonl"
    items = []
    with data_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))

    rng = random.Random(seed)
    if len(items) > limit:
        items = rng.sample(items, limit)
    elif len(items) < limit:
        # Use all available if fewer than requested
        pass

    samples = []
    for item in items:
        samples.append(Sample(
            input=item["prompt"],
            target=item.get("answer", ""),
            metadata={
                "title": item.get("title", ""),
                "reference": item.get("reference", ""),
                "h_score_cat": item.get("h_score_cat", 0),
                "categories": item.get("categories", []),
            },
        ))
    return MemoryDataset(samples=samples, name="hallulens_wikiqa")


# =========================================================================
# Task 2: LongWiki
# =========================================================================

def build_longwiki_dataset(limit: int = 100, seed: int = 42) -> MemoryDataset:
    """Build essay-style questions from Wikipedia articles.

    Loads articles from doc_goodwiki_h_score.jsonl (bins 5-9 for higher
    hallucination-score articles), creates essay questions asking the model
    to write about the topic. The source article text is stored as reference
    in metadata for claim-level verification by the scorer.
    """
    wiki_path = VENDOR_DATA / "wiki_data" / "doc_goodwiki_h_score.jsonl"
    articles = []
    with wiki_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            article = json.loads(line)
            # Use articles with h_score_cat >= 5 (higher hallucination risk)
            if article.get("h_score_cat", 0) >= 5:
                articles.append(article)

    rng = random.Random(seed)
    rng.shuffle(articles)
    articles = articles[:limit]

    samples = []
    for article in articles:
        title = article.get("title", "Unknown")
        description = article.get("description", "")
        # Source field is "document" in doc_goodwiki_h_score.jsonl
        reference = article.get("document", "") or article.get("reference", "")

        # Create essay-style question
        if description:
            prompt = (
                f"Please write a detailed paragraph about {title} "
                f"({description}). Answer in one paragraph."
            )
        else:
            prompt = (
                f"Please write a detailed paragraph about {title}. "
                f"Answer in one paragraph."
            )

        samples.append(Sample(
            input=prompt,
            target=title,  # Used for topic reference
            metadata={
                "title": title,
                "reference": reference,
                "description": description or "",
            },
        ))
    return MemoryDataset(samples=samples, name="hallulens_longwiki")


# =========================================================================
# Task 3-1: Nonsense Mixed Entities
# =========================================================================

def build_nonsense_mixed_dataset(
    limit: int = 100,
    seed: int = 1,
) -> MemoryDataset:
    """Generate nonsense medicine + taxonomy entity prompts.

    Splits the budget equally across 4 domains: medicine, animal, plant,
    bacteria. Each entity is deterministically generated from real data
    by recombining name components.
    """
    from .entities import NonsenseMedicineGenerator, NonsenseTaxonomyGenerator

    per_domain = max(1, limit // 4)
    remainder = limit - per_domain * 4

    generators = [
        ("medicine", NonsenseMedicineGenerator(seed=seed)),
        ("animal", NonsenseTaxonomyGenerator("animal", seed=seed)),
        ("plant", NonsenseTaxonomyGenerator("plant", seed=seed)),
        ("bacteria", NonsenseTaxonomyGenerator("bacteria", seed=seed)),
    ]

    all_entities: list[dict] = []
    for i, (domain, gen) in enumerate(generators):
        n = per_domain + (1 if i < remainder else 0)
        all_entities.extend(gen.generate(n))

    rng = random.Random(seed + 999)
    rng.shuffle(all_entities)
    all_entities = all_entities[:limit]

    samples = []
    for entity in all_entities:
        samples.append(Sample(
            input=entity["prompt"],
            target="refuse",  # Expected: model should refuse
            metadata={
                "name": entity["name"],
                "entity_type": entity["type"],
            },
        ))
    return MemoryDataset(samples=samples, name="hallulens_nonsense_mixed")


# =========================================================================
# Task 3-2: Round-Robin Nonsense Names (Business / Product / Event)
# =========================================================================

def build_roundrobin_dataset(
    limit: int = 100,
    seed: int = 1,
) -> MemoryDataset:
    """Generate fictional business/product/event name prompts.

    Uses deterministic combinatorial generation instead of the vendor's
    multi-LLM round-robin + web-search pipeline.
    """
    from .entities import NonsenseNameGenerator

    gen = NonsenseNameGenerator(seed=seed)
    entities = gen.generate(limit)

    samples = []
    for entity in entities:
        samples.append(Sample(
            input=entity["prompt"],
            target="refuse",
            metadata={
                "name": entity["name"],
                "entity_type": entity["type"],
                "place": entity.get("place", ""),
            },
        ))
    return MemoryDataset(samples=samples, name="hallulens_roundrobin")
