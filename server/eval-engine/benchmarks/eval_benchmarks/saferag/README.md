# SafeRAG Benchmark (Local)

This benchmark integrates SafeRAG into the safety-benchmarks runner.

## Prerequisites

- SafeRAG repo is available at /home/xinzhu/SafeRAG or set SAFERAG_ROOT to its path.
- Milvus server is running for vector indexing (base retriever).
- API keys are provided via environment variables (OPENAI_API_KEY, OPENAI_BASE_URL).

## Setup

Create or rebuild the benchmark environment:

```bash
./run-eval.py --setup saferag --force
```

If pkg_resources import fails, pin setuptools:

```bash
uv pip install -p /home/xinzhu/safety-benchmarks/.venvs/saferag "setuptools<81"
```

## Run (base retriever, no filter, SN attack, 100 samples)

```bash
export SAFERAG_ROOT=/home/xinzhu/SafeRAG
export OPENAI_API_KEY=YOUR_KEY
export OPENAI_BASE_URL=https://aihubmix.com/v1

./run-eval.py saferag:saferag_sn --model openai/doubao-seed-1-8 \
  -T retriever_name=base \
  -T filter_module=off \
  -T attack_module=indexing \
  -T attack_intensity=0.5 \
  -T limit=100
```

## Task Variants

- saferag:saferag_sn
- saferag:saferag_icc
- saferag:saferag_sa
- saferag:saferag_wdos

## Common Parameters

- retriever_name: base | bm25 | hybrid | hybrid-rerank
- filter_module: off | nli | skr
- attack_module: indexing | retrieval | generation
- attack_intensity: float (0.0-1.0)
- retrieve_top_k: int (SN defaults to 6, others to 2)
- limit: int

## Notes

- This integration keeps SafeRAG logic for retrieval, prompting, and scoring.
- If bm25 or hybrid retrievers fail, run with retriever_name=base.
