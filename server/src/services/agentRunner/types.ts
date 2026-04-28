import type { Agent } from '../../models';

/**
 * Tool spec forwarded by ts_bridge_solver from inspect_ai's `state.tools`.
 * Kept loose because Dify chat doesn't have a native tools field — runners
 * inject these into the prompt as a catalog the model can read.
 */
export interface AgentToolSpec {
  name: string;
  description?: string;
  /** JSON Schema (loose) describing the tool's parameters. */
  parameters?: Record<string, any>;
}

/** Payload posted by ts_bridge_solver.py to /api/internal/agent-runner/invoke. */
export interface RunnerInput {
  agentId: number;
  jobId?: number | null;
  sampleId: string;
  input: string;
  messages: { role: string; content: string }[];
  metadata: Record<string, any>;
  target?: string | string[] | null;
  /**
   * Tools the underlying inspect_ai Task wired up (web_search, web_browser, …).
   * Empty when the benchmark didn't declare any. Runners that lack a native
   * tools API (Dify chat) inject this list into the prompt; runners that do
   * (OpenAI-compat) can pass it through verbatim.
   */
  tools?: AgentToolSpec[];
}

/**
 * One tool invocation observed during the agent's run, in OpenAI-compatible
 * shape. The Dify chat/workflow runners synthesize these from streaming
 * agent_thought / node_finished events; the OpenAI runner could populate them
 * verbatim from the API response. Persisted to EvalItem.toolCallsJson and
 * forwarded to inspect_ai by ts_bridge_solver as ChatMessageAssistant.tool_calls
 * + ChatMessageTool sequences so tool-use scorers can grade them.
 */
export interface AgentToolCall {
  /** Stable per-call id; ts-bridge uses this to pair assistant.tool_calls with the tool result. */
  id: string;
  /** Tool / function name as the agent saw it. */
  name: string;
  /** Arguments as a JSON string (OpenAI tool_calls convention). Empty string when unknown. */
  arguments: string;
  /** Tool's textual result / observation, when the agent surfaced one. */
  result?: string;
  /** Free-form metadata for diagnostics (node type, latency, status, etc.). */
  metadata?: Record<string, any>;
}

export interface RunnerOutput {
  output: string;
  latencyMs: number;
  raw?: unknown;
  /** Tool invocations performed by the agent during this sample, in call order. */
  toolCalls?: AgentToolCall[];
}

export interface AgentRunner {
  run(agent: Agent, input: RunnerInput): Promise<RunnerOutput>;
}
