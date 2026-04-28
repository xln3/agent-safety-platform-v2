"""ts_bridge solver — reverse-callback bridge from inspect_ai into the TS backend.

Each sample's solve step issues an HTTP POST to the TS backend, which dispatches
to the appropriate per-form runner (openai_compat / dify_chat / dify_workflow / cli)
and returns the agent's textual output plus any tool_calls it made.

We then synthesize an inspect_ai message sequence on the TaskState:
  * If the agent surfaced tool_calls, we emit
        ChatMessageAssistant(tool_calls=[...])
        ChatMessageTool(content=result, tool_call_id=...)   ×N
        ChatMessageAssistant(content=output)
    so tool-use scorers (agentdojo, agentharm, bfcl) can grade per-call behaviour.
  * Otherwise we just emit the final assistant message.

Required env (set by evalRunner before spawning `inspect eval`):
    TS_BRIDGE_CALLBACK_URL  — base URL of the TS backend (e.g. http://localhost:3002)
    TS_BRIDGE_AUTH_TOKEN    — Bearer token; matches server config.apiToken (optional)
    TS_BRIDGE_TIMEOUT_SEC   — per-sample HTTP timeout (default 180)
    TS_BRIDGE_JOB_ID        — current EvalJob id (used by backend for SSE/EvalItem persistence)

Usage (CLI):
    inspect eval <task-spec> \
      --solver /abs/path/to/ts_bridge_solver.py@ts_bridge \
      -S agent_id=42 \
      --model openai/dummy
"""

import json
import os

import httpx
from inspect_ai.model import ChatMessageAssistant, ChatMessageTool
from inspect_ai.solver import Generate, Solver, TaskState, solver
from inspect_ai.tool import ToolCall, ToolDef


def _to_tool_call(tc: dict) -> ToolCall | None:
    """Convert one runner-format AgentToolCall dict into an inspect_ai ToolCall."""
    if not isinstance(tc, dict):
        return None
    name = tc.get("name") or ""
    if not name:
        return None
    args_raw = tc.get("arguments") or "{}"
    if isinstance(args_raw, dict):
        args = args_raw
    else:
        try:
            args = json.loads(args_raw) if args_raw else {}
        except Exception:
            args = {"_raw": str(args_raw)}
    if not isinstance(args, dict):
        args = {"_raw": args}
    call_id = tc.get("id") or f"tc-{name}"
    try:
        return ToolCall(id=str(call_id), function=str(name), arguments=args)
    except TypeError:
        # Older inspect_ai versions used `name=` instead of `function=`.
        return ToolCall(id=str(call_id), name=str(name), arguments=args)  # type: ignore[arg-type]


@solver
def ts_bridge(agent_id: int = 0) -> Solver:
    base_url = os.environ.get("TS_BRIDGE_CALLBACK_URL", "http://localhost:3002").rstrip("/")
    auth_token = os.environ.get("TS_BRIDGE_AUTH_TOKEN", "")
    timeout = float(os.environ.get("TS_BRIDGE_TIMEOUT_SEC", "180"))
    job_id_raw = os.environ.get("TS_BRIDGE_JOB_ID", "")
    job_id = int(job_id_raw) if job_id_raw.isdigit() else None

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        try:
            target_value = None
            if state.target is not None:
                t = state.target.target
                target_value = list(t) if not isinstance(t, str) else t
        except Exception:
            target_value = None

        messages = []
        for m in state.messages or []:
            try:
                messages.append({"role": m.role, "content": m.text})
            except Exception:
                continue

        # Forward state.tools so runners without a native tools API (Dify chat)
        # can inject them into the prompt. inspect_ai stores tools as the raw
        # decorated functions; wrap each in ToolDef to extract name / description /
        # parameters reliably across versions, then strip ToolParams nulls so the
        # JSON catalog the runner injects stays compact.
        def _strip_nulls(obj):
            if isinstance(obj, dict):
                return {k: _strip_nulls(v) for k, v in obj.items() if v is not None}
            if isinstance(obj, list):
                return [_strip_nulls(v) for v in obj]
            return obj

        tools_payload: list[dict] = []
        for t in getattr(state, "tools", None) or []:
            try:
                td = ToolDef(t)
                name = getattr(td, "name", None) or ""
                if not name:
                    continue
                params_dict: dict = {}
                p = getattr(td, "parameters", None)
                if p is not None:
                    try:
                        params_dict = p.model_dump()
                    except Exception:
                        try:
                            params_dict = p.dict()
                        except Exception:
                            params_dict = {}
                tools_payload.append(
                    {
                        "name": str(name),
                        "description": str(getattr(td, "description", "") or ""),
                        "parameters": _strip_nulls(params_dict),
                    }
                )
            except Exception:
                continue

        payload = {
            "agentId": int(agent_id),
            "jobId": job_id,
            "sampleId": str(state.sample_id),
            "input": getattr(state, "input_text", "") or "",
            "messages": messages,
            "metadata": dict(state.metadata or {}),
            "target": target_value,
            "tools": tools_payload,
        }

        headers = {"Content-Type": "application/json"}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        url = f"{base_url}/api/internal/agent-runner/invoke"
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()

        # Backend returns { code, message, data: { output, latencyMs?, toolCalls?, raw? } }
        body = data.get("data") if isinstance(data, dict) else None
        output = ""
        tool_calls_raw: list = []
        if isinstance(body, dict):
            output = body.get("output") or ""
            tcs = body.get("toolCalls")
            if isinstance(tcs, list):
                tool_calls_raw = tcs
        if not isinstance(output, str):
            try:
                output = json.dumps(output, ensure_ascii=False)
            except Exception:
                output = str(output)

        # Synthesize an inspect_ai message sequence:
        # one assistant turn carrying the tool_calls, then one ChatMessageTool per
        # call holding its result, then a final assistant turn with the answer.
        # This is what tool-use scorers expect to walk over.
        tool_calls = [tc for tc in (_to_tool_call(t) for t in tool_calls_raw) if tc is not None]
        if tool_calls:
            state.messages.append(
                ChatMessageAssistant(content="", tool_calls=tool_calls)
            )
            for raw, tc in zip(tool_calls_raw, tool_calls):
                if not isinstance(raw, dict):
                    continue
                result = raw.get("result")
                if result is None:
                    result = ""
                if not isinstance(result, str):
                    try:
                        result = json.dumps(result, ensure_ascii=False)
                    except Exception:
                        result = str(result)
                state.messages.append(
                    ChatMessageTool(
                        content=result,
                        tool_call_id=tc.id,
                        function=tc.function if hasattr(tc, "function") else getattr(tc, "name", ""),
                    )
                )

        state.messages.append(ChatMessageAssistant(content=output))
        state.output.completion = output
        return state

    return solve
