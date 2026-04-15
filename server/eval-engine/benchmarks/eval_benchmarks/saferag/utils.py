"""Path resolution for SafeRAG vendor data (dataset, prompts, knowledge base)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def resolve_saferag_root() -> Path:
    """Locate the SafeRAG vendor directory containing nctd_datasets/, etc."""
    env_root = os.environ.get("SAFERAG_ROOT")
    if env_root:
        root = Path(env_root).expanduser().resolve()
    else:
        # Default: eval-poc/vendor/SafeRAG
        # From source: benchmarks/eval_benchmarks/saferag/utils.py → parents[3] = eval-poc/
        root = Path(__file__).resolve().parents[3] / "vendor" / "SafeRAG"
        root = root.resolve()

    if not root.exists():
        raise FileNotFoundError(
            f"SafeRAG root not found at {root}. "
            "Set SAFERAG_ROOT or place SafeRAG in eval-poc/vendor/."
        )
    return root
