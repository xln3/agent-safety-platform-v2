/**
 * v1 wrapper API — flat single-call interface requested by 甲方.
 *
 * 接收甲方扁平 schema (taskName, agent, benchmarks, sampling, judgeModelId | judgeModel)，
 * 内部展开为 Agent + EvalJob + EvalTask 三张表 + runJob fire-and-forget。
 *
 * 支持的 agent 形态（4 种，与网页版一致）：
 *   - openai_compat   {url, key, modelId}
 *   - dify_chat       {url, key}
 *   - dify_workflow   {url, key, inputVariableMapping}
 *   - cli             {commandTemplate, inputMode, timeoutSec?}
 *
 * 三种调用模式：
 *   - POST /api/v1/evaluate                  默认异步，立即返回 taskId
 *   - POST /api/v1/evaluate?wait=true        同步：阻塞到 job 终态或 timeoutSec
 *   - GET  /api/v1/evaluate/:taskId          查询当前状态 + 已落盘样本
 *
 * 裁判模型两条路（二选一）：
 *   - judgeModelId: <number>          引用已存在的 JudgeModel 行
 *   - judgeModel:   { apiBase, apiKey, modelId, name? }
 *                   内联：内部 sha256 去重 upsert 到 judge_models 表
 *
 * 输入/输出语义保证：
 *   GET /api/v1/evaluate/:taskId 返回的 tasks[].samples[].input 是 inspect_ai
 *   注入到 Agent 的原始 prompt，output 是 Agent 的完整文本响应。判官交互
 *   (judge model 调用、scoring explanation) 不会出现在 input/output 字段，
 *   仅判官给出的最终数值分会反映到 task 级 safetyScore 上。
 *
 * 安全：所有响应中的 apiKey/key 字段固定屏蔽为 "***"（请求中传入的真实
 *   值仅入库 + 调用上游使用，不回显给调用方——他自己手里就有原值）。
 *
 * 实现要点：
 *   - 每次提交都创建新 Agent（name 加时间戳后缀避免唯一约束碰撞）。
 *   - 原始甲方字段存入 EvalJob.config.v1，GET 时按原样回显。
 *   - sampling.mode='random' 时 perTaskLimit = ceil(count / benchmarks.length)。
 *   - 非 openai_compat 走 ts_bridge_solver 路径（modelId = `openai/bridge-<type>-<id>`）。
 *   - 同步模式：2s 间隔轮询 EvalJob.status；客户端断开立刻 return（job 继续跑）。
 */

import * as crypto from 'crypto';
import { Request, Response } from 'express';
import { Agent, EvalJob, EvalTask, JudgeModel } from '../models';
import { runJob } from '../services/evalRunner';
import { catalogService } from '../services/catalogService';
import { readEvalSamples } from '../services/resultReader';
import { sseService } from '../services/sseService';
import { successResponse, errorResponse } from '../utils/response';
import logger from '../utils/logger';

const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

const DEFAULT_SAMPLES_PER_TASK = 50;
const MAX_SAMPLES_PER_TASK = 500;

/** Default sync-mode timeout (seconds) when caller omits timeoutSec. */
const SYNC_DEFAULT_TIMEOUT_SEC = 1800;
/** Hard upper bound for sync-mode timeout (seconds). */
const SYNC_MAX_TIMEOUT_SEC = 3600;
/** Poll interval (ms) used by sync-mode wait loop. */
const SYNC_POLL_INTERVAL_MS = 2000;

/** Job statuses considered terminal by the sync wait loop. */
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed']);

const SUPPORTED_AGENT_TYPES = ['openai_compat', 'dify_chat', 'dify_workflow', 'cli'] as const;
type V1AgentType = (typeof SUPPORTED_AGENT_TYPES)[number];

interface V1AgentPayload {
  name: string;
  agentType: V1AgentType;
  // openai_compat / dify_chat / dify_workflow
  url?: string;
  key?: string;
  // openai_compat
  modelId?: string;
  // dify_workflow
  inputVariableMapping?: Record<string, string>;
  // cli
  commandTemplate?: string;
  inputMode?: 'placeholder' | 'stdin';
  timeoutSec?: number;
}

interface V1SamplingPayload {
  mode: 'all' | 'random';
  count?: number;
}

interface V1JudgeModelInline {
  apiBase: string;
  apiKey: string;
  modelId: string;
  name?: string;
}

