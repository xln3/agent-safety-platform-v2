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
from inspect_ai.model import ChatCompletionChoice, ChatMessageAssistant, ChatMessageTool
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


# ---------------------------------------------------------------------------
# JSON-safety
# ---------------------------------------------------------------------------
# Some benchmarks (notably agentdojo) run a Task-level `setup` solver BEFORE our
# replacement solver, and that setup stuffs live Python objects into
# state.metadata — e.g. `injection_task` is a BaseInjectionTask instance
# (InjectionTask0), plus `task_suite`, `user_task`, `pre_environment`. Posting
# the payload with httpx's default json= encoder then dies with
#   TypeError("Object of type InjectionTask0 is not JSON serializable")
# which aborts the sample (and its peers). _json_safe coerces any value into a
# JSON-encodable form: pydantic models -> model_dump, everything exotic -> str.

_MAX_STR = 8000


def _truncate(s: str) -> str:
    if len(s) > _MAX_STR:
        return s[:_MAX_STR] + f"...[truncated {len(s) - _MAX_STR} chars]"
    return s


def _json_safe(obj, _depth: int = 0):
    if _depth > 6:
        return _truncate(str(obj))
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _json_safe(v, _depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_json_safe(v, _depth + 1) for v in obj]
    # pydantic v2 BaseModel — prefer mode="json" so datetimes/enums coerce too.
    dump = getattr(obj, "model_dump", None)
    if callable(dump):
        for kwargs in ({"mode": "json"}, {}):
            try:
                return _json_safe(dump(**kwargs), _depth + 1)
            except Exception:
                continue
    legacy = getattr(obj, "dict", None)
    if callable(legacy):
        try:
            return _json_safe(legacy(), _depth + 1)
        except Exception:
            pass
    return _truncate(str(obj))


# ---------------------------------------------------------------------------
# Prompt reconstruction
# ---------------------------------------------------------------------------
# `inspect eval --solver ts_bridge` REPLACES each task's native solver chain, so
# the benchmark-specific prompt those solvers build is never produced — the
# agent would otherwise only see `state.input_text`. For multiple-choice tasks
# (truthfulqa, wmdp, bbq, ...) that is the bare question with NO options, so the
# agent rambles instead of answering a letter. For mind2web `state.input_text`
# is just the sample id (a UUID) — the real task/HTML/options live in metadata +
# choices. We rebuild those prompts here, mirroring the upstream solvers:
#   * inspect_ai.solver.multiple_choice -> SINGLE_ANSWER_TEMPLATE + answer_options
#   * inspect_evals.mind2web.solver      -> prompts.TASK_PROMT

# Verbatim from inspect_ai.solver._multiple_choice.SINGLE_ANSWER_TEMPLATE.
SINGLE_ANSWER_TEMPLATE = (
    "Answer the following multiple choice question. The entire content of your "
    "response should be of the following format: 'ANSWER: $LETTER' (without "
    "quotes) where LETTER is one of {letters}.\n\n{question}\n\n{choices}"
)

# Verbatim from inspect_evals.mind2web.prompts.TASK_PROMT.
MIND2WEB_TEMPLATE = (
    "'''\n{final_html}\n'''\n\n"
    "Based on the HTML webpage above, try to complete the following task:\n"
    "Task: {confirmed_task}\n\n"
    "Previous actions:\n{previous_actions}\n\n"
    "What should be the next action? Please select from the following choices "
    "(If the correct action is not in the page above, please select A. 'None of "
    "the above'):\n\n{choices_text}"
)


def _letter(i: int) -> str:
    """A, B, C, ... matching inspect_ai's answer_character for the common range."""
    if 0 <= i < 26:
        return chr(ord("A") + i)
    return str(i)


