/**
 * v1 wrapper API — flat single-call interface requested by 甲方.
 *
 * 甲方 输入:
 *   任务id (server 生成), 任务名称, 被测智能体名称, 入口URL, 入口Key,
 *   任务类型 (benchmark 列表), 测试数据类型 (全部 / 随机抽样按已选任务平均拆分)
 *
 * 甲方 输出:
 *   任务id, 任务名称, 被测智能体名称, 入口URL, 入口Key,
 *   任务开始时间, 任务类型, 每条测试项的输入与输出
 *
 * 实现要点:
 *   - 每次提交即时创建一个 Agent（name 加时间戳后缀避免唯一约束碰撞），
 *     并在 EvalJob.config.v1 中保存甲方原始输入字段用于回显。
 *   - V1 仅支持 openai_compat 形态。其他形态走 /api/agents + /api/eval/jobs 两步流程。
 *   - 抽样 mode=random 时 perTaskLimit = ceil(count / benchmarks.length)；mode=all 不传 limit。
 *   - 复用 runJob (fire-and-forget) 与 readEvalSamples (.eval ZIP 解析)。
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

interface V1AgentPayload {
  name: string;
  url: string;
  key: string;
  modelId: string;
  agentType?: string;
}

interface V1SamplingPayload {
  mode?: 'all' | 'random';
  count?: number;
}

interface V1SubmitPayload {
  taskName?: string;
  agent: V1AgentPayload;
  benchmarks: string[];
  sampling?: V1SamplingPayload;
  judgeModelId?: number;
  concurrency?: number;
  systemPrompt?: string;
}

/**
 * Validate the submit payload. Returns a non-null error string for the
 * first failure found, or null when the payload is well-formed.
 */
