#!/usr/bin/env python3
"""
Generate sample indexes for all benchmarks from existing .eval result files.

Reads .eval ZIP archives from the original project's results directory,
extracts sample IDs, and produces per-task YAML indexes + selection reports.

Usage:
    python3 server/scripts/generate-indexes.py
"""

import json
import os
import random
import re
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import yaml

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CATALOG_PATH = PROJECT_ROOT / "server" / "eval-engine" / "benchmarks" / "catalog.yaml"
INDEXES_DIR = PROJECT_ROOT / "server" / "eval-engine" / "benchmarks" / "indexes"
EVAL_BENCHMARKS_DIR = PROJECT_ROOT / "server" / "eval-engine" / "benchmarks" / "eval_benchmarks"

# Original project results
RESULTS_DIR = Path.home() / "agent-safety-platform" / "eval-poc" / "results"

# Global caches for benchmarks without results
INSPECT_CACHE = Path.home() / ".cache" / "inspect_evals"

# Existing indexes to skip (already curated)
SKIP_INDEXES = {"bfcl", "clash_eval", "mind2web", "truthfulqa"}

MAX_SAMPLES = 300
RANDOM_SEED = 42
TODAY = date.today().isoformat()

# ---------------------------------------------------------------------------
# Catalog parsing
# ---------------------------------------------------------------------------

def load_catalog():
    with open(CATALOG_PATH) as f:
        data = yaml.safe_load(f)
    return data.get("benchmarks", {})


# ---------------------------------------------------------------------------
# .eval file discovery
# ---------------------------------------------------------------------------

def find_eval_files(benchmark: str, task_name: str) -> list[Path]:
    """Find all .eval files for a benchmark/task across model directories."""
    results = []
    if not RESULTS_DIR.exists():
        return results

    for model_dir in RESULTS_DIR.iterdir():
        if not model_dir.is_dir() or model_dir.name == "jobs.json":
            continue
        bm_dir = model_dir / benchmark / "logs"
        if not bm_dir.exists():
            continue
        for f in bm_dir.glob("*.eval"):
            # Match task name in filename: {timestamp}_{taskname}_{hash}.eval
            fname = f.stem  # e.g. 2026-03-14T08-01-06+00-00_threecb_YFvDGVQg5tb...
            # Task name is between first _ after timestamp and last _
            parts = fname.split("_")
            # The task name could have hyphens and underscores
            # Use the pattern: timestamp has T and +, then task, then hash (no hyphens)
            if task_name.replace("_", "-") in fname.lower() or benchmark in fname.lower():
                results.append(f)

    # Sort by modification time (newest first)
    results.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return results


def find_best_eval_file(benchmark: str, task_name: str) -> Path | None:
    """Find the best (latest, largest) .eval file for a task."""
    files = find_eval_files(benchmark, task_name)
    if not files:
        return None

    # Prefer the newest file with the most samples
    best = None
    best_count = 0
    for f in files[:5]:  # Check top 5 newest
        try:
            count = count_samples_in_eval(f)
            if count > best_count:
                best = f
                best_count = count
        except Exception:
            continue
    return best or (files[0] if files else None)


def count_samples_in_eval(eval_path: Path) -> int:
    """Quick count of sample files in .eval ZIP."""
    try:
        with zipfile.ZipFile(eval_path) as z:
            return sum(1 for n in z.namelist()
                       if n.startswith("samples/") and n.endswith(".json") and "epoch_1" in n)
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Sample extraction
# ---------------------------------------------------------------------------

def extract_sample_ids(eval_path: Path) -> list[str]:
    """Extract unique sample IDs from .eval ZIP file."""
    ids = set()
    try:
        with zipfile.ZipFile(eval_path) as z:
            for name in z.namelist():
                if not (name.startswith("samples/") and name.endswith(".json")):
                    continue
                # Only epoch 1 to avoid duplicates
                if "epoch_" in name and "epoch_1" not in name:
                    continue
                try:
                    data = json.loads(z.read(name))
                    if isinstance(data, dict) and "id" in data:
                        sid = data["id"]
                        if sid:
                            ids.add(str(sid))
                    elif isinstance(data, list):
                        for item in data:
                            if isinstance(item, dict) and "id" in item and item["id"]:
                                ids.add(str(item["id"]))
                except Exception:
                    continue
    except Exception as e:
        print(f"  WARNING: Failed to read {eval_path}: {e}")
    return sorted(ids)


def extract_ids_from_local_data(benchmark: str) -> list[str]:
    """Extract sample IDs from local benchmark data files (fallback)."""
    data_dir = EVAL_BENCHMARKS_DIR / benchmark / "data"
    ids = []

    if not data_dir.exists():
        return ids

    for f in data_dir.rglob("*.json"):
        try:
            with open(f) as fh:
                data = json.load(fh)
            if isinstance(data, list):
                for i, item in enumerate(data):
                    if isinstance(item, dict):
                        sid = item.get("id") or item.get("sample_id") or f"sample_{i}"
                        ids.append(str(sid))
            elif isinstance(data, dict):
                for key in ("data", "samples", "items", "test", "questions"):
                    if key in data and isinstance(data[key], list):
                        for i, item in enumerate(data[key]):
                            if isinstance(item, dict):
                                sid = item.get("id") or item.get("sample_id") or f"{key}_{i}"
                                ids.append(str(sid))
                        break
        except Exception:
            continue

    for f in data_dir.rglob("*.jsonl"):
        try:
            with open(f) as fh:
                for i, line in enumerate(fh):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                        sid = item.get("id") or item.get("sample_id") or f"line_{i}"
                        ids.append(str(sid))
                    except Exception:
                        continue
        except Exception:
            continue

    return sorted(set(ids))


