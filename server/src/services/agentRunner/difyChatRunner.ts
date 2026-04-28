import axios from 'axios';
import { randomUUID } from 'crypto';
import type { AgentRunner, AgentToolCall, AgentToolSpec, RunnerInput, RunnerOutput } from './types';
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
 * Render an inspect_ai-forwarded tool catalog into a prompt block the model
 * can read. Dify chat has no native tools field, so the only way to expose
 * tools is to describe them in text and ask the model to emit a sentinel line.
 *
 * Format chosen for stability:
 *   TOOL_CALL: {"name": "<tool>", "arguments": {...}}
 * Anchored to a fixed prefix so a regex catches it regardless of surrounding
 * markdown / quotes the model might add.
 */
function formatToolCatalog(tools: AgentToolSpec[]): string {
  const lines: string[] = [
    'You have access to the following tools. When you need to use a tool, emit',
    'EXACTLY one line in this format and then stop generating immediately:',
    '',
    '  TOOL_CALL: {"name": "<tool_name>", "arguments": {<json_args>}}',
    '',
    'Rules:',
    '- The TOOL_CALL line must be on its own line, starting with the literal prefix "TOOL_CALL:".',
    '- "arguments" must be a valid JSON object (use {} when no arguments).',
    '- Do not wrap TOOL_CALL in code fences or markdown.',
    '- Do not produce more than one TOOL_CALL per response.',
    '- If you can answer without tools, do not emit TOOL_CALL — answer directly.',
    '',
    'Available tools:',
  ];
  for (const t of tools) {
    const params = t.parameters && Object.keys(t.parameters).length ? JSON.stringify(t.parameters) : '{}';
    lines.push(`- name: ${t.name}`);
    if (t.description) lines.push(`  description: ${t.description}`);
    lines.push(`  parameters_schema: ${params}`);
  }
  return lines.join('\n');
}

/**
 * Parse `TOOL_CALL: {...}` sentinel lines from model output. Tolerates:
 *   - leading whitespace
 *   - both `"args"` and `"arguments"` keys
 *   - Chinese full-width colons (`：`) in case the model translates the prefix
 *   - JSON that runs past one line (greedy match through balanced braces)
 *
 * Returns the matched calls AND the cleaned text (sentinel lines stripped) so
 * the assistant turn surfaced to scorers carries only the natural-language
 * portion of the answer.
 */
function parseToolCallsFromText(
  text: string,
): { calls: { name: string; arguments: string }[]; cleaned: string } {
  const calls: { name: string; arguments: string }[] = [];
  if (!text) return { calls, cleaned: text };

  // Match `TOOL_CALL` (case-insensitive), optional spaces, ASCII or full-width
  // colon, then a JSON object captured by balanced-brace counting.
  const prefixRe = /TOOL_CALL\s*[:：]\s*/gi;
  let cleaned = text;
  let match: RegExpExecArray | null;
  const removals: { start: number; end: number }[] = [];

  while ((match = prefixRe.exec(text)) !== null) {
    const jsonStart = match.index + match[0].length;
    if (text[jsonStart] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\' && inStr) {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) continue;
    const jsonStr = text.slice(jsonStart, end);
    try {
      const parsed = JSON.parse(jsonStr);
      const name = typeof parsed?.name === 'string' ? parsed.name : '';
      if (!name) continue;
      const argsObj = parsed.arguments ?? parsed.args ?? {};
      const argsStr = typeof argsObj === 'string' ? argsObj : JSON.stringify(argsObj);
      calls.push({ name, arguments: argsStr });
      removals.push({ start: match.index, end });
    } catch {
      // Malformed JSON in TOOL_CALL — skip and let the natural-language
      // portion stay as-is.
    }
  }

  if (removals.length > 0) {
    // Strip in reverse so indices stay valid.
    for (let i = removals.length - 1; i >= 0; i--) {
      const r = removals[i];
      cleaned = cleaned.slice(0, r.start) + cleaned.slice(r.end);
    }
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  }

  return { calls, cleaned };
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

    // Dify /chat-messages has no system role: flatten cfg + injected ChatMessageSystem
    // into a [SYSTEM] block at query head so raccoon-style prompt-leak benchmarks
    // can actually reach the model with the template they want it to leak.
    const cfgSystem = (cfg.systemPrompt || '').trim();
    const injectedSystem: string[] = [];
    const turns: { role: string; content: string }[] = [];

    if (input.messages && input.messages.length > 0) {
      for (const m of input.messages) {
        const content = (m.content || '').trim();
        if (!content) continue;
        if (m.role === 'system') {
          injectedSystem.push(content);
        } else if (m.role === 'user' || m.role === 'assistant') {
          turns.push({ role: m.role, content });
        }
      }
    }

    // Tool catalog injection: Dify chat has no tools API, so describe the
    // benchmark's tools in the [SYSTEM] block and ask the model to emit
    // `TOOL_CALL: {...}` sentinel lines we can parse out.
    const toolCatalog = (input.tools && input.tools.length > 0)
      ? formatToolCatalog(input.tools)
      : '';

    let body: string;
    if (turns.length === 0) {
      body = input.input || '';
    } else if (turns.length === 1 && turns[0].role === 'user') {
      body = turns[0].content;
    } else {
      body = turns.map((t) => `${t.role}: ${t.content}`).join('\n\n');
    }

    let query = body;
    const systemParts = [cfgSystem, ...injectedSystem, toolCatalog].filter(Boolean);
    if (systemParts.length > 0) {
      const systemBlock = systemParts.join('\n\n');
      // Always wrap in [SYSTEM] when there's an injected tool catalog or an
      // inspect_ai-injected ChatMessageSystem, so the model sees a clear
      // boundary between operator instructions and the user query.
      if (injectedSystem.length > 0 || toolCatalog) {
        query = `[SYSTEM]\n${systemBlock}\n[/SYSTEM]\n\n${body}`;
      } else {
        query = `${systemBlock}\n\n${body}`;
      }
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

    // Prompt-injected tool-call extraction: when the benchmark forwarded a
    // tool catalog (input.tools), scan the model's natural-language answer
    // for `TOOL_CALL: {...}` sentinel lines and surface them as AgentToolCalls
    // alongside whatever Dify already reported via agent_thought.
    if (input.tools && input.tools.length > 0 && answer) {
      const { calls, cleaned } = parseToolCallsFromText(answer);
      if (calls.length > 0) {
        const allowedNames = new Set(input.tools.map((t) => t.name));
        for (const c of calls) {
          if (!allowedNames.has(c.name)) {
            logger.warn(
              `Dify chat sample ${input.sampleId} emitted TOOL_CALL for unknown tool "${c.name}"; keeping anyway`,
            );
          }
          toolCalls.push({
            id: `dify-injected-${randomUUID()}`,
            name: c.name,
            arguments: c.arguments,
            metadata: { source: 'dify_chat.prompt_injected' },
          });
        }
        // Strip the sentinel lines from the surfaced answer so scorers grade
        // the natural-language portion only.
        answer = cleaned;
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
