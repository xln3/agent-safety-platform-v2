# ruff: noqa: F401
# Import all @task functions to register them with inspect_ai's registry.

from eval_benchmarks.raccoon import raccoon
from eval_benchmarks.clash_eval import clash_eval
from eval_benchmarks.safeagentbench import safeagentbench, safeagentbench_react, safeagentbench_visual
from eval_benchmarks.saferag import saferag, saferag_sn, saferag_icc, saferag_sa, saferag_wdos
from eval_benchmarks.open_agent_safety import open_agent_safety