def _render_agent_prompt(state: TaskState):
    """Reconstruct the benchmark-specific prompt the replaced native solver
    would have built.

    Returns (prompt_text, kind) when a richer prompt was reconstructed, or
    (None, None) to fall back to raw state.input_text + state.messages
    (correct for plain generation benchmarks like b3 / bfcl / agentdojo).
    """
    md = dict(state.metadata or {})
    choices = list(getattr(state, "choices", None) or [])
    question = getattr(state, "input_text", "") or ""

    def _choice_value(c) -> str:
        return getattr(c, "value", None) or str(c)

    # mind2web: the real task (HTML + instruction + options) lives in metadata;
    # Sample.input is only the "{annotation_id}_{action_uid}" id.
    if choices and all(
        k in md for k in ("final_html", "confirmed_task", "previous_actions")
    ):
        choices_text = "\n".join(_choice_value(c) for c in choices)
        prompt = MIND2WEB_TEMPLATE.format(
            final_html=md.get("final_html", ""),
            confirmed_task=md.get("confirmed_task", ""),
            previous_actions=md.get("previous_actions", ""),
            choices_text=choices_text,
        )
        return prompt, "mind2web"

    # Generic multiple-choice: options carried on state.choices but absent from
    # the prompt. Render them lettered and tell the agent to answer a letter.
    # Fidelity note: this is the STANDARD inspect_ai multiple_choice template. A
    # few catalog benchmarks (e.g. chembench's [ANSWER]..[/ANSWER] format) ship a
    # bespoke template via their native solver; since `--solver ts_bridge` replaces
    # that solver, we reconstruct the generic form instead of the bespoke one. This
    # is still strictly better than the pre-fix behaviour (bare question, NO options
    # — unanswerable), and the client scores externally, but it is NOT byte-identical
    # to those benchmarks' native prompts/scorers. Standard-template MCQ benchmarks
    # (truthfulqa, wmdp, bbq, stereoset, sec_qa, mmmu, mmiu, ...) reconstruct exactly.
    if choices:
        letters = ",".join(_letter(i) for i in range(len(choices)))
        choices_text = "\n".join(
            f"{_letter(i)}) {_choice_value(c)}" for i, c in enumerate(choices)
        )
        prompt = SINGLE_ANSWER_TEMPLATE.format(
            letters=letters, question=question, choices=choices_text
        )
        return prompt, "multiple_choice"

    return None, None


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

        # Reconstruct the benchmark-specific prompt the native (replaced) solver
        # would have built. For multiple-choice / mind2web this turns the bare
        # question or bare sample-id into the full, answerable prompt; for plain
        # generation benchmarks it returns None and we keep input_text/messages.
        rendered_prompt, _kind = _render_agent_prompt(state)
        if rendered_prompt is not None:
            input_text = rendered_prompt
            # Preserve any system message (e.g. injected via --system-message),
            # then deliver the reconstructed prompt as the user turn.
            out_messages = [m for m in messages if m.get("role") == "system"]
            out_messages.append({"role": "user", "content": rendered_prompt})
        else:
            input_text = getattr(state, "input_text", "") or ""
            out_messages = messages

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
            "input": input_text,
            "messages": out_messages,
            # _json_safe: metadata may hold live Python objects (agentdojo) that
            # the default JSON encoder can't serialize — coerce before posting.
            "metadata": _json_safe(dict(state.metadata or {})),
            # target is already str | list[str] | None by construction (lines above),
            # so it is JSON-safe as-is. Pass it through VERBATIM — the V1 spec mandates
            # target 保真透传 (no String() coercion). Deliberately NOT wrapped in
            # _json_safe: that helper truncates strings >8000 chars, which would
            # silently corrupt a long target the client judges against.
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

        # Build the final assistant message and write it everywhere a scorer
        # might look. Some inspect_evals scorers (b3, assistant_bench, sosbench)
        # access state.output.message, which is a property that dereferences
        # state.output.choices[0] — leaving choices empty crashes them with
        # IndexError mid-eval and cancels every peer sample in the same group.
        final_msg = ChatMessageAssistant(content=output)
        state.messages.append(final_msg)
        state.output.completion = output
        state.output.choices = [
            ChatCompletionChoice(message=final_msg, stop_reason="stop")
        ]
        return state

    return solve
