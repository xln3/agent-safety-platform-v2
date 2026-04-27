import axios from 'axios';
import type { AgentRunner, RunnerInput, RunnerOutput } from './types';
import type { Agent } from '../../models';
import logger from '../../utils/logger';

interface OpenAICompatConfig {
  apiBase: string;
  apiKey: string;
  modelId: string;
  systemPrompt?: string | null;
}

function readConfig(agent: Agent): OpenAICompatConfig {
  const cfg = (agent.config as any) || {};
  return {
    apiBase: cfg.apiBase || agent.apiBase || '',
    apiKey: cfg.apiKey || agent.apiKey || '',
    modelId: cfg.modelId || agent.modelId || '',
    systemPrompt: cfg.systemPrompt ?? agent.systemPrompt ?? null,
  };
}

export const openaiRunner: AgentRunner = {
  async run(agent: Agent, input: RunnerInput): Promise<RunnerOutput> {
    const cfg = readConfig(agent);
    if (!cfg.apiBase || !cfg.apiKey || !cfg.modelId) {
      throw new Error(
        `Agent ${agent.id} (${agent.name}) missing OpenAI-compat config (apiBase/apiKey/modelId)`,
      );
    }

    const messages: { role: string; content: string }[] = [];
    if (cfg.systemPrompt) {
      messages.push({ role: 'system', content: cfg.systemPrompt });
    }
    if (input.messages && input.messages.length > 0) {
      for (const m of input.messages) {
        if (m.role === 'system' && cfg.systemPrompt) continue;
        messages.push({ role: m.role, content: m.content });
      }
    } else {
      messages.push({ role: 'user', content: input.input });
    }

    const url = `${cfg.apiBase.replace(/\/+$/, '')}/chat/completions`;
    const startedAt = Date.now();

    const resp = await axios.post(
      url,
      {
        model: cfg.modelId,
        messages,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 120_000,
      },
    );

    const latencyMs = Date.now() - startedAt;
    const choice = resp.data?.choices?.[0];
    const content = choice?.message?.content ?? '';
    if (typeof content !== 'string') {
      logger.warn(`OpenAI runner got non-string content for agent ${agent.id}`);
      return { output: JSON.stringify(content), latencyMs, raw: resp.data };
    }
    return { output: content, latencyMs, raw: resp.data };
  },
};

export default openaiRunner;
