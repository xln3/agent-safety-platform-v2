# eval_benchmarks - Local security benchmarks for inspect_ai evaluation
#
# Only includes the 5 local benchmarks needed by the 4 priority categories:
# - open_agent_safety (tool calling)
# - saferag (RAG/memory safety)
# - clash_eval (RAG/memory safety)
# - raccoon (business safety)
# - safeagentbench (task planning)

from . import raccoon  # noqa: F401
from . import clash_eval  # noqa: F401
from . import safeagentbench  # noqa: F401
from . import saferag  # noqa: F401
from . import open_agent_safety  # noqa: F401

__all__ = [
    "raccoon", "clash_eval", "safeagentbench", "saferag", "open_agent_safety",
]