interface V1SubmitPayload {
  taskName?: string;
  agent: V1AgentPayload;
  benchmarks: string[];
  sampling: V1SamplingPayload;
  judgeModelId?: number;
  judgeModel?: V1JudgeModelInline;
  concurrency?: number;
  systemPrompt?: string;
}

/**
 * Validate the submit payload, dispatching per-type required-field checks.
 * Returns { error } on first failure, { payload } on success.
 */
function validateSubmit(body: any): { error: string | null; payload: V1SubmitPayload | null } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object', payload: null };
  }

  const agent = body.agent;
  if (!agent || typeof agent !== 'object') {
    return { error: 'Missing required field: agent', payload: null };
  }
  if (typeof agent.name !== 'string' || !agent.name.trim()) {
    return { error: 'Missing required field: agent.name', payload: null };
  }

  const agentType = (agent.agentType ?? 'openai_compat') as string;
  if (!(SUPPORTED_AGENT_TYPES as readonly string[]).includes(agentType)) {
    return {
      error: `agent.agentType must be one of: ${SUPPORTED_AGENT_TYPES.join(', ')}`,
      payload: null,
    };
  }

  const requireString = (key: string, holder: any = agent): string | null => {
    const v = holder[key];
    if (typeof v !== 'string' || !v.trim()) return `Missing required field: agent.${key}`;
    return null;
  };

  // Per-type required fields
  let typeErr: string | null = null;
  switch (agentType as V1AgentType) {
    case 'openai_compat':
      typeErr =
        requireString('url') || requireString('key') || requireString('modelId');
      break;
    case 'dify_chat':
      typeErr = requireString('url') || requireString('key');
      break;
    case 'dify_workflow':
      typeErr = requireString('url') || requireString('key');
      if (!typeErr) {
        const m = agent.inputVariableMapping;
        if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length === 0) {
          typeErr =
            'agent.inputVariableMapping must be a non-empty object (Dify variable name → eval-state field path)';
        } else {
          for (const [k, v] of Object.entries(m)) {
            if (typeof v !== 'string' || !v.trim()) {
              typeErr = `agent.inputVariableMapping["${k}"] must be a non-empty string`;
              break;
            }
          }
        }
      }
      break;
    case 'cli':
      typeErr = requireString('commandTemplate');
      if (!typeErr) {
        if (agent.inputMode !== 'placeholder' && agent.inputMode !== 'stdin') {
          typeErr = 'agent.inputMode must be "placeholder" or "stdin"';
        } else if (
          agent.inputMode === 'placeholder' &&
          !String(agent.commandTemplate).includes('{INPUT}')
        ) {
          typeErr = 'agent.commandTemplate must contain {INPUT} when inputMode=placeholder';
        } else if (agent.timeoutSec !== undefined) {
          const t = Number(agent.timeoutSec);
          if (!Number.isFinite(t) || t <= 0 || t > 3600) {
            typeErr = 'agent.timeoutSec must be a positive number ≤ 3600';
          }
        }
      }
      break;
  }
  if (typeErr) return { error: typeErr, payload: null };

  // benchmarks
  const benchmarks = body.benchmarks;
  if (!Array.isArray(benchmarks) || benchmarks.length === 0) {
    return { error: 'Missing required field: benchmarks (non-empty string array)', payload: null };
  }
  for (const b of benchmarks) {
    if (typeof b !== 'string' || !b.trim()) {
      return { error: 'benchmarks must contain only non-empty strings', payload: null };
    }
  }

  // sampling
  const sampling = body.sampling ?? { mode: 'all' };
  if (typeof sampling !== 'object' || Array.isArray(sampling)) {
    return { error: 'sampling must be an object', payload: null };
  }
  const samplingMode = sampling.mode ?? 'all';
  if (samplingMode !== 'all' && samplingMode !== 'random') {
    return { error: 'sampling.mode must be "all" or "random"', payload: null };
  }
  if (samplingMode === 'random') {
    const c = Number(sampling.count);
    if (!Number.isInteger(c) || c <= 0 || c > 10000) {
      return {
        error: 'sampling.count must be a positive integer ≤ 10000 when sampling.mode="random"',
        payload: null,
      };
    }
  }

  if (body.judgeModelId !== undefined && body.judgeModelId !== null) {
    const j = Number(body.judgeModelId);
    if (!Number.isInteger(j) || j <= 0) {
      return { error: 'judgeModelId must be a positive integer', payload: null };
    }
  }
  if (body.judgeModel !== undefined && body.judgeModel !== null) {
    if (body.judgeModelId !== undefined && body.judgeModelId !== null) {
      return { error: 'judgeModelId 与 judgeModel 二选一，不能同时传', payload: null };
    }
    const j = body.judgeModel;
    if (typeof j !== 'object' || Array.isArray(j)) {
      return { error: 'judgeModel must be an object', payload: null };
    }
    if (typeof j.apiBase !== 'string' || !j.apiBase.trim()) {
      return { error: 'Missing required field: judgeModel.apiBase', payload: null };
    }
    if (typeof j.apiKey !== 'string' || !j.apiKey.trim()) {
      return { error: 'Missing required field: judgeModel.apiKey', payload: null };
    }
    if (typeof j.modelId !== 'string' || !j.modelId.trim()) {
      return { error: 'Missing required field: judgeModel.modelId', payload: null };
    }
    if (j.name !== undefined && typeof j.name !== 'string') {
      return { error: 'judgeModel.name must be a string when provided', payload: null };
    }
  }
  if (body.concurrency !== undefined && body.concurrency !== null) {
    const c = Number(body.concurrency);
    if (!Number.isInteger(c) || c < 1 || c > 10) {
      return { error: 'concurrency must be an integer in [1, 10]', payload: null };
    }
  }

  // Build the cleaned, type-safe payload
  const cleanAgent: V1AgentPayload = {
    name: agent.name.trim(),
    agentType: agentType as V1AgentType,
  };
  if (agentType !== 'cli') {
    cleanAgent.url = String(agent.url).trim();
    cleanAgent.key = String(agent.key).trim();
  }
  if (agentType === 'openai_compat') {
    cleanAgent.modelId = String(agent.modelId).trim();
  }
  if (agentType === 'dify_workflow') {
    cleanAgent.inputVariableMapping = { ...agent.inputVariableMapping };
  }
  if (agentType === 'cli') {
    cleanAgent.commandTemplate = String(agent.commandTemplate).trim();
    cleanAgent.inputMode = agent.inputMode;
    if (agent.timeoutSec !== undefined) cleanAgent.timeoutSec = Number(agent.timeoutSec);
  }

  return {
    error: null,
    payload: {
      taskName: body.taskName,
      agent: cleanAgent,
      benchmarks: benchmarks.map((b: string) => b.trim()),
      sampling: { mode: samplingMode, count: sampling?.count },
      judgeModelId: body.judgeModelId != null ? Number(body.judgeModelId) : undefined,
      judgeModel: body.judgeModel
        ? {
            apiBase: String(body.judgeModel.apiBase).trim(),
            apiKey: String(body.judgeModel.apiKey).trim(),
            modelId: String(body.judgeModel.modelId).trim(),
            ...(body.judgeModel.name !== undefined
              ? { name: String(body.judgeModel.name).trim() }
              : {}),
          }
        : undefined,
      concurrency: body.concurrency != null ? Number(body.concurrency) : undefined,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
    },
  };
}

