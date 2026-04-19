"""Path resolution for SafeRAG vendor data (dataset, prompts, knowledge base).

The data is now bundled inside the package at ``saferag/data/`` so the platform
is fully self-contained — no SAFERAG_ROOT environment variable required.
For backwards compatibility, SAFERAG_ROOT is still honored when explicitly set.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def resolve_saferag_root() -> Path:
    """Locate the SafeRAG data directory containing nctd_datasets/, etc.

    Resolution order:
      1. ``SAFERAG_ROOT`` env var (if set and exists) — legacy escape hatch
      2. Bundled ``saferag/data/`` directory shipped with the package
    """
    env_root = os.environ.get("SAFERAG_ROOT")
    if env_root:
        root = Path(env_root).expanduser().resolve()
        if root.exists():
            return root

    root = (Path(__file__).resolve().parent / "data").resolve()

    if not root.exists():
        raise FileNotFoundError(
            f"SafeRAG data not found at {root}. "
            "The bundled data directory should ship inside the saferag package."
        )
    return root
