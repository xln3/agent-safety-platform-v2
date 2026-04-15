"""Direct retriever for SafeRAG — uses pre-crafted contexts from the dataset.

Bypasses external vector DB (Milvus) and search engine (Elasticsearch) entirely.
For each query, looks up the matching record in nctd.json and returns a mix of
golden and attack contexts based on attack_intensity and retrieve_top_k.
"""

from __future__ import annotations

import json
import math
from pathlib import Path


class DirectRetriever:
    """Self-contained retriever that uses dataset-provided contexts directly."""

    def __init__(
        self,
        attack_data_path: str | Path,
        attack_task: str,
        attack_module: str = "indexing",
        attack_intensity: float = 0.5,
        retrieve_top_k: int = 2,
    ):
        self.attack_task = attack_task
        self.attack_module = attack_module
        self.attack_intensity = attack_intensity
        self.retrieve_top_k = retrieve_top_k

        with open(attack_data_path, encoding="utf-8") as f:
            data = json.load(f)

        records = data.get(attack_task, [])
        self._lookup: dict[str, dict] = {}
        for rec in records:
            q = rec.get("questions", "")
            self._lookup[q] = rec

    def search_docs(self, query_text: str) -> tuple[list[str], str]:
        """Return (retrieve_context_list, filtered_response_text).

        Simulates retrieval by mixing golden and attack contexts from the
        dataset, controlled by attack_intensity and retrieve_top_k.
        """
        rec = self._lookup.get(query_text, {})
        golden = rec.get("enhanced_contexts", [])
        attack_key = f"enhanced_{self.attack_task}_contexts"
        attack = rec.get(attack_key, [])

        num_attack = math.ceil(self.retrieve_top_k * self.attack_intensity)
        num_golden = self.retrieve_top_k - num_attack

        selected_attack = attack[:num_attack]
        selected_golden = golden[:num_golden]

        if self.attack_module in ("retrieval", "generation"):
            # Attack contexts prepended (original behaviour)
            context_list = selected_attack + selected_golden
        else:
            # indexing: interleave (simulates mixed index)
            context_list = selected_attack + selected_golden

        context_list = context_list[: self.retrieve_top_k]
        filtered_text = "\n\n".join(context_list)
        return context_list, filtered_text
