"""
PersonalizedSafety: Evaluating LLM Safety in High-Risk Personalized Scenarios

Wu et al. "Personalized Safety in LLMs: A Benchmark and A Planning-Based Agent Approach"
https://arxiv.org/abs/2505.18882

This benchmark evaluates models on safe, empathetic, and personalized responses
in sensitive situations (mental health, self-harm risk, etc.).

Tasks:
  - personalized_safety:              full dataset, parameterized
  - personalized_safety_context_free: no background (paper §4.1 baseline)
  - personalized_safety_context_rich: with user background
  - personalized_safety_youth:        age ≤ 25 (adolescent/young adult safety)
  - personalized_safety_elderly:      age ≥ 60 (elder care safety)
  - personalized_safety_healthcare:   healthcare profession filter
"""

import os
import re
import warnings
from typing import Any, Callable, Literal

from inspect_ai import Task, task
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.model import GenerateConfig, Model
from inspect_ai.solver import generate, system_message

from .prompts import (
    CONTEXT_FREE_PROMPT,
    CONTEXT_RICH_PROMPT,
    SYSTEM_PROMPT,
)
from .scorer import personalized_safety_scorer
from .utils import build_background_description
from inspect_evals.utils.huggingface import hf_dataset

DATASET_PATH = "wick1d/Personalized_Safety_Data"

# Judge model: reads from JUDGE_MODEL_NAME env var. Set in .env, e.g.:
#   JUDGE_MODEL_NAME=alicloud-qwen3.5-plus
_judge_env = os.getenv("JUDGE_MODEL_NAME")
if not _judge_env:
    warnings.warn(
        "[personalized_safety] JUDGE_MODEL_NAME not set in .env, falling back to 'gpt-4o'. "
        "Please set JUDGE_MODEL_NAME (e.g. JUDGE_MODEL_NAME=alicloud-qwen3.5-plus)",
        stacklevel=2,
    )
DEFAULT_JUDGE_MODEL = f"openai/{_judge_env}" if _judge_env else "openai/gpt-4o"
DEFAULT_MAX_TOKENS = 500
DEFAULT_TEMPERATURE = 0.7


def record_to_sample(
    context_mode: Literal["context_free", "context_rich"] = "context_free",
) -> Any:
    """Create a function to convert dataset records to Sample objects.

    Args:
        context_mode: Whether to include background in model input
            - "context_free": Model only sees query (paper Section 4.1)
            - "context_rich": Model sees user background + query

    Returns:
        Function that converts records to Sample objects
    """

    def converter(record: dict[str, Any]) -> Sample:
        query = record["query"]
        background_desc = build_background_description(record)

        # Build input based on context mode
        if context_mode == "context_free":
            input_text = CONTEXT_FREE_PROMPT.format(query=query)
        else:
            input_text = CONTEXT_RICH_PROMPT.format(
                background=background_desc,
                query=query,
            )

        return Sample(
            input=input_text,
            target="",  # No expected output for this benchmark
            metadata={
                "query": query,
                "background_description": background_desc,
                "scenario": record.get("scenario", "unknown"),
                "source": record.get("source", "unknown"),
                "context_mode": context_mode,
                # Store profile fields for analysis
                "age": record.get("age"),
                "gender": record.get("gender"),
                "mental_health_status": record.get("mental_health_status"),
                "emotional_state": record.get("emotional_state"),
            },
        )

    return converter


@task
def personalized_safety(
    context_mode: Literal["context_free", "context_rich"] = "context_free",
    judge_model: str | Model | None = DEFAULT_JUDGE_MODEL,
    judge_max_tokens: int = 800,
    judge_temperature: float = 0.7,
) -> Task:
    """PersonalizedSafety benchmark for evaluating LLM safety in high-risk scenarios.

    This benchmark evaluates models on their ability to provide safe, empathetic,
    and personalized responses to users in sensitive situations (mental health,
    self-harm risk, etc.).

    Evaluation dimensions:
    - Risk Sensitivity (1-5): Identifying and addressing safety risks
    - Emotional Empathy (1-5): Understanding user's emotional state
    - Personalization (1-5): Tailoring advice to user's background

    Args:
        context_mode: Evaluation mode
            - "context_free": Model only sees query (paper Section 4.1 baseline)
            - "context_rich": Model sees user background + query
        judge_model: Model for evaluating responses (default: gpt-4o)
        judge_max_tokens: Max tokens for judge evaluation
        judge_temperature: Temperature for judge model

    Returns:
        Task object for running the evaluation
    """
    dataset = hf_dataset(
        path=DATASET_PATH,
        split="train",  # Dataset only has train split
        sample_fields=record_to_sample(context_mode),
    )

    return Task(
        dataset=dataset,
        solver=[
            system_message(SYSTEM_PROMPT),
            generate(),
        ],
        scorer=personalized_safety_scorer(
            judge_model=judge_model,
            judge_max_tokens=judge_max_tokens,
            judge_temperature=judge_temperature,
        ),
        config=GenerateConfig(
            temperature=DEFAULT_TEMPERATURE,
            max_tokens=DEFAULT_MAX_TOKENS,
        ),
        version="1.0.0",
    )


@task
def personalized_safety_context_free(
    judge_model: str | Model | None = DEFAULT_JUDGE_MODEL,
) -> Task:
    """Context-free evaluation (paper Section 4.1 baseline).

    Model only sees the user query, no background information.
    Judge still evaluates with full background context.
    """
    return personalized_safety(
        context_mode="context_free",
        judge_model=judge_model,
    )


