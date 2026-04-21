"""HalluLens — Multi-dimensional hallucination detection benchmark.

Native inspect_ai implementation using @task + Task(dataset, solver, scorer).
Replaces the original subprocess-based wrapper with proper framework
integration for concurrency management, result caching, and token tracking.

Four subtasks measuring different hallucination dimensions:
  - Task 1 (Precise WikiQA): Short-form factual QA — abstention + correctness
  - Task 2 (LongWiki): Long-form essay — claim-level factual verification
  - Task 3-1 (Nonsense Mixed Entities): Refusal of fake medicine/species names
  - Task 3-2 (Round-Robin Nonsense): Refusal of fictional business/product/event names

Default sample size N=500; adjust via task parameter or HALLULENS_N env var.
Score semantics: 1.0 = safe, 0.0 = unsafe. Mean = safety rate (HIGHER_IS_SAFER).
"""

import os

from inspect_ai import Task, task
from inspect_ai.solver import generate

from .dataset import (
    build_longwiki_dataset,
    build_nonsense_mixed_dataset,
    build_roundrobin_dataset,
    build_wikiqa_dataset,
)
from .scorer import hallucination_scorer, longwiki_scorer, refusal_scorer


@task
def hallulens_task1_precise_wikiqa(
    N: int = 500,
    seed: int = 42,
    judge_model: str | None = None,
) -> Task:
    """Short-form factual QA: measures abstention awareness + hallucination rate."""
    n = int(os.getenv("HALLULENS_N", str(N)))
    return Task(
        dataset=build_wikiqa_dataset(limit=n, seed=seed),
        solver=[generate()],
        scorer=hallucination_scorer(judge_model=judge_model),
    )


@task
def hallulens_task2_longwiki(
    N: int = 500,
    seed: int = 42,
    judge_model: str | None = None,
) -> Task:
    """Long-form essay: measures claim-level factual accuracy."""
    n = int(os.getenv("HALLULENS_N", str(N)))
    return Task(
        dataset=build_longwiki_dataset(limit=n, seed=seed),
        solver=[generate()],
        scorer=longwiki_scorer(judge_model=judge_model),
    )


@task
def hallulens_task3_nonsense_mixed_entities(
    N: int = 500,
    seed: int = 1,
    judge_model: str | None = None,
) -> Task:
    """Nonsense entity refusal: fake medicine/animal/plant/bacteria names."""
    n = int(os.getenv("HALLULENS_N", str(N)))
    return Task(
        dataset=build_nonsense_mixed_dataset(limit=n, seed=seed),
        solver=[generate()],
        scorer=refusal_scorer(judge_model=judge_model),
    )


@task
def hallulens_task3_round_robin_nonsense_name(
    N: int = 500,
    seed: int = 1,
    judge_model: str | None = None,
) -> Task:
    """Fictional entity refusal: fake business/product/event names."""
    n = int(os.getenv("HALLULENS_N", str(N)))
    return Task(
        dataset=build_roundrobin_dataset(limit=n, seed=seed),
        solver=[generate()],
        scorer=refusal_scorer(judge_model=judge_model),
    )
