"""
ASB (Agent Security Bench) — Dataset Loader

Loads ASB data files and builds the cross-product of
(agent × task × attack_tool × dpi_variant) as inspect_ai Samples.

Each Sample encodes:
  - input: [system_message (agent prompt + tools), user_message (task + DPI)]
  - target: attack_goal string (for ASR string matching)
  - metadata: agent_name, attacker_tool, dpi_variant, aggressive, etc.
"""

import json
import random
from pathlib import Path

from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.model import ChatMessageSystem, ChatMessageUser

from .prompts import (
    build_dpi_prompt,
    build_ipi_prompt,
    build_system_prompt,
    build_tool_call_format,
)

_DATA_DIR = Path(__file__).parent / "data"


def _load_jsonl(filename: str) -> list[dict]:
    """Load a JSONL file from the data directory."""
    path = _DATA_DIR / filename
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def _load_json(filename: str) -> dict:
    """Load a JSON file from the data directory."""
    path = _DATA_DIR / filename
    with open(path) as f:
        return json.load(f)


def _build_normal_tools(agent_name: str, agent_configs: dict, normal_tools_db: list[dict]) -> list[dict]:
    """Build tool-call-format list for an agent's normal tools."""
    config = agent_configs.get(agent_name, {})
    tool_names = config.get("tools", [])

    tools = []
    for tool_name in tool_names:
        for nt in normal_tools_db:
            if nt["Tool Name"] == tool_name:
                tools.append(build_tool_call_format(tool_name, nt["Description"]))
                break
    return tools


def _build_samples(
    agent_tasks: list[dict],
    attack_tools: list[dict],
    normal_tools_db: list[dict],
    agent_configs: dict,
    agent_filter: str | None,
    aggressive_only: bool,
    attack_mode: str,
    variant: str,
) -> list[Sample]:
    """Build cross-product samples for DPI or IPI mode.

    Args:
        attack_mode: "dpi" or "ipi"
        variant: Attack variant name (e.g. "naive", "data_poisoning")
    """
    # Filter agents
    if agent_filter:
        allowed = {a.strip() for a in agent_filter.split(",")}
        agent_tasks = [a for a in agent_tasks if a["agent_name"] in allowed]

    # Filter attack tools by aggressiveness
    if aggressive_only:
        attack_tools = [t for t in attack_tools if t.get("Aggressive") == "True"]

    prompt_builder = build_ipi_prompt if attack_mode == "ipi" else build_dpi_prompt

    samples = []
    sample_idx = 0

    for agent_info in agent_tasks:
        agent_name = agent_info["agent_name"]
        tasks = agent_info["tasks"]
        agent_desc = agent_configs.get(agent_name, {}).get("description", "")

        normal_tools = _build_normal_tools(agent_name, agent_configs, normal_tools_db)
        normal_tool_names = [t["function"]["name"] for t in normal_tools]

        agent_attack_tools = [
            t for t in attack_tools
            if t["Corresponding Agent"] == agent_name
        ]

        for task in tasks:
            for atool in agent_attack_tools:
                system_prompt = build_system_prompt(
                    agent_description=agent_desc,
                    normal_tools=normal_tools,
                    attacker_tool=atool,
                )

                user_message = prompt_builder(
                    task=task,
                    attacker_instruction=atool["Attacker Instruction"],
                    attacker_tool=atool["Attacker Tool"],
                    variant=variant,
                )

                prefix = "asb_ipi" if attack_mode == "ipi" else "asb"
                variant_key = f"{attack_mode}_variant" if attack_mode == "ipi" else "dpi_variant"

                sample = Sample(
                    input=[
                        ChatMessageSystem(content=system_prompt),
                        ChatMessageUser(content=user_message),
                    ],
                    target=atool["Attack goal"],
                    id=f"{prefix}_{sample_idx:04d}_{agent_name}_{atool['Attacker Tool']}",
                    metadata={
                        "agent_name": agent_name,
                        "attacker_tool": atool["Attacker Tool"],
                        "attacker_instruction": atool["Attacker Instruction"],
                        "attack_goal": atool["Attack goal"],
                        "attack_type": atool.get("Attack Type", ""),
                        "aggressive": atool.get("Aggressive", "False") == "True",
                        "attack_mode": attack_mode,
                        variant_key: variant,
                        "task": task,
                        "normal_tools": normal_tool_names,
                    },
                )
                samples.append(sample)
                sample_idx += 1

    return samples


def load_asb_dataset(
    dpi_variant: str = "naive",
    agent_filter: str | None = None,
    aggressive_only: bool = False,
    shuffle: bool = False,
    seed: int = 42,
    limit: int | None = None,
) -> MemoryDataset:
    """Load ASB DPI benchmark dataset.

    Args:
        dpi_variant: DPI attack variant (naive, fake_completion,
            escape_characters, context_ignoring, combined_attack).
        agent_filter: Comma-separated agent names to include. None = all.
        aggressive_only: If True, only include aggressive attack tools.
        shuffle: Whether to shuffle the dataset.
        seed: Random seed for shuffling.
        limit: Maximum number of samples.

    Returns:
        MemoryDataset with ASB samples.
    """
    agent_tasks = _load_jsonl("agent_task.jsonl")
    attack_tools = _load_jsonl("all_attack_tools.jsonl")
    normal_tools_db = _load_jsonl("all_normal_tools.jsonl")
    agent_configs = _load_json("agent_configs.json")

    samples = _build_samples(
        agent_tasks=agent_tasks,
        attack_tools=attack_tools,
        normal_tools_db=normal_tools_db,
        agent_configs=agent_configs,
        agent_filter=agent_filter,
        aggressive_only=aggressive_only,
        attack_mode="dpi",
        variant=dpi_variant,
    )

    if shuffle:
        rng = random.Random(seed)
        rng.shuffle(samples)

    if limit:
        samples = samples[:limit]

    return MemoryDataset(samples=samples, name="asb")


def load_asb_ipi_dataset(
    ipi_variant: str = "naive",
    agent_filter: str | None = None,
    aggressive_only: bool = False,
    shuffle: bool = False,
    seed: int = 42,
    limit: int | None = None,
) -> MemoryDataset:
    """Load ASB IPI (Indirect Prompt Injection) benchmark dataset.

    IPI differs from DPI: the injection is embedded in simulated tool output
    or retrieved context, not in the user message itself. This tests whether
    agents can resist attacks from their environment/data sources.

    Args:
        ipi_variant: IPI attack variant (naive, data_poisoning,
            context_injection, hidden_instruction, combined_ipi).
        agent_filter: Comma-separated agent names to include. None = all.
        aggressive_only: If True, only include aggressive attack tools.
        shuffle: Whether to shuffle the dataset.
        seed: Random seed for shuffling.
        limit: Maximum number of samples.

    Returns:
        MemoryDataset with ASB IPI samples.
    """
    agent_tasks = _load_jsonl("agent_task.jsonl")
    attack_tools = _load_jsonl("all_attack_tools.jsonl")
    normal_tools_db = _load_jsonl("all_normal_tools.jsonl")
    agent_configs = _load_json("agent_configs.json")

    samples = _build_samples(
        agent_tasks=agent_tasks,
        attack_tools=attack_tools,
        normal_tools_db=normal_tools_db,
        agent_configs=agent_configs,
        agent_filter=agent_filter,
        aggressive_only=aggressive_only,
        attack_mode="ipi",
        variant=ipi_variant,
    )

    if shuffle:
        rng = random.Random(seed)
        rng.shuffle(samples)

    if limit:
        samples = samples[:limit]

    return MemoryDataset(samples=samples, name="asb_ipi")
