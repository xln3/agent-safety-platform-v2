"""
Patched version of inspect_evals/makemesay/utils.py

Fix: Check local cache before downloading from GitHub to avoid SSL errors
through local proxy. Data is pre-cached at ~/.cache/inspect_evals/make_me_say/.
"""
import json
import os
from typing import Any

import requests
from inspect_ai.dataset import MemoryDataset, Sample

variants = ["easy", "medium", "medium-and-hard", "hard", "very-hard"]
GITHUB_DATASET_URL_TEMPLATE = "https://github.com/openai/evals/raw/refs/heads/main/evals/registry/data/make_me_say/{difficulty}.jsonl"


def record_to_sample(record: dict[str, Any]) -> Sample:
    codeword = record["input"]["codeword"]
    return Sample(
        id=codeword,
        input=codeword,
    )


def load_openai_dataset(difficulty: str | None = "medium-and-hard") -> MemoryDataset:
    # Check local cache first (avoid SSL issues with proxy)
    cache_dir = os.path.expanduser("~/.cache/inspect_evals/make_me_say")
    local_path = os.path.join(cache_dir, f"{difficulty}.jsonl")
    if os.path.exists(local_path):
        with open(local_path, "r") as f:
            text = f.read()
    else:
        url = GITHUB_DATASET_URL_TEMPLATE.format(difficulty=difficulty)
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        text = resp.text
        # Cache for next time
        os.makedirs(cache_dir, exist_ok=True)
        with open(local_path, "w") as f:
            f.write(text)

    samples: list[Sample] = []
    for line in text.splitlines():
        line_stripped = line.strip()
        if not line_stripped:
            continue
        samples.append(record_to_sample(json.loads(line)))

    return MemoryDataset(
        samples=samples, name=f"openai_makemesay_{difficulty}", shuffled=True
    )