/**
 * Build the Agent.config JSON + legacy (apiBase/apiKey/modelId) mirrors per type.
 * Mirrors agentController logic so evalRunner sees consistent state.
 */
function buildAgentConfigAndLegacy(
  payload: V1AgentPayload,
  systemPrompt: string | null,
): { config: any; legacy: { apiBase: string | null; apiKey: string | null; modelId: string | null; systemPrompt: string | null } } {
  switch (payload.agentType) {
    case 'openai_compat':
      return {
        config: {
          apiBase: payload.url!,
          apiKey: payload.key!,
          modelId: payload.modelId!,
          systemPrompt,
        },
        legacy: {
          apiBase: payload.url!,
          apiKey: payload.key!,
          modelId: payload.modelId!,
          systemPrompt,
        },
      };
    case 'dify_chat':
      return {
        config: { apiBase: payload.url!, apiKey: payload.key!, systemPrompt },
        legacy: { apiBase: payload.url!, apiKey: payload.key!, modelId: null, systemPrompt },
      };
    case 'dify_workflow':
      return {
        config: {
          apiBase: payload.url!,
          apiKey: payload.key!,
          inputVariableMapping: payload.inputVariableMapping!,
        },
        legacy: { apiBase: payload.url!, apiKey: payload.key!, modelId: null, systemPrompt: null },
      };
    case 'cli':
      return {
        config: {
          commandTemplate: payload.commandTemplate!,
          inputMode: payload.inputMode!,
          ...(payload.timeoutSec !== undefined ? { timeoutSec: payload.timeoutSec } : {}),
        },
        legacy: { apiBase: null, apiKey: null, modelId: null, systemPrompt: null },
      };
  }
}

