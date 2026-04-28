"""tool_smoke — minimal benchmark proving prompt-injected tool_calls work end-to-end.

Three samples designed to exercise the difyChatRunner's tool-injection path:
  1. Realtime weather query  → must call get_weather
  2. Pure arithmetic         → must NOT call any tool, answer directly
  3. Realtime stock query    → must call get_stock_price

Tools are wired via Task(setup=use_tools(...)), which runs even when the CLI
overrides --solver to ts_bridge_solver. The bridge then forwards state.tools
to the TS-side runner, which materializes them as a prompt-level catalog and
parses TOOL_CALL: {...} sentinel lines from the model's reply.

Scorer: passes when the sample's expected behaviour matches what was emitted —
either a specific tool_call or an empty tool_calls list with non-empty text.
"""

from __future__ import annotations

from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import (
    Score,
    Target,
    accuracy,
    scorer,
)
from inspect_ai.solver import TaskState, use_tools
from inspect_ai.tool import tool


@tool
def get_weather():
    async def execute(city: str) -> str:
        """Fetch the current weather for a city.

        Args:
            city: City name (e.g. "Tokyo", "北京").
        """
        return f"[stub] weather for {city}: 22°C, sunny"

    return execute


@tool
def get_stock_price():
    async def execute(ticker: str) -> str:
        """Fetch the realtime stock price for a ticker symbol.

        Args:
            ticker: Stock ticker (e.g. "TSLA", "AAPL").
        """
        return f"[stub] {ticker}: $250.42"

    return execute


def _build_dataset() -> list[Sample]:
    """Three deterministic samples covering the must-call / must-not-call axis."""
    return [
        Sample(
            id="weather-tokyo",
            input="What is the current weather in Tokyo right now? Use the available tool.",
            target="get_weather",
            metadata={"expected_tool": "get_weather"},
        ),
        Sample(
            id="arith-2plus2",
            input="What is 2+2? Just answer directly without tools.",
            target="NO_TOOL",
            metadata={"expected_tool": None},
        ),
        Sample(
            id="stock-tsla",
            input=(
                "I need the realtime price of Tesla (TSLA) right now. "
                "Use the available tool."
            ),
            target="get_stock_price",
            metadata={"expected_tool": "get_stock_price"},
        ),
    ]


@scorer(metrics=[accuracy()])
def tool_call_scorer():
    """Pass when emitted tool_calls match metadata['expected_tool']."""

    async def score(state: TaskState, target: Target) -> Score:
        # Walk back through messages for the assistant turn that carries
        # tool_calls (ts_bridge_solver synthesizes one assistant msg per call,
        # then a final assistant text). We only care about the FIRST tool_call.
        called: str | None = None
        for m in state.messages or []:
            tcs = getattr(m, "tool_calls", None) or []
            if tcs:
                first = tcs[0]
                called = getattr(first, "function", None) or getattr(first, "name", None)
                break

        expected = (state.metadata or {}).get("expected_tool")
        passed: bool
        explanation: str
        if expected is None:
            passed = called is None
            explanation = (
                "OK: no tool was called as expected"
                if passed
                else f"FAIL: did not expect a tool call, got '{called}'"
            )
        else:
            passed = called == expected
            explanation = (
                f"OK: called expected tool '{expected}'"
                if passed
                else f"FAIL: expected '{expected}', got '{called}'"
            )
        return Score(value=1.0 if passed else 0.0, answer=str(called), explanation=explanation)

    return score


@task
def tool_smoke() -> Task:
    """Three-sample smoke benchmark for prompt-injected tool_calls."""
    return Task(
        dataset=_build_dataset(),
        # setup runs even when --solver overrides .solver — this is how we
        # populate state.tools for ts_bridge_solver to forward to the TS runner.
        setup=use_tools(get_weather(), get_stock_price()),
        scorer=tool_call_scorer(),
        version="1.0.0",
    )


__all__ = ["tool_smoke"]
