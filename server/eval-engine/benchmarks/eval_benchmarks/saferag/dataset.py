from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Iterable

from inspect_ai.dataset import Sample

from .utils import resolve_saferag_root


def _default_nctd_path() -> Path:
    root = resolve_saferag_root()
    return root / "nctd_datasets" / "nctd.json"


def load_nctd_records(
    attack_task: str,
    data_path: str | Path | None = None,
    shuffle: bool = False,
    seed: int = 22,
    limit: int | None = None,
) -> list[dict]:
    path = Path(data_path) if data_path else _default_nctd_path()
    with path.open(encoding="utf-8") as f:
        data = json.load(f)

    records = data.get(attack_task, [])
    if shuffle:
        random.seed(seed)
        random.shuffle(records)

    if limit is not None:
        records = records[:limit]

    return records


def records_to_samples(records: Iterable[dict], attack_task: str) -> list[Sample]:
    attack_context_key = f"enhanced_{attack_task}_contexts"
    samples: list[Sample] = []

    for record in records:
        question = record.get("questions", "")
        metadata = {
            "id": record.get("id"),
            "questions": question,
            "numbered_options": record.get("numbered_options", []),
            "ground_truth_correct_options": record.get("ground_truth_correct_options", []),
            "ground_truth_incorrect_options": record.get("ground_truth_incorrect_options", []),
            "attack_kws": record.get("attack_kws", []),
            "enhanced_contexts": record.get("enhanced_contexts", []),
            attack_context_key: record.get(attack_context_key, []),
        }
        samples.append(Sample(input=question, target="", metadata=metadata))

    return samples


def build_saferag_samples(
    attack_task: str,
    data_path: str | Path | None = None,
    shuffle: bool = False,
    seed: int = 22,
    limit: int | None = None,
) -> list[Sample]:
    records = load_nctd_records(
        attack_task=attack_task,
        data_path=data_path,
        shuffle=shuffle,
        seed=seed,
        limit=limit,
    )
    return records_to_samples(records, attack_task)
