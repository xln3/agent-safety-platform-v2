import axios from 'axios';
import { randomUUID } from 'crypto';
import type { AgentRunner, RunnerInput, RunnerOutput } from './types';
import type { Agent } from '../../models';

interface DifyWorkflowConfig {
  apiBase: string;
  apiKey: string;
  inputVariableMapping: Record<string, string>;
}

function readConfig(agent: Agent): DifyWorkflowConfig {
  const cfg = (agent.config as any) || {};
  return {
    apiBase: cfg.apiBase || agent.apiBase || '',
    apiKey: cfg.apiKey || agent.apiKey || '',
    inputVariableMapping: cfg.inputVariableMapping || {},
  };
}

/**
 * Resolve a sample-field path like "input", "metadata.query", "messages[0].content"
 * against the runner input. Returns the value as a string (JSON-stringifies non-strings).
 */
function resolveSampleField(input: RunnerInput, path: string): string {
  if (path === 'input') return input.input || '';
  if (path === 'sampleId') return input.sampleId;

  const segments: (string | number)[] = [];
  for (const part of path.split('.')) {
    const m = part.match(/^([^\[]+)((?:\[\d+\])*)$/);
    if (!m) {
      segments.push(part);
      continue;
    }
    segments.push(m[1]);
    const idxRest = m[2];
    if (idxRest) {
      for (const idx of idxRest.matchAll(/\[(\d+)\]/g)) {
        segments.push(parseInt(idx[1], 10));
      }
    }
  }

  let cur: any = { input: input.input, messages: input.messages, metadata: input.metadata };
  for (const seg of segments) {
    if (cur == null) return '';
    cur = cur[seg as any];
  }
  if (cur == null) return '';
  return typeof cur === 'string' ? cur : JSON.stringify(cur);
}

/** Dify /workflows/run with mapped inputs. */
export const difyWorkflowRunner: AgentRunner = {
  async run(agent: Agent, input: RunnerInput): Promise<RunnerOutput> {
    const cfg = readConfig(agent);
    if (!cfg.apiBase || !cfg.apiKey) {
      throw new Error(`Agent ${agent.id} (${agent.name}) missing Dify workflow config`);
    }
    const mapping = cfg.inputVariableMapping || {};
    if (Object.keys(mapping).length === 0) {
      throw new Error(`Agent ${agent.id} has empty inputVariableMapping`);
    }

    const inputs: Record<string, string> = {};
    for (const [workflowVar, samplePath] of Object.entries(mapping)) {
      inputs[workflowVar] = resolveSampleField(input, samplePath);
    }

    const url = `${cfg.apiBase.replace(/\/+$/, '')}/workflows/run`;
    const startedAt = Date.now();

    const resp = await axios.post(
      url,
      {
        inputs,
        response_mode: 'blocking',
        user: `eval-${input.jobId ?? 'na'}-${input.sampleId}-${randomUUID().slice(0, 8)}`,
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 300_000,
      },
    );

    const latencyMs = Date.now() - startedAt;
    const outputs = resp.data?.data?.outputs;
    let textOutput = '';
    if (typeof outputs === 'string') {
      textOutput = outputs;
    } else if (outputs && typeof outputs === 'object') {
      const keys = Object.keys(outputs);
      if (keys.length === 1) {
        const v = outputs[keys[0]];
        textOutput = typeof v === 'string' ? v : JSON.stringify(v);
      } else {
        textOutput = JSON.stringify(outputs);
      }
    }
    return { output: textOutput, latencyMs, raw: resp.data };
  },
};

export default difyWorkflowRunner;