function validateSubmit(body: any): { error: string | null; payload: V1SubmitPayload | null } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object', payload: null };
  }

  const agent = body.agent;
  if (!agent || typeof agent !== 'object') {
    return { error: 'Missing required field: agent', payload: null };
  }
  for (const key of ['name', 'url', 'key', 'modelId'] as const) {
    const v = agent[key];
    if (typeof v !== 'string' || !v.trim()) {
      return { error: `Missing required field: agent.${key}`, payload: null };
    }
  }
  if (agent.agentType !== undefined && agent.agentType !== 'openai_compat') {
    return { error: 'agent.agentType must be "openai_compat" (only type supported by v1)', payload: null };
  }

  const benchmarks = body.benchmarks;
  if (!Array.isArray(benchmarks) || benchmarks.length === 0) {
    return { error: 'Missing required field: benchmarks (non-empty string array)', payload: null };
  }
  for (const b of benchmarks) {
    if (typeof b !== 'string' || !b.trim()) {
      return { error: 'benchmarks must contain only non-empty strings', payload: null };
    }
  }

  const sampling = body.sampling ?? { mode: 'all' };
  if (sampling && typeof sampling === 'object') {
    if (sampling.mode !== undefined && sampling.mode !== 'all' && sampling.mode !== 'random') {
      return { error: 'sampling.mode must be "all" or "random"', payload: null };
    }
    if (sampling.mode === 'random') {
      const c = Number(sampling.count);
      if (!Number.isInteger(c) || c <= 0 || c > 10000) {
        return { error: 'sampling.count must be a positive integer ≤ 10000 when sampling.mode="random"', payload: null };
      }
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

  return {
    error: null,
    payload: {
      taskName: body.taskName,
      agent: {
        name: agent.name.trim(),
        url: agent.url.trim(),
        key: agent.key.trim(),
        modelId: agent.modelId.trim(),
        agentType: 'openai_compat',
      },
      benchmarks: benchmarks.map((b: string) => b.trim()),
      sampling: { mode: sampling?.mode || 'all', count: sampling?.count },
      judgeModelId: body.judgeModelId != null ? Number(body.judgeModelId) : undefined,
      concurrency: body.concurrency != null ? Number(body.concurrency) : undefined,
      systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
    },
  };
}

export const v1Controller = {
  /**
   * POST /api/v1/evaluate — submit an evaluation in 甲方 flat schema.
   */
  async submit(req: Request, res: Response): Promise<void> {
    try {
      const { error, payload } = validateSubmit(req.body);
      if (error || !payload) {
        res.status(400).json(errorResponse(error || 'Invalid payload'));
        return;
      }

      // Validate benchmarks against the catalog.
      const knownBenchmarks = new Set(catalogService.getAllBenchmarks().map((b) => b.name));
      const unknown = payload.benchmarks.filter((name) => !knownBenchmarks.has(name));
      if (unknown.length > 0) {
        res.status(400).json(errorResponse(`Unknown benchmark(s): ${unknown.join(', ')}`));
        return;
      }

      // Strict judge gate — same policy as POST /api/eval/jobs.
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

      // Resolve per-task limit from sampling mode.
      const samplingMode = payload.sampling?.mode || 'all';
      const totalCount = samplingMode === 'random' ? Number(payload.sampling?.count) : 0;
      const perBenchLimit =
        samplingMode === 'random' ? Math.max(1, Math.ceil(totalCount / payload.benchmarks.length)) : null;

      // Resolve task list from catalog (some benchmarks expand to multiple tasks).
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

      // Create the Agent record. Append timestamp to the user-supplied name to
      // bypass agents.name unique constraint — original name is echoed back via
      // job.config.v1.agent.name on GET.
      const agentTimestamp = Date.now();
      const internalAgentName = `${payload.agent.name}-${agentTimestamp}`;
      const agentRecord = await Agent.create({
        name: internalAgentName,
        agentType: 'openai_compat',
        description: `[v1] auto-created from /api/v1/evaluate`,
        config: {
          apiBase: payload.agent.url,
          apiKey: payload.agent.key,
          modelId: payload.agent.modelId,
          systemPrompt: payload.systemPrompt ?? null,
        },
        apiBase: payload.agent.url,
        apiKey: payload.agent.key,
        modelId: payload.agent.modelId,
        systemPrompt: payload.systemPrompt ?? null,
      });

      // Build modelId for inspect_ai's --model flag.
      let modelId = payload.agent.modelId;
      if (!modelId.includes('/')) {
        modelId = `openai/${modelId}`;
      }

      // Pre-compute totalSamples so the frontend / status response can show
      // "X / N" instead of "X / 0" while inspect_ai is still enumerating.
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
        // Echo-back source: original 甲方 fields (untouched by uniqueness suffix).
        config: {
          v1: {
            taskName: payload.taskName ?? null,
            agent: {
              name: payload.agent.name,
              url: payload.agent.url,
              key: payload.agent.key,
              modelId: payload.agent.modelId,
              agentType: 'openai_compat',
            },
            sampling: { mode: samplingMode, count: totalCount || null },
          },
        },
        concurrency: payload.concurrency ?? 5,
        samplingMode,
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
        `[v1] Eval submitted: jobId=${job.id} agent=${payload.agent.name} benchmarks=${payload.benchmarks.length} sampling=${samplingMode}`,
      );

      runJob(job.id).catch((err) => {
        logger.error(`[v1] Background runJob failed for job ${job.id}: ${err.message}`);
      });

      res.status(201).json(
        successResponse(
          {
            taskId: job.id,
            taskName: payload.taskName ?? jobName,
            agent: {
              name: payload.agent.name,
              url: payload.agent.url,
              key: payload.agent.key,
              modelId: payload.agent.modelId,
              agentType: 'openai_compat',
            },
            startedAt: job.createdAt?.toISOString() ?? new Date().toISOString(),
            status: job.status,
            benchmarks: payload.benchmarks,
            sampling: { mode: samplingMode, count: totalCount || null },
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

  /**
   * GET /api/v1/evaluate/:taskId — current status + per-sample input/output.
   *
   * Query params:
   *   samplesPerTask — how many samples to return per benchmark task
   *                    (default 50, max 500).
   */
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

      const job = await EvalJob.findByPk(taskId, {
        include: [
          { model: EvalTask, as: 'tasks' },
          { model: Agent, as: 'agent' },
        ],
      });
      if (!job) {
        res.status(404).json(errorResponse('Evaluation task not found'));
        return;
      }

      // Echo the original 甲方 input from job.config.v1 when present.
      const v1Echo = (job.config as any)?.v1 ?? {};
      const echoAgent = v1Echo.agent ?? {
        name: (job as any).agent?.name ?? '',
        url: (job as any).agent?.apiBase ?? '',
        key: (job as any).agent?.apiKey ?? '',
        modelId: (job as any).agent?.modelId ?? '',
        agentType: (job as any).agent?.agentType ?? 'openai_compat',
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
            samples = result.samples.map((s) => ({
              id: s.id,
              input: s.input,
              output: s.output,
            }));
            total = result.total;
            truncated = total > samples.length;
          } catch (err: any) {
            logger.warn(`[v1] failed to read samples for task ${task.id}: ${err.message}`);
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

      res.json(
        successResponse({
          taskId: job.id,
          taskName: echoTaskName,
          agent: echoAgent,
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
        }),
      );
    } catch (err: any) {
      logger.error(`[v1] getStatus failed: ${err.message}`);
      res.status(500).json(errorResponse(err.message));
    }
  },
};

export default v1Controller;