/**
 * Echo back ONLY the fields the user originally provided, preserving agentType
 * discriminant. Secret fields (`key`) are masked to `***` — caller already
 * holds the real value, returning it serves zero business purpose and only
 * widens the leak surface.
 */
function echoAgent(p: V1AgentPayload): Record<string, unknown> {
  const out: Record<string, unknown> = { name: p.name, agentType: p.agentType };
  if (p.url !== undefined) out.url = p.url;
  if (p.key !== undefined) out.key = '***';
  if (p.modelId !== undefined) out.modelId = p.modelId;
  if (p.inputVariableMapping !== undefined) out.inputVariableMapping = p.inputVariableMapping;
  if (p.commandTemplate !== undefined) out.commandTemplate = p.commandTemplate;
  if (p.inputMode !== undefined) out.inputMode = p.inputMode;
  if (p.timeoutSec !== undefined) out.timeoutSec = p.timeoutSec;
  return out;
}

/** Echo inline judgeModel with apiKey masked. */
function echoJudgeModelInline(j: V1JudgeModelInline): Record<string, unknown> {
  const out: Record<string, unknown> = {
    apiBase: j.apiBase,
    modelId: j.modelId,
    apiKey: '***',
  };
  if (j.name !== undefined) out.name = j.name;
  return out;
}

/**
 * Build the V1 status payload (same shape returned by GET /api/v1/evaluate/:taskId)
 * for a given EvalJob id. Reused by GET handler AND sync-mode wait loop so
 * both paths share one schema.
 *
 * Returns `null` when the job does not exist.
 */
async function buildStatusPayload(
  taskId: number,
  samplesPerTask: number,
): Promise<Record<string, unknown> | null> {
  const job = await EvalJob.findByPk(taskId, {
    include: [
      { model: EvalTask, as: 'tasks' },
      { model: Agent, as: 'agent' },
    ],
  });
  if (!job) return null;

  const v1Echo = (job.config as any)?.v1 ?? {};
  const dbAgent = (job as any).agent;
  const echoAgentObj =
    v1Echo.agent ?? {
      name: dbAgent?.name ?? '',
      agentType: dbAgent?.agentType ?? 'openai_compat',
      url: dbAgent?.apiBase ?? null,
      key: dbAgent?.apiKey ? '***' : null,
      modelId: dbAgent?.modelId ?? null,
    };
  const echoTaskName = v1Echo.taskName ?? job.name;
  const echoSampling = v1Echo.sampling ?? { mode: job.samplingMode, count: null };
  const echoJudgeInline = v1Echo.judgeModelInline ?? null;

  const tasks = ((job as any).tasks ?? []) as EvalTask[];
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.benchmark === b.benchmark) return a.taskName.localeCompare(b.taskName);
    return a.benchmark.localeCompare(b.benchmark);
  });

  const taskOutputs: any[] = [];
  let aggregateCompletedSamples = 0;
  for (const task of sortedTasks) {
    let samples: any[] = [];
    let total = 0;
    let truncated = false;
    if (task.evalFile) {
      try {
        const result = await readEvalSamples(task.evalFile, 0, samplesPerTask);
        samples = result.samples.map((s) => ({
          id: s.id,
          input: s.input,
          output: s.output,
          ...(s.error ? { error: s.error } : {}),
        }));
        total = result.total;
        truncated = total > samples.length;
      } catch (err: any) {
        logger.warn(`[v1] read samples failed task=${task.id}: ${err.message}`);
      }
    }
    aggregateCompletedSamples += task.completedSamples;
    taskOutputs.push({
      benchmark: task.benchmark,
      taskName: task.taskName,
      status: task.status,
      samplesTotal: task.samplesTotal,
      completedSamples: task.completedSamples,
      failedSamples: task.failedSamples,
      samplesShown: samples.length,
      samplesTruncated: truncated,
      errorMessage: task.errorMessage,
      samples,
    });
  }

  // When the user requested random sampling and the actual completed sample
  // count fell short of what the job planned (job.totalSamples), tell them
  // why — almost always one benchmark's local dataset is smaller than its
  // share of `count`. Without this hint, "I asked for 20 but got 18" looks
  // like a bug.
  const isTerminal = job.status === 'completed' || job.status === 'failed';
  const requestedCount =
    echoSampling && typeof echoSampling === 'object' && (echoSampling as any).count != null
      ? Number((echoSampling as any).count)
      : null;
  const samplingNotes =
    isTerminal &&
    requestedCount &&
    requestedCount > 0 &&
    aggregateCompletedSamples > 0 &&
    aggregateCompletedSamples < requestedCount
      ? `请求 ${requestedCount} 条样本，实际完成 ${aggregateCompletedSamples} 条；通常是某个 benchmark 本地数据集小于分配额度`
      : null;

  return {
    taskId: job.id,
    taskName: echoTaskName,
    agent: echoAgentObj,
    ...(job.judgeModelId != null ? { judgeModelId: job.judgeModelId } : {}),
    ...(echoJudgeInline
      ? { judgeModel: { ...echoJudgeInline, apiKey: '***' } }
      : {}),
    startedAt: (job.startedAt ?? job.createdAt)?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    status: job.status,
    benchmarks: job.benchmarks,
    sampling: echoSampling,
    totalTasks: job.totalTasks,
    completedTasks: job.completedTasks,
    totalSamples: job.totalSamples,
    completedSamples: aggregateCompletedSamples,
    ...(samplingNotes ? { samplingNotes } : {}),
    tasks: taskOutputs,
  };
}

