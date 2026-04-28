import axios from 'axios';
import { randomUUID } from 'crypto';
import type { AgentRunner, AgentToolCall, RunnerInput, RunnerOutput } from './types';
import type { Agent } from '../../models';
import logger from '../../utils/logger';

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

interface AgentThoughtEvent {
  event: 'agent_thought';
  id?: string;
  position?: number;
  thought?: string;
  observation?: string;
  /** Single tool name, or comma/semicolon-separated list when the agent chained multiple in one step. */
  tool?: string;
  /** JSON-encoded object keyed by tool name → its arguments object. */
  tool_input?: string;
  message_id?: string;
  task_id?: string;
}

interface MessageChunkEvent {
  event: 'message' | 'agent_message';
  answer?: string;
  message_id?: string;
  conversation_id?: string;
}

interface MessageEndEvent {
  event: 'message_end';
  metadata?: Record<string, any>;
  conversation_id?: string;
}

interface ErrorEvent {
  event: 'error';
  status?: number;
  code?: string;
  message?: string;
}

type DifyEvent = AgentThoughtEvent | MessageChunkEvent | MessageEndEvent | ErrorEvent | { event: string };

function parseSSEData(line: string): DifyEvent | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload) as DifyEvent;
  } catch {
    return null;
  }
}

/**
 * Convert one Dify agent_thought event into 0..N OpenAI-style tool calls.
 * Dify packs all tools the agent decided to invoke into a single thought:
 *   - `tool` is a string; comma- or semicolon-separated when chained.
 *   - `tool_input` is a JSON-encoded object keyed by tool name → args.
 *   - `observation` is the textual result returned by the agent loop.
 *
 * One AgentToolCall per tool keeps grading granular for inspect_ai's
 * tool-use scorers (agentdojo, agentharm, bfcl).
 */
function thoughtToToolCalls(ev: AgentThoughtEvent): AgentToolCall[] {
  if (!ev.tool || !ev.tool.trim()) return [];
  const toolNames = ev.tool
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (toolNames.length === 0) return [];

  let inputsByTool: Record<string, any> = {};
  if (ev.tool_input) {
    try {
      const parsed = JSON.parse(ev.tool_input);
      if (parsed && typeof parsed === 'object') inputsByTool = parsed as Record<string, any>;
    } catch {
      // Older Dify versions send tool_input as a raw string when there's only
      // one tool — use it verbatim as the args for the first tool.
      inputsByTool = { [toolNames[0]]: ev.tool_input };
    }
  }

  return toolNames.map((name, idx) => {
    const args = inputsByTool[name] ?? {};
    const argsString = typeof args === 'string' ? args : JSON.stringify(args);
    return {
      id: `dify-${ev.id || ev.message_id || randomUUID()}-${idx}`,
      name,
      arguments: argsString,
      // Observation is at the thought level, attribute to first tool call only.
      result: idx === 0 ? ev.observation : undefined,
      metadata: {
        position: ev.position ?? idx,
        thought: ev.thought ?? null,
        source: 'dify_chat.agent_thought',
      },
    };
  });
}

/** Dify /chat-messages, streaming so agent_thought events surface tool_calls. */
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
        response_mode: 'streaming',
        user: `eval-${input.jobId ?? 'na'}-${input.sampleId}-${randomUUID().slice(0, 8)}`,
        conversation_id: '',
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        timeout: 180_000,
        responseType: 'stream',
      },
    );

    let answer = '';
    const toolCalls: AgentToolCall[] = [];
    let lastEndMetadata: Record<string, any> | undefined;
    let buffer = '';
    let streamError: string | null = null;

    const consumeFrame = (frame: string) => {
      // SSE frame can be multiple lines; only data: lines carry payloads.
      for (const line of frame.split('\n')) {
        const ev = parseSSEData(line);
        if (!ev) continue;
        switch (ev.event) {
          case 'message':
          case 'agent_message': {
            answer += (ev as MessageChunkEvent).answer || '';
            break;
          }
          case 'agent_thought': {
            toolCalls.push(...thoughtToToolCalls(ev as AgentThoughtEvent));
            break;
          }
          case 'message_end': {
            lastEndMetadata = (ev as MessageEndEvent).metadata;
            break;
          }
          case 'error': {
            const e = ev as ErrorEvent;
            streamError = `Dify chat stream error: ${e.code || e.status || 'unknown'} ${e.message || ''}`;
            break;
          }
          default:
            // ignore tts_message, ping, message_replace, etc.
            break;
        }
      }
    };

    await new Promise<void>((resolve, reject) => {
      resp.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          consumeFrame(frame);
        }
      });
      resp.data.on('end', () => {
        if (buffer.trim().length > 0) consumeFrame(buffer);
        resolve();
      });
      resp.data.on('error', (err: Error) => reject(err));
    });

    const latencyMs = Date.now() - startedAt;

    if (streamError) throw new Error(streamError);

    if (!answer && toolCalls.length > 0) {
      // Agentic flows can finish entirely inside thoughts when the final
      // observation IS the answer; fall back to the last thought so the
      // scorer has text to grade.
      const lastThought = (toolCalls[toolCalls.length - 1].metadata as any)?.thought;
      if (typeof lastThought === 'string' && lastThought.trim()) {
        answer = lastThought;
        logger.warn(
          `Dify chat sample ${input.sampleId} produced no message chunks; falling back to last thought (${answer.length} chars)`,
        );
      }
    }

    return {
      output: answer,
      latencyMs,
      raw: { metadata: lastEndMetadata, toolCallCount: toolCalls.length },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  },
};

export default difyChatRunner;
