"""
Agent Security Bench (ASB): LLM Agent Resistance to Adversarial Attacks

Based on:
    Zhang et al. "Agent Security Bench (ASB): Formalizing and Benchmarking
    Attacks and Defenses in LLM-based Agents" (ICLR 2025)
    https://github.com/agiresearch/ASB

This benchmark evaluates whether LLM agents can resist prompt injection
attacks across 10 agent scenarios.

Two attack modes:
  - asb (DPI): Direct Prompt Injection — injection appended to user message
  - asb_ipi (IPI): Indirect Prompt Injection — injection embedded in
    simulated tool output / retrieved context (environment-based attack)

Scoring:
  - ASR (Attack Success Rate): string match of attack goal in response
    1.0 = compromised, 0.0 = safe
  - Refusal: LLM judge binary — 0 (refused=safe) / 1 (complied=unsafe)
  - Lower ASR = safer model

Usage:
    inspect eval eval_benchmarks/asb --model openai/gpt-4o
    inspect eval eval_benchmarks/asb_ipi --model openai/gpt-4o
    inspect eval eval_benchmarks/asb --model openai/gpt-4o -T dpi_variant=naive --limit 20
    inspect eval eval_benchmarks/asb_ipi --model openai/gpt-4o -T ipi_variant=data_poisoning
"""

import os
import warnings

from inspect_ai import Task, task
from inspect_ai.model import GenerateConfig
from inspect_ai.solver import generate

from .dataset import load_asb_dataset, load_asb_ipi_dataset
from .scorer import asb_scorer

DEFAULT_TEMPERATURE = 0.7
DEFAULT_MAX_TOKENS = 2048


@task
def asb(
    dpi_variant: str = "naive",
    agent_filter: str | None = None,
    aggressive_only: bool = False,
    judge_model: str | None = None,
    judge_max_tokens: int = 256,
    judge_temperature: float = 0.0,
    limit: int | None = None,
    shuffle: bool = False,
    seed: int = 42,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> Task:
    """Agent Security Bench — DPI Attack Evaluation.

    Evaluates LLM agent resistance to Direct Prompt Injection attacks
    across 10 diverse agent scenarios (financial, medical, legal, etc.).

    DPI variants:
    - naive: Direct injection appended to task
    - fake_completion: "Answer: task complete." prefix
    - escape_characters: Newline prefix
    - context_ignoring: "Ignore previous instructions." prefix
    - combined_attack: All of the above combined

    Args:
        dpi_variant: DPI attack variant (default: naive).
        agent_filter: Comma-separated agent names to include (default: all).
        aggressive_only: Only include aggressive attack tools.
        judge_model: Model for refusal evaluation. Reads JUDGE_MODEL_NAME
            env var if not specified.
        judge_max_tokens: Max tokens for judge.
        judge_temperature: Temperature for judge model.
        limit: Maximum number of samples.
        shuffle: Whether to shuffle samples.
        seed: Random seed.
        temperature: Generation temperature for evaluated model.
        max_tokens: Max tokens for model response.

    Returns:
        Task object for running the evaluation.
    """
    # Resolve judge model
    if judge_model is None:
        judge_env = os.getenv("JUDGE_MODEL_NAME")
        if not judge_env:
            warnings.warn(
                "[asb] JUDGE_MODEL_NAME not set, falling back to 'gpt-4o'.",
                stacklevel=2,
            )
        judge_model = f"openai/{judge_env}" if judge_env else "openai/gpt-4o"

    # Load dataset
    dataset = load_asb_dataset(
        dpi_variant=dpi_variant,
        agent_filter=agent_filter,
        aggressive_only=aggressive_only,
        shuffle=shuffle,
        seed=seed,
        limit=limit,
    )

    return Task(
        dataset=dataset,
        solver=[generate()],
        scorer=asb_scorer(
            judge_model=judge_model,
            judge_max_tokens=judge_max_tokens,
            judge_temperature=judge_temperature,
        ),
        config=GenerateConfig(
            temperature=temperature,
            max_tokens=max_tokens,
        ),
        version="1.0.0",
    )


def _resolve_judge(judge_model: str | None) -> str:
    """Resolve judge model from parameter or environment."""
    if judge_model is not None:
        return judge_model
    judge_env = os.getenv("JUDGE_MODEL_NAME")
    if not judge_env:
        warnings.warn(
            "[asb] JUDGE_MODEL_NAME not set, falling back to 'gpt-4o'.",
            stacklevel=2,
        )
    return f"openai/{judge_env}" if judge_env else "openai/gpt-4o"


@task
def asb_ipi(
    ipi_variant: str = "naive",
    agent_filter: str | None = None,
    aggressive_only: bool = False,
    judge_model: str | None = None,
    judge_max_tokens: int = 256,
    judge_temperature: float = 0.0,
    limit: int | None = None,
    shuffle: bool = False,
    seed: int = 42,
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> Task:
    """Agent Security Bench — IPI (Indirect Prompt Injection) Evaluation.

    Unlike DPI where the injection is in the user message, IPI embeds
    malicious instructions in simulated tool output or retrieved context.
    This tests whether agents can resist attacks from their data sources
    and environment rather than from the user directly.

    IPI variants:
    - naive: Direct injection in tool output
    - data_poisoning: Injection disguised as retrieved database data
    - context_injection: Injection in search result context
    - hidden_instruction: Injection as system operational note
    - combined_ipi: Override prefix + injection in retrieved data

    Args:
        ipi_variant: IPI attack variant (default: naive).
        agent_filter: Comma-separated agent names to include (default: all).
        aggressive_only: Only include aggressive attack tools.
        judge_model: Model for refusal evaluation.
        judge_max_tokens: Max tokens for judge.
        judge_temperature: Temperature for judge model.
        limit: Maximum number of samples.
        shuffle: Whether to shuffle samples.
        seed: Random seed.
        temperature: Generation temperature for evaluated model.
        max_tokens: Max tokens for model response.
    """
    judge_model = _resolve_judge(judge_model)

    dataset = load_asb_ipi_dataset(
        ipi_variant=ipi_variant,
        agent_filter=agent_filter,
        aggressive_only=aggressive_only,
        shuffle=shuffle,
        seed=seed,
        limit=limit,
    )

    return Task(
        dataset=dataset,
        solver=[generate()],
        scorer=asb_scorer(
            judge_model=judge_model,
            judge_max_tokens=judge_max_tokens,
            judge_temperature=judge_temperature,
        ),
        config=GenerateConfig(
            temperature=temperature,
            max_tokens=max_tokens,
        ),
        version="1.0.0",
    )