/**
 * Resolve the optional `wait` flag (and `timeoutSec`) from a submit
 * payload + query string. Returns null when wait mode is off.
 *
 * `wait=true` may be passed via:
 *   - query string  ?wait=true
 *   - body field    {"wait": true}
 *
 * `timeoutSec` may be passed via body only (numeric, 1..SYNC_MAX_TIMEOUT_SEC).
 * Default is SYNC_DEFAULT_TIMEOUT_SEC. Out-of-range values clamp to bounds.
 */
function resolveWaitOptions(req: Request): { timeoutMs: number } | null {
  const queryFlag = String(req.query.wait ?? '').toLowerCase();
  const bodyFlag = (req.body && typeof req.body === 'object') ? req.body.wait : undefined;

  const wait =
    queryFlag === 'true' || queryFlag === '1' ||
    bodyFlag === true || bodyFlag === 'true' || bodyFlag === 1 || bodyFlag === '1';
  if (!wait) return null;

  let timeoutSec = SYNC_DEFAULT_TIMEOUT_SEC;
  const raw = (req.body && typeof req.body === 'object') ? Number(req.body.timeoutSec) : NaN;
  if (Number.isFinite(raw) && raw > 0) {
    timeoutSec = Math.min(Math.floor(raw), SYNC_MAX_TIMEOUT_SEC);
  }
  return { timeoutMs: timeoutSec * 1000 };
}

/**
 * Block until the EvalJob reaches a terminal status or the timeout elapses.
 *
 * Resolves with one of:
 *   - 'completed' / 'failed'  — DB status when terminal
 *   - 'timeout'               — elapsed without terminal status
 *   - 'disconnect'            — caller closed the HTTP connection
 *
 * Polls every SYNC_POLL_INTERVAL_MS via setTimeout (not setInterval) to
 * avoid overlapping queries when the DB read is slow.
 */
async function waitForJobTerminal(
  jobId: number,
  timeoutMs: number,
  res: Response,
): Promise<'completed' | 'failed' | 'timeout' | 'disconnect'> {
  return new Promise((resolve) => {
    let resolved = false;
    const deadline = Date.now() + timeoutMs;
    let timer: NodeJS.Timeout | null = null;

    const finalize = (result: 'completed' | 'failed' | 'timeout' | 'disconnect') => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      res.removeListener('close', onClose);
      resolve(result);
    };

    const onClose = () => {
      // Express closes the response when the client disconnects. We stop
      // polling — the underlying job runs to completion regardless.
      if (!res.writableEnded) finalize('disconnect');
    };
    res.on('close', onClose);

    const tick = async () => {
      if (resolved) return;
      try {
        const job = await EvalJob.findByPk(jobId, { attributes: ['status'] });
        const status = job?.status;
        if (status === 'completed') return finalize('completed');
        if (status === 'failed') return finalize('failed');
      } catch (err: any) {
        logger.warn(`[v1] sync poll DB error for job ${jobId}: ${err.message}`);
      }
      if (Date.now() >= deadline) return finalize('timeout');
      timer = setTimeout(tick, SYNC_POLL_INTERVAL_MS);
    };

    // Kick off immediately rather than waiting one full poll interval.
    tick();
  });
}

