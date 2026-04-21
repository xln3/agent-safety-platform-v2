#!/usr/bin/env python3
"""Generate short-form QA pairs from GoodWiki articles for HalluLens Task 1.

Reads doc_goodwiki_h_score.jsonl, stratifies by h_score_cat (10 bins),
generates factual questions via LLM, validates answerability, and writes
to data/task1_wikiqa.jsonl.

Usage:
    # Generate 5000 QA pairs (500 per h_score bin)
    python3 tools/generate_wikiqa.py --n 5000

    # Use custom API endpoint
    python3 tools/generate_wikiqa.py --n 5000 \
        --api-key sk-xxx --base-url https://api.example.com/v1 \
        --model gpt-4o-mini

    # Resume from partially completed output
    python3 tools/generate_wikiqa.py --n 5000 --resume

Environment variables (fallback if CLI args not provided):
    OPENAI_API_KEY, OPENAI_BASE_URL, MODEL_NAME
"""

import argparse
import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path

try:
    import aiohttp
    from aiohttp_socks import ProxyConnector
except ImportError:
    print("Installing aiohttp + aiohttp-socks...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "aiohttp", "aiohttp-socks", "-q"])
    import aiohttp
    from aiohttp_socks import ProxyConnector

HERE = Path(__file__).resolve().parent.parent
WIKI_DATA = HERE / "vendor" / "HalluLens" / "data" / "wiki_data" / "doc_goodwiki_h_score.jsonl"
OUTPUT = HERE / "data" / "task1_wikiqa.jsonl"

# ---------- Prompt templates (matching vendor methodology) ----------

Q_GEN_PROMPT = """\
You are generating a factual question about "{title}" based on the reference below.

Rules:
- The question MUST be answerable from the reference text alone.
- It should have a single, short answer (10 words or fewer).
- It should be specific and factual (not opinion-based or open-ended).
- It should NOT be trivially obvious from the title alone.
- Output ONLY the question text, nothing else.

Reference:
{section}"""

ANSWER_PROMPT = """\
Based on the reference below, answer the question concisely (10 words or fewer).
If the question cannot be answered from the reference, respond with exactly: unanswerable

Reference:
{section}

Question: {question}

Answer:"""

# ---------- Helpers ----------

def split_document(text: str, min_chars: int = 600, max_chars: int = 2000) -> list[str]:
    """Split a document into paragraph-aligned sections."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    sections = []
    current = ""
    for p in paragraphs:
        if len(current) + len(p) > max_chars and len(current) >= min_chars:
            sections.append(current.strip())
            current = p
        else:
            current = current + "\n\n" + p if current else p
    if len(current) >= min_chars:
        sections.append(current.strip())
    elif current and sections:
        sections[-1] = sections[-1] + "\n\n" + current
    elif current:
        sections.append(current.strip())
    return sections


async def llm_call(
    session: aiohttp.ClientSession,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    max_tokens: int = 256,
    temperature: float = 0.7,
    semaphore: asyncio.Semaphore | None = None,
) -> str | None:
    """Make a single LLM API call (OpenAI-compatible)."""
    sem = semaphore or asyncio.Semaphore(1)
    url = f"{base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    for attempt in range(3):
        async with sem:
            try:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                    if resp.status == 429:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    resp.raise_for_status()
                    data = await resp.json()
                    return data["choices"][0]["message"]["content"].strip()
            except (aiohttp.ClientError, asyncio.TimeoutError, KeyError) as e:
                if attempt == 2:
                    return None
                await asyncio.sleep(1)
    return None


async def generate_qa_for_article(
    session: aiohttp.ClientSession,
    article: dict,
    base_url: str,
    api_key: str,
    model: str,
    semaphore: asyncio.Semaphore,
    rng: random.Random,
) -> dict | None:
    """Generate a single QA pair from an article. Returns None on failure."""
    title = article["title"]
    document = article.get("document", "")
    if not document or len(document) < 200:
        return None

    sections = split_document(document)
    if not sections:
        return None

    # Drop last section (often references/external links)
    if len(sections) > 1:
        sections = sections[:-1]

    # Try 1 random section (to keep throughput high; the script over-selects candidates)
    section = rng.choice(sections)
    for section in [section]:
        # Truncate very long sections
        if len(section) > 2000:
            section = section[:2000]

        # Step 1: Generate question
        q_prompt = Q_GEN_PROMPT.format(title=title, section=section)
        question = await llm_call(
            session, base_url, api_key, model, q_prompt,
            max_tokens=128, temperature=0.7, semaphore=semaphore,
        )
        if not question or len(question) < 10 or len(question) > 300:
            continue
        # Clean up: remove any prefix like "Question: "
        for prefix in ["Question:", "Q:", "question:"]:
            if question.startswith(prefix):
                question = question[len(prefix):].strip()
        if not question.endswith("?"):
            continue

        # Step 2: Verify answerability
        a_prompt = ANSWER_PROMPT.format(section=section, question=question)
        answer = await llm_call(
            session, base_url, api_key, model, a_prompt,
            max_tokens=64, temperature=0.3, semaphore=semaphore,
        )
        if not answer:
            continue
        answer = answer.strip().strip('"').strip("'")
        if answer.lower() == "unanswerable" or len(answer.split()) > 10:
            continue
        if len(answer) < 1:
            continue

        return {
            "title": title,
            "h_score_cat": article.get("h_score_cat", 0),
            "pageid": article.get("pageid", 0),
            "revid": article.get("revid", 0),
            "description": article.get("description", ""),
            "categories": article.get("categories", []),
            "reference": section,
            "prompt": question,
            "answer": answer,
        }

    return None


def _save_results(results: list[dict], output_path: Path) -> None:
    """Save results sorted by h_score_cat then title."""
    sorted_results = sorted(results, key=lambda x: (x["h_score_cat"], x["title"]))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        for item in sorted_results:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")


async def main():
    parser = argparse.ArgumentParser(description="Generate HalluLens Task 1 QA pairs")
    parser.add_argument("--n", type=int, default=5000, help="Total QA pairs to generate")
    parser.add_argument("--api-key", default=os.getenv("OPENAI_API_KEY", ""))
    parser.add_argument("--base-url", default=os.getenv("OPENAI_BASE_URL", "https://aihubmix.com/v1"))
    parser.add_argument("--model", default=os.getenv("MODEL_NAME", "alicloud-qwen3.5-plus"))
    parser.add_argument("--concurrency", type=int, default=24, help="Max concurrent API calls")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--proxy", default=os.getenv("https_proxy", os.getenv("HTTPS_PROXY", "")),
                        help="HTTPS proxy URL (default: from env)")
    parser.add_argument("--resume", action="store_true", help="Resume from existing output file")
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: --api-key or OPENAI_API_KEY required", file=sys.stderr)
        sys.exit(1)

    # Load existing results if resuming
    existing: dict[str, dict] = {}  # title -> qa_pair
    if args.resume and OUTPUT.exists():
        with OUTPUT.open() as f:
            for line in f:
                if line.strip():
                    item = json.loads(line)
                    existing[item["title"]] = item
        print(f"Resuming: {len(existing)} existing QA pairs loaded")

    # Load and stratify articles
    print(f"Loading articles from {WIKI_DATA}...")
    bins: dict[int, list[dict]] = {i: [] for i in range(10)}
    with WIKI_DATA.open(encoding="utf-8") as f:
        for line in f:
            article = json.loads(line)
            cat = article.get("h_score_cat", 0)
            if 0 <= cat <= 9:
                bins[cat].append(article)

    per_bin = args.n // 10
    remainder = args.n % 10
    rng = random.Random(args.seed)

    # Select articles, excluding already-generated titles
    selected: list[dict] = []
    existing_per_bin: dict[int, int] = {i: 0 for i in range(10)}
    for title, qa in existing.items():
        cat = qa.get("h_score_cat", 0)
        existing_per_bin[cat] = existing_per_bin.get(cat, 0) + 1

    for cat in range(10):
        need = per_bin + (1 if cat < remainder else 0)
        have = existing_per_bin.get(cat, 0)
        still_need = max(0, need - have)
        if still_need == 0:
            continue
        available = [a for a in bins[cat] if a["title"] not in existing]
        rng.shuffle(available)
        # Select 3x what we need (some will fail generation)
        selected.extend(available[:still_need * 3])

    if not selected:
        print(f"Already have {len(existing)} QA pairs, nothing to generate.")
        sys.exit(0)

    print(f"Need to generate from {len(selected)} candidate articles "
          f"(target: {args.n}, existing: {len(existing)})")

    # Generate QA pairs
    semaphore = asyncio.Semaphore(args.concurrency)
    results: list[dict] = list(existing.values())
    results_per_bin = dict(existing_per_bin)

    t0 = time.time()
    generated = 0
    failed = 0

    connector = None
    if args.proxy:
        print(f"Using proxy: {args.proxy}")
        connector = ProxyConnector.from_url(args.proxy)
    async with aiohttp.ClientSession(connector=connector) as session:
        # Process in batches (small batches for faster progress feedback)
        batch_size = args.concurrency
        for batch_start in range(0, len(selected), batch_size):
            batch = selected[batch_start:batch_start + batch_size]
            tasks = [
                generate_qa_for_article(
                    session, article, args.base_url, args.api_key,
                    args.model, semaphore, random.Random(args.seed + i + batch_start),
                )
                for i, article in enumerate(batch)
            ]
            batch_results = await asyncio.gather(*tasks)

            for result in batch_results:
                if result is not None:
                    cat = result["h_score_cat"]
                    target = per_bin + (1 if cat < remainder else 0)
                    if results_per_bin.get(cat, 0) < target:
                        results.append(result)
                        results_per_bin[cat] = results_per_bin.get(cat, 0) + 1
                        generated += 1
                else:
                    failed += 1

            elapsed = time.time() - t0
            total = len(results)
            rate = generated / elapsed if elapsed > 0 else 0
            print(f"  [{total}/{args.n}] +{generated} gen, {failed} fail, "
                  f"{rate:.1f}/s, {elapsed:.0f}s elapsed", flush=True)

            # Save incrementally every 10 batches
            if (batch_start // batch_size) % 10 == 9:
                _save_results(results, OUTPUT)

            # Check if we have enough
            if all(results_per_bin.get(cat, 0) >= (per_bin + (1 if cat < remainder else 0))
                   for cat in range(10)):
                break

    elapsed = time.time() - t0
    print(f"\nDone: {len(results)} QA pairs in {elapsed:.0f}s "
          f"({generated} new, {failed} failed)")

    # Distribution check
    final_dist = {}
    for r in results:
        cat = r["h_score_cat"]
        final_dist[cat] = final_dist.get(cat, 0) + 1
    print("Distribution by h_score_cat:")
    for cat in range(10):
        print(f"  bin {cat}: {final_dist.get(cat, 0)}")

    _save_results(results, OUTPUT)
    print(f"Written to {OUTPUT} ({len(results)} lines)")


if __name__ == "__main__":
    asyncio.run(main())
