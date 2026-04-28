/**
 * v1 wrapper API — flat single-call interface requested by 甲方.
 *
 * 接收甲方扁平 schema (taskName, agent, benchmarks, sampling, judgeModelId)，
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
 * 输入/输出语义保证：
 *   GET /api/v1/evaluate/:taskId 返回的 tasks[].samples[].input 是 inspect_ai
 *   注入到 Agent 的原始 prompt，output 是 Agent 的完整文本响应。判官交互
 *   (judge model 调用、scoring explanation) 不会出现在 input/output 字段，
 *   仅判官给出的最终数值分会反映到 task 级 safetyScore 上。
 *
 * 实现要点：
 *   - 每次提交都创建新 Agent（name 加时间戳后缀避免唯一约束碰撞）。
 *   - 原始甲方字段存入 EvalJob.config.v1，GET 时按原样回显。
 *   - sampling.mode='random' 时 perTaskLimit = ceil(count / benchmarks.length)。
 *   - 非 openai_compat 走 ts_bridge_solver 路径（modelId = `openai/bridge-<type>-<id>`）。
 *   - 同步模式：2s 间隔轮询 EvalJob.status；客户端断开立刻 return（job 继续跑）。
 */

import { Request, Response } from 'express';
import { Agent, EvalJob, EvalTask, JudgeModel } from '../models';
import { runJob } from '../services/evalRunner';
import { catalogService } from '../services/catalogService';
import { readEvalSamples } from '../services/resultReader';
import { successResponse, errorResponse } from '../utils/response';
import logger from '../utils/logger';

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

interface V1SubmitPayload {
  taskName?: string;
  agent: V1AgentPayload;
  benchmarks: string[];
  sampling: V1SamplingPayload;
  judgeModelId?: number;
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

/** Echo back ONLY the fields the user originally provided, preserving agentType discriminant. */
function echoAgent(p: V1AgentPayload): Record<string, unknown> {
  const out: Record<string, unknown> = { name: p.name, agentType: p.agentType };
  if (p.url !== undefined) out.url = p.url;
  if (p.key !== undefined) out.key = p.key;
  if (p.modelId !== undefined) out.modelId = p.modelId;
  if (p.inputVariableMapping !== undefined) out.inputVariableMapping = p.inputVariableMapping;
  if (p.commandTemplate !== undefined) out.commandTemplate = p.commandTemplate;
  if (p.inputMode !== undefined) out.inputMode = p.inputMode;
  if (p.timeoutSec !== undefined) out.timeoutSec = p.timeoutSec;
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
      key: dbAgent?.apiKey ?? null,
      modelId: dbAgent?.modelId ?? null,
    };
  const echoTaskName = v1Echo.taskName ?? job.name;
  const echoSampling = v1Echo.sampling ?? { mode: job.samplingMode, count: null };

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
        samples = result.samples.map((s) => ({ id: s.id, input: s.input, output: s.output }));
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

  return {
    taskId: job.id,
    taskName: echoTaskName,
    agent: echoAgentObj,
    startedAt: (job.startedAt ?? job.createdAt)?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    status: job.status,
    benchmarks: job.benchmarks,
    sampling: echoSampling,
    totalTasks: job.totalTasks,
    completedTasks: job.completedTasks,
    totalSamples: job.totalSamples,
    completedSamples: aggregateCompletedSamples,
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

      // Strict judge gate
      let resolvedJudgeName: string | null = null;
      if (payload.judgeModelId != null) {
        const judgeRec = await JudgeModel.findByPk(payload.judgeModelId);
        if (!judgeRec) {
          res.status(404).json(errorResponse(`JudgeModel not found: ${payload.judgeModelId}`));
          return;
        }
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
              `以下 benchmark 需要裁判模型但未提供 judgeModelId: ${benchmarksNeedingJudge.join(', ')}`,
            ),
          );
          return;
        }
      }

      // Sampling -> per-task limit
      const totalCount = payload.sampling.mode === 'random' ? Number(payload.sampling.count) : 0;
      const perBenchLimit =
        payload.sampling.mode === 'random'
          ? Math.max(1, Math.ceil(totalCount / payload.benchmarks.length))
          : null;

      // Resolve task list (some benchmarks expand to multi-task)
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

      const perTaskTotal = perBenchLimit || 0;
      const jobTotalSamples = perTaskTotal * tasksToCreate.length;
      const jobName =
        (payload.taskName?.trim() || `v1-${payload.agent.name}`) + `-${agentTimestamp}`;

      const job = await EvalJob.create({
        agentId: agentRecord.id,
        judgeModelId: payload.judgeModelId ?? null,
        name: jobName,
        benchmarks: payload.benchmarks,
        modelId,
        limit: perBenchLimit,
        judgeModel: resolvedJudgeName,
        systemPrompt: payload.systemPrompt ?? null,
        config: {
          v1: {
            taskName: payload.taskName ?? null,
            agent: echoAgent(payload.agent),
            sampling: { mode: payload.sampling.mode, count: totalCount || null },
          },
        },
        concurrency: payload.concurrency ?? 5,
        samplingMode: payload.sampling.mode,
        totalTasks: tasksToCreate.length,
        completedTasks: 0,
        totalSamples: jobTotalSamples,
        totalItems: jobTotalSamples,
      });

      for (const taskDef of tasksToCreate) {
        await EvalTask.create({
          jobId: job.id,
          agentId: agentRecord.id,
          benchmark: taskDef.benchmark,
          taskName: taskDef.taskName,
          samplesTotal: perTaskTotal,
          totalSamples: perTaskTotal,
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
};

export default v1Controller;
