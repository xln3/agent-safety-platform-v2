/**
 * Dify API Client
 *
 * Provides typed wrappers for calling Dify Chat and Workflow APIs.
 * Uses blocking mode so each call returns the full response.
 */

import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DifyChatParams {
  apiBase: string;
  apiKey: string;
  query: string;
  user?: string;
  conversationId?: string;
}

export interface DifyChatResult {
  answer: string;
  conversationId: string;
  latencyMs: number;
  metadata?: Record<string, any>;
}

export interface DifyWorkflowParams {
  apiBase: string;
  apiKey: string;
  inputs: Record<string, string>;
  user?: string;
}

export interface DifyWorkflowResult {
  outputs: Record<string, any>;
  latencyMs: number;
  metadata?: Record<string, any>;
}

export interface DifyError {
  code: string;
  message: string;
  status: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_USER = 'eval-platform';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, '');
}

async function difyFetch(
  url: string,
  apiKey: string,
  body: Record<string, any>,
): Promise<{ data: any; latencyMs: number }> {
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      let errBody: any = {};
      try {
        errBody = await res.json();
      } catch {
        // ignore parse errors
      }
      const difyErr: DifyError = {
        code: errBody.code || `HTTP_${res.status}`,
        message: errBody.message || res.statusText,
        status: res.status,
      };
      throw difyErr;
    }

    const data = await res.json();
    return { data, latencyMs };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a chat message to a Dify Chat-type application.
 *
 * POST {apiBase}/chat-messages
 */
export async function sendChatMessage(params: DifyChatParams): Promise<DifyChatResult> {
  const base = normalizeBase(params.apiBase);
  const url = `${base}/chat-messages`;

  const body: Record<string, any> = {
    inputs: {},
    query: params.query,
    user: params.user || DEFAULT_USER,
    response_mode: 'blocking',
  };

  if (params.conversationId) {
    body.conversation_id = params.conversationId;
  }

  logger.debug(`Dify chat request → ${url} | query length=${params.query.length}`);

  const { data, latencyMs } = await difyFetch(url, params.apiKey, body);

  return {
    answer: data.answer || '',
    conversationId: data.conversation_id || '',
    latencyMs,
    metadata: {
      messageId: data.id,
      createdAt: data.created_at,
    },
  };
}

/**
 * Run a Dify Workflow-type application.
 *
 * POST {apiBase}/workflows/run
 */
export async function runWorkflow(params: DifyWorkflowParams): Promise<DifyWorkflowResult> {
  const base = normalizeBase(params.apiBase);
  const url = `${base}/workflows/run`;

  const body: Record<string, any> = {
    inputs: params.inputs,
    user: params.user || DEFAULT_USER,
    response_mode: 'blocking',
  };

  logger.debug(`Dify workflow request → ${url}`);

  const { data, latencyMs } = await difyFetch(url, params.apiKey, body);

  return {
    outputs: data.data?.outputs || data.outputs || {},
    latencyMs,
    metadata: {
      workflowRunId: data.workflow_run_id,
      taskId: data.task_id,
    },
  };
}

/**
 * Classify a Dify API error for retry logic.
 */
export function classifyDifyError(err: any): 'auth' | 'rate_limit' | 'server' | 'timeout' | 'unknown' {
  if (err?.name === 'AbortError') return 'timeout';
  const status = err?.status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'unknown';
}