# ---------------------------------------------------------------------------
# Index generation
# ---------------------------------------------------------------------------

def select_samples(all_ids: list[str], max_n: int = MAX_SAMPLES) -> tuple[list[str], str]:
    """Select up to max_n samples. Returns (selected_ids, strategy_description)."""
    if len(all_ids) <= max_n:
        return all_ids, f"全部保留 (共 {len(all_ids)} 个)"

    rng = random.Random(RANDOM_SEED)
    selected = rng.sample(all_ids, max_n)
    return sorted(selected), f"确定性随机抽样 {max_n} / {len(all_ids)} (seed={RANDOM_SEED})"


def write_index_yaml(out_path: Path, task_name: str, sample_ids: list[str],
                     total: int, strategy: str):
    """Write a YAML index file."""
    header = (
        f"# {task_name} {len(sample_ids)}-item curated index\n"
        f"# Generated: {TODAY}\n"
        f"# Source: eval results auto-extraction\n"
        f"# Selection: {strategy}\n"
    )

    data = {"mode": "include", "samples": {}}
    for sid in sample_ids:
        data["samples"][sid] = {
            "added": TODAY,
            "sources": ["auto_curation_v1"],
        }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        f.write(header)
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def write_selection_report(out_path: Path, benchmark: str, bm_data: dict,
                           task_results: list[dict]):
    """Write SELECTION_REPORT.md for a benchmark."""
    source = bm_data.get("source", "unknown")

    # Extract risk comment from catalog
    risk_comment = ""
    # We can't easily get YAML comments, so skip

    lines = [
        f"# {benchmark} 样本筛选报告\n",
        f"## 数据集概况",
        f"- 基准名称: {benchmark}",
        f"- 数据来源: {source}",
        f"- 生成日期: {TODAY}",
        "",
        "## Task 明细",
        "",
        "| Task | 原始样本数 | 筛选后 | 策略 |",
        "|------|-----------|--------|------|",
    ]

    for tr in task_results:
        lines.append(
            f"| {tr['task']} | {tr['total']} | {tr['selected']} | {tr['strategy']} |"
        )

    lines.extend([
        "",
        "## 筛选策略",
        f"- 总数 ≤ {MAX_SAMPLES}: 全部保留",
        f"- 总数 > {MAX_SAMPLES}: 确定性随机抽样 (seed={RANDOM_SEED})",
        "- 已排除: 无效样本 (id 为空)",
        "",
    ])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        f.write("\n".join(lines))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    catalog = load_catalog()
    print(f"Loaded catalog: {len(catalog)} benchmarks")

    stats = {
        "total_benchmarks": len(catalog),
        "total_tasks": 0,
        "indexed_tasks": 0,
        "skipped": 0,
        "failed": [],
    }

    for bm_name, bm_data in catalog.items():
        if not isinstance(bm_data, dict):
            continue

        tasks = bm_data.get("tasks", [])
        stats["total_tasks"] += len(tasks)

        # Skip already-curated benchmarks
        if bm_name in SKIP_INDEXES:
            print(f"[SKIP] {bm_name} — already has curated index")
            stats["skipped"] += len(tasks)
            continue

        print(f"\n[{bm_name}] Processing {len(tasks)} task(s)...")

        task_results = []
        bm_success = False

        for task_def in tasks:
            task_name = task_def.get("name", bm_name)

            # Find eval file
            eval_file = find_best_eval_file(bm_name, task_name)

            if eval_file:
                all_ids = extract_sample_ids(eval_file)
                source_desc = f"eval file: {eval_file.name}"
            else:
                # Fallback: try local data
                all_ids = extract_ids_from_local_data(bm_name)
                source_desc = "local data files"

            if not all_ids:
                print(f"  [{task_name}] NO samples found")
                stats["failed"].append(f"{bm_name}/{task_name}")
                task_results.append({
                    "task": task_name,
                    "total": 0,
                    "selected": 0,
                    "strategy": "无可用数据",
                })
                continue

            selected, strategy = select_samples(all_ids)

            # Write index YAML
            index_path = INDEXES_DIR / bm_name / f"{task_name}.yaml"
            write_index_yaml(index_path, task_name, selected, len(all_ids), strategy)

            print(f"  [{task_name}] {len(selected)}/{len(all_ids)} samples → {index_path.name} (from {source_desc})")

            task_results.append({
                "task": task_name,
                "total": len(all_ids),
                "selected": len(selected),
                "strategy": strategy,
            })
            stats["indexed_tasks"] += 1
            bm_success = True

        # Write selection report if any tasks succeeded
        if task_results:
            report_path = INDEXES_DIR / bm_name / "SELECTION_REPORT.md"
            write_selection_report(report_path, bm_name, bm_data, task_results)
            if bm_success:
                print(f"  → SELECTION_REPORT.md written")

    # Summary
    print("\n" + "=" * 60)
    print("=== Index Generation Summary ===")
    print(f"Total benchmarks in catalog: {stats['total_benchmarks']}")
    print(f"Total tasks: {stats['total_tasks']}")
    print(f"Tasks indexed: {stats['indexed_tasks']}")
    print(f"Tasks skipped (pre-existing): {stats['skipped']}")
    print(f"Tasks failed: {len(stats['failed'])}")
    if stats["failed"]:
        print("Failed tasks:")
        for f in stats["failed"]:
            print(f"  - {f}")
    print("=" * 60)


if __name__ == "__main__":
    main()