@task
def personalized_safety_context_rich(
    judge_model: str | Model | None = DEFAULT_JUDGE_MODEL,
) -> Task:
    """Context-rich evaluation with user background.

    Model sees both user background and query.
    Judge evaluates with full background context.
    """
    return personalized_safety(
        context_mode="context_rich",
        judge_model=judge_model,
    )


# ---------------------------------------------------------------------------
# Per-demographic sub-tasks
# ---------------------------------------------------------------------------

def _parse_age(value: Any) -> int | None:
    """Parse age from dataset field (may be int, float, or string)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        m = re.search(r"\d+", value)
        return int(m.group()) if m else None
    return None


_HEALTHCARE_KEYWORDS = frozenset({
    "nurse", "doctor", "physician", "surgeon", "therapist",
    "counselor", "pharmacist", "dentist", "paramedic", "psychiatrist",
    "psychologist", "healthcare", "medical", "clinician", "caregiver",
    "nursing", "health", "hospital", "clinic",
})


def _is_healthcare_profession(value: Any) -> bool:
    """Check if profession field matches healthcare-related keywords."""
    if not value or not isinstance(value, str):
        return False
    words = value.lower().split()
    return bool(set(words) & _HEALTHCARE_KEYWORDS)


def _load_filtered_dataset(
    context_mode: Literal["context_free", "context_rich"],
    filter_fn: Callable[[dict[str, Any]], bool],
    name: str,
) -> MemoryDataset:
    """Load HuggingFace dataset with row-level filtering.

    Args:
        context_mode: context_free or context_rich
        filter_fn: Predicate applied to each raw record
        name: Dataset name for logging
    """
    from datasets import load_dataset as hf_load

    ds = hf_load(DATASET_PATH, split="train")
    converter = record_to_sample(context_mode)
    samples = [converter(dict(row)) for row in ds if filter_fn(dict(row))]
    return MemoryDataset(samples=samples, name=name)


@task
def personalized_safety_youth(
    context_mode: Literal["context_free", "context_rich"] = "context_rich",
    judge_model: str | Model | None = DEFAULT_JUDGE_MODEL,
    judge_max_tokens: int = 800,
    judge_temperature: float = 0.7,
) -> Task:
    """Youth safety evaluation — age ≤ 25 (adolescent/young adult).

    Filters to users aged 25 or younger. Uses context_rich mode by default
    since personalization is critical for this vulnerable population.
    """
    dataset = _load_filtered_dataset(
        context_mode=context_mode,
        filter_fn=lambda r: (_parse_age(r.get("age")) or 999) <= 25,
        name="personalized_safety_youth",
    )

    return Task(
        dataset=dataset,
        solver=[system_message(SYSTEM_PROMPT), generate()],
        scorer=personalized_safety_scorer(
            judge_model=judge_model,
            judge_max_tokens=judge_max_tokens,
            judge_temperature=judge_temperature,
        ),
        config=GenerateConfig(
            temperature=DEFAULT_TEMPERATURE,
            max_tokens=DEFAULT_MAX_TOKENS,
        ),
        version="1.0.0",
    )


@task
def personalized_safety_elderly(
    context_mode: Literal["context_free", "context_rich"] = "context_rich",
    judge_model: str | Model | None = DEFAULT_JUDGE_MODEL,
    judge_max_tokens: int = 800,
    judge_temperature: float = 0.7,
) -> Task:
    """Elderly safety evaluation — age ≥ 60 (elder care).

    Filters to users aged 60 or older. Uses context_rich mode by default
    since health conditions and social isolation require personalized handling.
    """
    dataset = _load_filtered_dataset(
        context_mode=context_mode,
        filter_fn=lambda r: (_parse_age(r.get("age")) or 0) >= 60,
        name="personalized_safety_elderly",
    )

    return Task(
        dataset=dataset,
        solver=[system_message(SYSTEM_PROMPT), generate()],
        scorer=personalized_safety_scorer(
            judge_model=judge_model,
            judge_max_tokens=judge_max_tokens,
            judge_temperature=judge_temperature,
        ),
        config=GenerateConfig(
            temperature=DEFAULT_TEMPERATURE,
            max_tokens=DEFAULT_MAX_TOKENS,
        ),
        version="1.0.0",
    )


@task
def personalized_safety_healthcare(
    context_mode: Literal["context_free", "context_rich"] = "context_rich",
    judge_model: str | Model | None = DEFAULT_JUDGE_MODEL,
    judge_max_tokens: int = 800,
    judge_temperature: float = 0.7,
) -> Task:
    """Healthcare profession safety evaluation.

    Filters to users whose profession is in the healthcare domain.
    Healthcare workers face unique stressors (burnout, moral injury,
    secondary trauma) requiring specialized safety responses.
    """
    dataset = _load_filtered_dataset(
        context_mode=context_mode,
        filter_fn=lambda r: _is_healthcare_profession(r.get("profession")),
        name="personalized_safety_healthcare",
    )

    return Task(
        dataset=dataset,
        solver=[system_message(SYSTEM_PROMPT), generate()],
        scorer=personalized_safety_scorer(
            judge_model=judge_model,
            judge_max_tokens=judge_max_tokens,
            judge_temperature=judge_temperature,
        ),
        config=GenerateConfig(
            temperature=DEFAULT_TEMPERATURE,
            max_tokens=DEFAULT_MAX_TOKENS,
        ),
        version="1.0.0",
    )
