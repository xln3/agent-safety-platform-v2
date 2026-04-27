"""ts_bridge solver — reverse-callback bridge from inspect_ai into the TS backend.

Each sample's solve step issues an HTTP POST to the TS backend, which dispatches
to the appropriate per-form runner (openai_compat / dify_chat / dify_workflow / cli)
and returns the agent's textual output. We then attach that output to the
TaskState as an assistant message so inspect_ai's scorer can grade it.

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
from inspect_ai.model import ChatMessageAssistant
from inspect_ai.solver import Generate, Solver, TaskState, solver


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

        payload = {
            "agentId": int(agent_id),
            "jobId": job_id,
            "sampleId": str(state.sample_id),
            "input": getattr(state, "input_text", "") or "",
            "messages": messages,
            "metadata": dict(state.metadata or {}),
            "target": target_value,
        }

        headers = {"Content-Type": "application/json"}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        url = f"{base_url}/api/internal/agent-runner/invoke"
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()

        # Backend returns { code, message, data: { output, latencyMs?, raw? } }
        body = data.get("data") if isinstance(data, dict) else None
        output = ""
        if isinstance(body, dict):
            output = body.get("output") or ""
        if not isinstance(output, str):
            try:
                output = json.dumps(output, ensure_ascii=False)
            except Exception:
                output = str(output)

        state.messages.append(ChatMessageAssistant(content=output))
        state.output.completion = output
        return state

    return solve