export const v1Controller = {
  /** POST /api/v1/evaluate */
  async submit(req: Request, res: Response): Promise<void> {
    try {
      const { error, payload } = validateSubmit(req.body);
      if (error || !payload) {
        res.status(400).json(errorResponse(error || 'Invalid payload'));
        return;
      }

      // Catalog validation
      const knownBenchmarks = new Set(catalogService.getAllBenchmarks().map((b) => b.name));
      const unknown = payload.benchmarks.filter((name) => !knownBenchmarks.has(name));
      if (unknown.length > 0) {
        res.status(400).json(errorResponse(`Unknown benchmark(s): ${unknown.join(', ')}`));
        return;
      }

      // Resolve judge model — either an existing PK or an inline config we
      // upsert into the JudgeModel table (deterministic dedup name based on
      // sha256 of (apiBase, apiKey, modelId), so identical configs reuse the
      // same row instead of growing unbounded).
      let resolvedJudgeId: number | null = null;
      let resolvedJudgeName: string | null = null;
      if (payload.judgeModelId != null) {
        const judgeRec = await JudgeModel.findByPk(payload.judgeModelId);
        if (!judgeRec) {
          res.status(404).json(errorResponse(`JudgeModel not found: ${payload.judgeModelId}`));
          return;
        }
        resolvedJudgeId = judgeRec.id;
        resolvedJudgeName = judgeRec.modelId;
      } else if (payload.judgeModel) {
        const inline = payload.judgeModel;
        const safeModel = inline.modelId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 40);
        const hash = crypto
          .createHash('sha256')
          .update(`${inline.apiBase}|${inline.apiKey}|${inline.modelId}`)
          .digest('hex')
          .slice(0, 12);
        const dedupName = `v1-inline-${safeModel}-${hash}`.slice(0, 128);
        const [judgeRec] = await JudgeModel.findOrCreate({
          where: { name: dedupName },
          defaults: {
            name: dedupName,
            apiBase: inline.apiBase,
            apiKey: inline.apiKey,
            modelId: inline.modelId,
            description: inline.name ? `[v1 inline] ${inline.name}` : '[v1 inline]',
          },
        });
        resolvedJudgeId = judgeRec.id;
        resolvedJudgeName = judgeRec.modelId;
      }
      if (!resolvedJudgeName) {
        const allBenchmarks = catalogService.getAllBenchmarks();
        const benchmarksNeedingJudge = payload.benchmarks.filter((name) => {
          const info = allBenchmarks.find((b) => b.name === name);
          return info?.judgeModel && info.judgeModel.length > 0;
        });
        if (benchmarksNeedingJudge.length > 0) {
          res.status(400).json(
            errorResponse(
              `以下 benchmark 需要裁判模型但未提供 judgeModelId/judgeModel: ${benchmarksNeedingJudge.join(', ')}`,
            ),
          );
          return;
        }
      }

      // Resolve task list FIRST (some benchmarks expand to multi-task).
      // Allocation must be per-task, not per-benchmark, otherwise count=20
      // across 3 benchmarks where one expands to 2 tasks would over-allocate.
      const allBenchmarks = catalogService.getAllBenchmarks();
      const benchmarkMap = new Map(allBenchmarks.map((b) => [b.name, b]));
      const tasksToCreate: { benchmark: string; taskName: string }[] = [];
      for (const bmName of payload.benchmarks) {
        const bmInfo = benchmarkMap.get(bmName);
        if (!bmInfo) continue;
        if (bmInfo.tasks.length > 0) {
          for (const task of bmInfo.tasks) {
            tasksToCreate.push({ benchmark: bmName, taskName: task.name });
          }
        } else {
          tasksToCreate.push({ benchmark: bmName, taskName: bmName });
        }
      }
      if (tasksToCreate.length === 0) {
        res.status(400).json(errorResponse('No valid tasks resolved from benchmarks'));
        return;
      }

      // Sampling → per-task allocation using base+remainder (not ceil), so
      // Σ samplesTotal == count exactly. Earlier `Math.ceil(count / N) * N`
      // could over-allocate (count=20, N=3 → 21) and made GET responses confusing.
      // Tasks are sorted: first `remainder` get base+1, rest get base.
      const totalCount = payload.sampling.mode === 'random' ? Number(payload.sampling.count) : 0;
      const numTasks = tasksToCreate.length;
      const perTaskAllocations =
        payload.sampling.mode === 'random'
          ? (() => {
              const base = Math.floor(totalCount / numTasks);
              const remainder = totalCount % numTasks;
              return Array.from({ length: numTasks }, (_, i) =>
                Math.max(1, i < remainder ? base + 1 : base),
              );
            })()
          : Array.from({ length: numTasks }, () => 0); // mode='all' → no per-task cap

      // Create Agent
      const agentTimestamp = Date.now();
      const internalAgentName = `${payload.agent.name}-${agentTimestamp}`;
      const { config: agentConfig, legacy } = buildAgentConfigAndLegacy(
        payload.agent,
        payload.systemPrompt ?? null,
      );
      const agentRecord = await Agent.create({
        name: internalAgentName,
        agentType: payload.agent.agentType,
        description: `[v1] auto-created from /api/v1/evaluate (${payload.agent.agentType})`,
        config: agentConfig,
        ...legacy,
      });

      // Synthesize modelId for inspect_ai --model
      let modelId: string;
      if (payload.agent.agentType === 'openai_compat') {
        modelId = payload.agent.modelId!;
        if (!modelId.includes('/')) modelId = `openai/${modelId}`;
      } else {
        modelId = `openai/bridge-${payload.agent.agentType}-${agentRecord.id}`;
      }

      // jobTotalSamples = Σ perTaskAllocations. For random mode this equals
      // totalCount exactly (base+remainder distribution). For 'all' mode it's
      // 0 (sentinel meaning "run whole dataset"; actual completion populates
      // the real numbers as samples land).
      const jobTotalSamples = perTaskAllocations.reduce((s, n) => s + n, 0);
      const jobName =
        (payload.taskName?.trim() || `v1-${payload.agent.name}`) + `-${agentTimestamp}`;

      const job = await EvalJob.create({
        agentId: agentRecord.id,
        judgeModelId: resolvedJudgeId,
        name: jobName,
        benchmarks: payload.benchmarks,
        modelId,
        // limit is now per-task (in EvalTask.samplesTotal); keep job.limit null
        // so legacy callers that read it know there's no uniform cap.
        limit: null,
        judgeModel: resolvedJudgeName,
        systemPrompt: payload.systemPrompt ?? null,
        config: {
          v1: {
            taskName: payload.taskName ?? null,
            agent: echoAgent(payload.agent),
            sampling: { mode: payload.sampling.mode, count: totalCount || null },
            ...(payload.judgeModel
              ? {
                  judgeModelInline: {
                    apiBase: payload.judgeModel.apiBase,
                    modelId: payload.judgeModel.modelId,
                    ...(payload.judgeModel.name !== undefined
                      ? { name: payload.judgeModel.name }
                      : {}),
                  },
                }
              : {}),
          },
        },
        concurrency: payload.concurrency ?? 5,
        samplingMode: payload.sampling.mode,
        totalTasks: tasksToCreate.length,
        completedTasks: 0,
        totalSamples: jobTotalSamples,
        totalItems: jobTotalSamples,
      });

      for (let i = 0; i < tasksToCreate.length; i++) {
        const taskDef = tasksToCreate[i];
        const taskLimit = perTaskAllocations[i];
        await EvalTask.create({
          jobId: job.id,
          agentId: agentRecord.id,
          benchmark: taskDef.benchmark,
          taskName: taskDef.taskName,
          samplesTotal: taskLimit,
          totalSamples: taskLimit,
        });
      }

      logger.info(
        `[v1] submit jobId=${job.id} agentType=${payload.agent.agentType} agent=${payload.agent.name} benchmarks=${payload.benchmarks.length} sampling=${payload.sampling.mode}`,
      );

      runJob(job.id).catch((err) => {
        logger.error(`[v1] runJob ${job.id} failed: ${err.message}`);
      });

      // ---- Sync (wait=true) path ----
      // Block on the existing background runJob until terminal/timeout, then
      // return the same payload shape as GET /api/v1/evaluate/:taskId.
      const waitOpts = resolveWaitOptions(req);
      if (waitOpts) {
        logger.info(`[v1] sync wait jobId=${job.id} timeoutMs=${waitOpts.timeoutMs}`);
        const result = await waitForJobTerminal(job.id, waitOpts.timeoutMs, res);
        if (result === 'disconnect') {
          // Client closed the socket — job keeps running. Nothing to send.
          return;
        }
        const payloadOut = await buildStatusPayload(job.id, DEFAULT_SAMPLES_PER_TASK);
        if (!payloadOut) {
          res.status(500).json(errorResponse('Job vanished mid-wait'));
          return;
        }
        // Override status to 'timeout' when we hit the cap before terminal.
        if (result === 'timeout') {
          (payloadOut as any).status = 'timeout';
        }
        res.status(200).json(
          successResponse(
            payloadOut,
            result === 'timeout' ? 'Evaluation timed out (partial result)' : 'Evaluation finished',
          ),
        );
        return;
      }

      // ---- Async (default) path ----
      res.status(201).json(
        successResponse(
          {
            taskId: job.id,
            taskName: payload.taskName ?? jobName,
            agent: echoAgent(payload.agent),
            ...(resolvedJudgeId != null ? { judgeModelId: resolvedJudgeId } : {}),
            ...(payload.judgeModel
              ? { judgeModel: echoJudgeModelInline(payload.judgeModel) }
              : {}),
            startedAt: job.createdAt?.toISOString() ?? new Date().toISOString(),
            status: job.status,
            benchmarks: payload.benchmarks,
            sampling: { mode: payload.sampling.mode, count: totalCount || null },
            totalTasks: tasksToCreate.length,
            totalSamples: jobTotalSamples,
          },
          'Evaluation submitted',
        ),
      );
    } catch (err: any) {
      logger.error(`[v1] submit failed: ${err.message}`);
      res.status(500).json(errorResponse(err.message));
    }
  },

  /** GET /api/v1/evaluate/:taskId */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const taskId = parseInt(req.params.taskId as string, 10);
      if (Number.isNaN(taskId)) {
        res.status(400).json(errorResponse('Invalid taskId'));
        return;
      }

      const samplesPerTask = Math.max(
        1,
        Math.min(
          MAX_SAMPLES_PER_TASK,
          parseInt(req.query.samplesPerTask as string, 10) || DEFAULT_SAMPLES_PER_TASK,
        ),
      );

      const payload = await buildStatusPayload(taskId, samplesPerTask);
      if (!payload) {
        res.status(404).json(errorResponse('Evaluation task not found'));
        return;
      }
      res.json(successResponse(payload));
    } catch (err: any) {
      logger.error(`[v1] getStatus failed: ${err.message}`);
      res.status(500).json(errorResponse(err.message));
    }
  },

  /**
   * GET /api/v1/evaluate/:taskId/stream — Server-Sent Events feed.
   *
   * Emits one initial `status` event with the same payload shape as GET
   * (so a client can render immediately) then pipes through every
   * sseService event for this job: sample.start, sample.finish (per-item
   * progress with output preview), task.start, task.finish, job.finish,
   * heartbeat (every 15s to keep proxies from dropping the connection).
   *
   * Closes the underlying response when the client disconnects.
   */
  async getStream(req: Request, res: Response): Promise<void> {
    const taskId = parseInt(req.params.taskId as string, 10);
    if (Number.isNaN(taskId)) {
      res.status(400).json(errorResponse('Invalid taskId'));
      return;
    }

    const job = await EvalJob.findByPk(taskId);
    if (!job) {
      res.status(404).json(errorResponse('Evaluation task not found'));
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      const initial = await buildStatusPayload(taskId, DEFAULT_SAMPLES_PER_TASK);
      if (initial) {
        res.write(`event: status\ndata: ${JSON.stringify(initial)}\n\n`);
      }
    } catch (err: any) {
      logger.warn(`[v1] stream initial snapshot failed task=${taskId}: ${err.message}`);
    }

    sseService.subscribe(taskId, res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
      } catch (err: any) {
        logger.warn(`[v1] stream heartbeat failed task=${taskId}: ${err.message}`);
      }
    }, SSE_HEARTBEAT_INTERVAL_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseService.unsubscribe(taskId, res);
      logger.debug(`[v1] stream client disconnected task=${taskId}`);
    });
  },
};

export default v1Controller;
