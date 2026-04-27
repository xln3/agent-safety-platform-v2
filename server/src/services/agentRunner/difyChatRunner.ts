import axios from 'axios';
import { randomUUID } from 'crypto';
import type { AgentRunner, RunnerInput, RunnerOutput } from './types';
import type { Agent } from '../../models';

interface DifyChatConfig {
  apiBase: string;
  apiKey: string;
  systemPrompt?: string | null;
}

function readConfig(agent: Agent): DifyChatConfig {
  const cfg = (agent.config as any) || {};
  return {
    apiBase: cfg.apiBase || agent.apiBase || '',
    apiKey: cfg.apiKey || agent.apiKey || '',
    systemPrompt: cfg.systemPrompt ?? agent.systemPrompt ?? null,
  };
}

/** Dify /chat-messages — fresh conversation per sample (no conversation_id passthrough). */
export const difyChatRunner: AgentRunner = {
  async run(agent: Agent, input: RunnerInput): Promise<RunnerOutput> {
    const cfg = readConfig(agent);
    if (!cfg.apiBase || !cfg.apiKey) {
      throw new Error(`Agent ${agent.id} (${agent.name}) missing Dify chat config (apiBase/apiKey)`);
    }

    let query = input.input || '';
    if (cfg.systemPrompt) {
      query = `${cfg.systemPrompt}\n\n${query}`;
    }

    const url = `${cfg.apiBase.replace(/\/+$/, '')}/chat-messages`;
    const startedAt = Date.now();

    const resp = await axios.post(
      url,
      {
        inputs: {},
        query,
        response_mode: 'blocking',
        user: `eval-${input.jobId ?? 'na'}-${input.sampleId}-${randomUUID().slice(0, 8)}`,
        conversation_id: '',
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 180_000,
      },
    );

    const latencyMs = Date.now() - startedAt;
    const answer = resp.data?.answer;
    if (typeof answer !== 'string') {
      throw new Error(`Dify chat returned non-string answer: ${JSON.stringify(resp.data).slice(0, 200)}`);
    }
    return { output: answer, latencyMs, raw: resp.data };
  },
};

export default difyChatRunner;
