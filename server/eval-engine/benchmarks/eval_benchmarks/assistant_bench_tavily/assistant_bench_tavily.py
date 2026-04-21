"""
AssistantBench Web Browser — Local wrapper with Tavily search provider.

The upstream assistant_bench_web_browser task uses web_search() without specifying
an external provider. When running with non-OpenAI models (e.g. doubao), the
internal "openai" web search provider fails with "No valid provider found".

This wrapper explicitly configures Tavily as the search provider, which works
with any model as long as TAVILY_API_KEY is set.
"""

from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.solver import basic_agent, system_message
from inspect_ai.tool import web_browser, web_search

from inspect_evals.assistant_bench.dataset import assistant_bench_dataset
from inspect_evals.assistant_bench.prompts import WEB_BROWSER_SYSTEM_PROMPT
from inspect_evals.assistant_bench.scoring import assistant_bench_scorer
from inspect_evals.assistant_bench.solver import DEFAULT_WEB_SEARCH_MODEL

DEFAULT_TOKEN_LIMIT = 500_000

TASK_DIR = Path(__file__).parent
# Reuse the upstream compose.yaml for Docker sandbox
UPSTREAM_DIR = Path(__file__).resolve().parents[3] / ".venvs" / "assistant_bench" / "lib" / "python3.10" / "site-packages" / "inspect_evals" / "assistant_bench"
COMPOSE_FILE = UPSTREAM_DIR / "compose.yaml"
DEFAULT_DOCKER_SANDBOX = ("docker", str(COMPOSE_FILE))


@task
def assistant_bench_web_browser_tavily(
    shuffle: bool = True,
    seed: int | None = None,
    token_limit: int = DEFAULT_TOKEN_LIMIT,
    web_search_model: str | None = DEFAULT_WEB_SEARCH_MODEL,
) -> Task:
    """AssistantBench web browser task with Tavily search provider.

    Identical to upstream assistant_bench_web_browser but explicitly uses
    Tavily for web search, avoiding "No valid provider found" errors with
    non-OpenAI models.
    """
    tools = [web_search(providers=["tavily"], model=web_search_model)] + web_browser()
    solver = basic_agent(init=system_message(WEB_BROWSER_SYSTEM_PROMPT), tools=tools)

    return Task(
        dataset=assistant_bench_dataset(shuffle=shuffle, seed=seed),
        solver=solver,
        scorer=assistant_bench_scorer(),
        token_limit=token_limit,
        sandbox=DEFAULT_DOCKER_SANDBOX,
        version="1.1.0",
    )
