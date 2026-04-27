import type { Agent } from '../../models';

/** Payload posted by ts_bridge_solver.py to /api/internal/agent-runner/invoke. */
export interface RunnerInput {
  agentId: number;
  jobId?: number | null;
  sampleId: string;
  input: string;
  messages: { role: string; content: string }[];
  metadata: Record<string, any>;
  target?: string | string[] | null;
}

export interface RunnerOutput {
  output: string;
  latencyMs: number;
  raw?: unknown;
}

export interface AgentRunner {
  run(agent: Agent, input: RunnerInput): Promise<RunnerOutput>;
}
