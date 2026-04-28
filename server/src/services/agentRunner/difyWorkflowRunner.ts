import axios from 'axios';
import { randomUUID } from 'crypto';
import type { AgentRunner, AgentToolCall, RunnerInput, RunnerOutput } from './types';
import type { Agent } from '../../models';
import logger from '../../utils/logger';

interface DifyWorkflowConfig {
  apiBase: string;
  apiKey: string;
  inputVariableMapping: Record<string, string>;
  /** Workflow output field whose value is the assistant text. Optional; falls back to single-key heuristic. */
  outputField?: string | null;
}

function readConfig(agent: Agent): DifyWorkflowConfig {
  const cfg = (agent.config as any) || {};
  return {
    apiBase: cfg.apiBase || agent.apiBase || '',
    apiKey: cfg.apiKey || agent.apiKey || '',
    inputVariableMapping: cfg.inputVariableMapping || {},
    outputField: cfg.outputField ?? null,
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

interface NodeStartedEvent {
  event: 'node_started';
  data?: {
    id?: string;
    node_id?: string;
    node_type?: string;
    title?: string;
    inputs?: Record<string, any>;
    index?: number;
  };
}

interface NodeFinishedEvent {
  event: 'node_finished';
  data?: {
    id?: string;
    node_id?: string;
    node_type?: string;
    title?: string;
    inputs?: Record<string, any>;
    outputs?: Record<string, any> | string | null;
    process_data?: Record<string, any> | null;
    status?: string;
    error?: string | null;
    elapsed_time?: number;
    index?: number;
  };
}

interface WorkflowFinishedEvent {
  event: 'workflow_finished';
  data?: {
    id?: string;
    workflow_id?: string;
    status?: string;
    outputs?: Record<string, any> | string | null;
    error?: string | null;
    elapsed_time?: number;
  };
}

interface TextChunkEvent {
  event: 'text_chunk';
  data?: { text?: string; from_variable_selector?: string[] };
}

interface ErrorEvent {
  event: 'error';
  status?: number;
  code?: string;
  message?: string;
}

type DifyEvent =
  | NodeStartedEvent
  | NodeFinishedEvent
  | WorkflowFinishedEvent
  | TextChunkEvent
  | ErrorEvent
  | { event: string };

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
 * Node types whose execution counts as a "tool call" for grading purposes.
 * - tool: explicit Dify tool node (search, weather, custom plugins, etc.)
 * - http-request / http_request: outbound API hit
 * - code: sandboxed script the agent ran
 * - knowledge-retrieval / knowledge_retrieval: RAG fetch (counts as a "retrieval tool")
 * - agent: nested agent node (its sub-tool-calls are not surfaced; treat the whole agent as one call)
 */
const TOOL_NODE_TYPES = new Set([
  'tool',
  'http-request',
  'http_request',
  'code',
  'knowledge-retrieval',
  'knowledge_retrieval',
  'agent',
]);

function nodeFinishedToToolCall(data: NodeFinishedEvent['data']): AgentToolCall | null {
  if (!data) return null;
  const nodeType = (data.node_type || '').toLowerCase();
  if (!TOOL_NODE_TYPES.has(nodeType)) return null;

  const args = data.inputs ?? data.process_data ?? {};
  const argsString = typeof args === 'string' ? args : JSON.stringify(args ?? {});
  let resultStr: string | undefined;
  if (data.outputs != null) {
    resultStr = typeof data.outputs === 'string' ? data.outputs : JSON.stringify(data.outputs);
  } else if (data.error) {
    resultStr = `ERROR: ${data.error}`;
  }

  return {
    id: `dify-wf-${data.id || data.node_id || randomUUID()}`,
    name: data.title || data.node_id || nodeType,
    arguments: argsString,
    result: resultStr,
    metadata: {
      nodeType,
      nodeId: data.node_id ?? null,
      status: data.status ?? null,
      elapsedMs: data.elapsed_time != null ? Math.round(data.elapsed_time * 1000) : null,
      index: data.index ?? null,
      source: 'dify_workflow.node_finished',
    },
  };
}

function extractWorkflowOutput(
  outputs: Record<string, any> | string | null | undefined,
  outputField: string | null | undefined,
): string {
  if (outputs == null) return '';
  if (typeof outputs === 'string') return outputs;
  if (typeof outputs !== 'object') return String(outputs);

  if (outputField && outputField in outputs) {
    const v = outputs[outputField];
    return typeof v === 'string' ? v : JSON.stringify(v);
  }

  const keys = Object.keys(outputs);
  if (keys.length === 1) {
    const v = outputs[keys[0]];
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  return JSON.stringify(outputs);
}

/**
 * Dify /workflows/run, streaming so node_finished events surface tool-like node
 * executions (tool / http-request / code / knowledge-retrieval / agent) as
 * AgentToolCall[]. Falls back to workflow_finished.outputs for the final answer.
 */
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
        response_mode: 'streaming',
        user: `eval-${input.jobId ?? 'na'}-${input.sampleId}-${randomUUID().slice(0, 8)}`,
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        timeout: 300_000,
        responseType: 'stream',
      },
    );

    const toolCalls: AgentToolCall[] = [];
    let finalOutputs: Record<string, any> | string | null | undefined = undefined;
    let workflowError: string | null = null;
    let workflowStatus: string | null = null;
    let elapsedMs: number | null = null;
    let textBuffer = '';
    let buffer = '';
    let streamError: string | null = null;

    const consumeFrame = (frame: string) => {
      for (const line of frame.split('\n')) {
        const ev = parseSSEData(line);
        if (!ev) continue;
        switch (ev.event) {
          case 'node_finished': {
            const tc = nodeFinishedToToolCall((ev as NodeFinishedEvent).data);
            if (tc) toolCalls.push(tc);
            break;
          }
          case 'text_chunk': {
            const t = (ev as TextChunkEvent).data?.text;
            if (typeof t === 'string') textBuffer += t;
            break;
          }
          case 'workflow_finished': {
            const d = (ev as WorkflowFinishedEvent).data;
            finalOutputs = d?.outputs;
            workflowError = d?.error ?? null;
            workflowStatus = d?.status ?? null;
            elapsedMs = d?.elapsed_time != null ? Math.round(d.elapsed_time * 1000) : null;
            break;
          }
          case 'error': {
            const e = ev as ErrorEvent;
            streamError = `Dify workflow stream error: ${e.code || e.status || 'unknown'} ${e.message || ''}`;
            break;
          }
          default:
            // ignore workflow_started, node_started, ping, tts_message, etc.
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
    if (workflowError) {
      throw new Error(`Dify workflow ${workflowStatus || 'failed'}: ${workflowError}`);
    }

    let output = extractWorkflowOutput(finalOutputs, cfg.outputField);
    if (!output && textBuffer) {
      // Streaming text node — text_chunk events carried the full answer.
      output = textBuffer;
    }
    if (!output && toolCalls.length > 0) {
      // Workflow ended with no surfaced output but tool nodes ran — fall back to
      // last tool result so the scorer has text to grade.
      const lastResult = toolCalls[toolCalls.length - 1].result;
      if (typeof lastResult === 'string' && lastResult.trim()) {
        output = lastResult;
        logger.warn(
          `Dify workflow sample ${input.sampleId} produced no outputs; falling back to last node result (${output.length} chars)`,
        );
      }
    }

    return {
      output,
      latencyMs,
      raw: {
        finalOutputs,
        workflowStatus,
        workflowElapsedMs: elapsedMs,
        toolCallCount: toolCalls.length,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  },
};

export default difyWorkflowRunner;
