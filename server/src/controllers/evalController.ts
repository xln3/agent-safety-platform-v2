import { Request, Response } from 'express';
import { Agent, EvalJob, EvalTask, JudgeModel } from '../models';
import { runJob, cancelJob } from '../services/evalRunner';
import { catalogService } from '../services/catalogService';
import { EVAL_STATUS, EVAL_CATEGORIES, CATEGORY_BENCHMARK_MAP } from '../constants';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import logger from '../utils/logger';

export const evalController = {
  /**
   * POST /api/eval/jobs — Create a new evaluation job.
   *
   * Body: {
   *   agentId, benchmarks: string[],
   *   judgeModelId?, judgeModel? (legacy string),
   *   limit?, systemPrompt?,
   *   concurrency? (1-10, default 5),
   *   samplingMode? ('all'|'random', default 'all'),
   * }
   */
  async createJob(req: Request, res: Response): Promise<void> {
    try {
      const {
        agentId,
        benchmarks,
        limit,
        judgeModel,
        judgeModelId,
        systemPrompt,
        concurrency,
        samplingMode,
        skipJudge,
      } = req.body;

      if (skipJudge !== undefined && typeof skipJudge !== 'boolean') {
        res.status(400).json(errorResponse('skipJudge must be a boolean'));
        return;
      }
      const skipJudgeFlag = skipJudge === true;

      if (!agentId) {
        res.status(400).json(errorResponse('Missing required field: agentId'));
        return;
      }

      if (!benchmarks || !Array.isArray(benchmarks) || benchmarks.length === 0) {
        res.status(400).json(errorResponse('Missing required field: benchmarks (non-empty array)'));
        return;
      }

      const agent = await Agent.findByPk(agentId);
      if (!agent) {
        res.status(404).json(errorResponse(`Agent not found: ${agentId}`));
        return;
      }

      // Validate benchmark names against the catalog
      const knownBenchmarks = new Set(catalogService.getAllBenchmarks().map((b) => b.name));
      const unknownBenchmarks = (benchmarks as string[]).filter((name: string) => !knownBenchmarks.has(name));
      if (unknownBenchmarks.length > 0) {
        res.status(400).json(errorResponse(`Unknown benchmark(s): ${unknownBenchmarks.join(', ')}`));
        return;
      }

      // Validate limit range
      if (limit !== undefined && limit !== null) {
        const limitNum = Number(limit);
        if (!Number.isFinite(limitNum) || limitNum <= 0 || limitNum > 10000) {
          res.status(400).json(errorResponse('limit must be a positive integer no greater than 10000'));
          return;
        }
      }

      // Validate judgeModelId if provided — must reference an existing JudgeModel
      let resolvedJudgeName: string | null = null;
      if (judgeModelId !== undefined && judgeModelId !== null) {
        const jid = Number(judgeModelId);
        if (!Number.isInteger(jid) || jid <= 0) {
          res.status(400).json(errorResponse('judgeModelId must be a positive integer'));
          return;
        }
        const judgeRec = await JudgeModel.findByPk(jid);
        if (!judgeRec) {
          res.status(404).json(errorResponse(`JudgeModel not found: ${jid}`));
          return;
        }
        resolvedJudgeName = judgeRec.modelId;
      }

      // Validate legacy judgeModel string fallback
      if (judgeModel !== undefined && judgeModel !== null) {
        if (typeof judgeModel !== 'string' || judgeModel.trim().length === 0) {
          res.status(400).json(errorResponse('judgeModel must be a non-empty string'));
          return;
        }
      }

      // Strict judge requirement gate. Any benchmark with a `judge_model` entry
      // in catalog.yaml needs JUDGE_MODEL_NAME / refusal_judge / scorer_model
      // injected at run time — without one its scorer either no-ops, falls back
      // to an unreachable default (e.g. openai/gpt-4o-2024-08-06), or returns
      // null, leaving 甲方 facing "稳健 100/100 ⭐⭐⭐⭐⭐" on jobs where most
      // subtasks silently failed (job 40, 2026-04-28 audit). Block the create
      // call so the user picks a JudgeModel before submitting.
      const judgeSupplied =
        (resolvedJudgeName && resolvedJudgeName.length > 0) ||
        (typeof judgeModel === 'string' && judgeModel.trim().length > 0);
      if (!judgeSupplied && !skipJudgeFlag) {
        const benchmarksNeedingJudge = (benchmarks as string[]).filter((name) => {
          const info = catalogService.getAllBenchmarks().find((b) => b.name === name);
          return info?.judgeModel && info.judgeModel.length > 0;
        });
        if (benchmarksNeedingJudge.length > 0) {
          res.status(400).json(
            errorResponse(
              `以下 benchmark 需要裁判模型但未选择 judgeModel/judgeModelId: ${benchmarksNeedingJudge.join(', ')}`,
            ),
          );
          return;
        }
      }

      // Validate concurrency
      let concurrencyValue = 5;
      if (concurrency !== undefined && concurrency !== null) {
        const c = Number(concurrency);
        if (!Number.isInteger(c) || c < 1 || c > 10) {
          res.status(400).json(errorResponse('concurrency must be an integer in [1, 10]'));
          return;
        }
        concurrencyValue = c;
      }

      // Validate samplingMode
      const samplingModeValue = samplingMode || 'all';
      if (!['all', 'random'].includes(samplingModeValue)) {
        res.status(400).json(errorResponse('samplingMode must be "all" or "random"'));
        return;
      }

      // Resolve tasks from catalog
      const allBenchmarks = catalogService.getAllBenchmarks();
      const benchmarkMap = new Map(allBenchmarks.map((b) => [b.name, b]));

      const tasksToCreate: { benchmark: string; taskName: string }[] = [];

      for (const bmName of benchmarks) {
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
        res.status(400).json(errorResponse('No valid benchmarks or tasks found'));
        return;
      }

      // modelId for inspect_ai's --model flag.
      // For openai_compat agents this is the real model. For other forms, the
      // ts_bridge solver intercepts every sample so the value is just a label
      // used for result file paths — synthesize one tied to the agent.
      let modelId: string;
      if (agent.agentType === 'openai_compat') {
        modelId = agent.modelId || '';
        if (modelId && !modelId.includes('/')) {
          modelId = `openai/${modelId}`;
        }
        if (!modelId) {
          res.status(400).json(errorResponse('openai_compat agent missing modelId'));
          return;
        }
      } else {
        modelId = `openai/bridge-${agent.agentType}-${agent.id}`;
      }

      const jobName = `eval-${agent.name}-${Date.now()}`;

      // Pre-compute totalSamples from limit so the frontend shows "X / N" instead of
      // "X / 0" while inspect_ai is still enumerating the dataset. Defensive bumps in
      // internalAgentRunnerController keep this honest if inspect_ai exceeds the
      // predicted count.
      const limitNum = limit != null ? Number(limit) : 0;
      const perTaskTotal = limitNum > 0 ? limitNum : 0;
      const jobTotalSamples = perTaskTotal * tasksToCreate.length;

      const job = await EvalJob.create({
        agentId,
        judgeModelId: resolvedJudgeName ? Number(judgeModelId) : null,
        name: jobName,
        benchmarks: benchmarks as string[],
        modelId,
        limit: limit ?? null,
        // Persist resolved judge name when JudgeModel was used; fall back to legacy string.
        judgeModel: resolvedJudgeName || judgeModel || null,
        systemPrompt: systemPrompt ?? null,
        config: skipJudgeFlag ? { v1: { skipJudge: true } } : null,
        concurrency: concurrencyValue,
        samplingMode: samplingModeValue,
        totalTasks: tasksToCreate.length,
        completedTasks: 0,
        // totalSamples and totalItems are functionally redundant (both denote
        // "expected number of samples"). Job-list UI reads totalItems, the
        // progress widget reads totalSamples — initialize both so neither
        // surface displays "X / 0" before the first sample lands.
        totalSamples: jobTotalSamples,
        totalItems: jobTotalSamples,
      });

      for (const taskDef of tasksToCreate) {
        await EvalTask.create({
          jobId: job.id,
          agentId,
          benchmark: taskDef.benchmark,
          taskName: taskDef.taskName,
          samplesTotal: perTaskTotal,
          totalSamples: perTaskTotal,
        });
      }

      logger.info(`Eval job created: ${job.id} with ${tasksToCreate.length} tasks`);

      runJob(job.id).catch((err) => {
        logger.error(`Background job execution failed for job ${job.id}:`, err.message);
      });

      res.status(201).json(successResponse(job, 'Evaluation job created and started'));
    } catch (error: any) {
      logger.error('Failed to create eval job:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  /**
   * GET /api/eval/jobs — List evaluation jobs.
   *
   * Query params: page, pageSize, status
   */
  async listJobs(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string, 10) || 10));
      const status = (req.query.status as string) || undefined;

      const where: any = {};
      if (status) {
        where.status = status;
      }

      const offset = (page - 1) * pageSize;

      const { rows, count } = await EvalJob.findAndCountAll({
        where,
        limit: pageSize,
        offset,
        order: [['createdAt', 'DESC']],
        include: [
          { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId', 'agentType', 'apiBase'] },
        ],
      });

      res.json(paginatedResponse(rows, count, page, pageSize));
    } catch (error: any) {
      logger.error('Failed to list eval jobs:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  /**
   * GET /api/eval/jobs/:id — Get full details for a single job.
   */
  async getJob(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid job ID'));
        return;
      }

      const job = await EvalJob.findByPk(id, {
        include: [
          { model: EvalTask, as: 'tasks' },
          { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId', 'agentType', 'apiBase'] },
        ],
      });

      if (!job) {
        res.status(404).json(errorResponse('Evaluation job not found'));
        return;
      }

      res.json(successResponse(job));
    } catch (error: any) {
      logger.error('Failed to get eval job:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  /**
   * DELETE /api/eval/jobs/:id — Cancel a running job or delete a terminal/pending one.
   */
  async deleteJob(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid job ID'));
        return;
      }

      const job = await EvalJob.findByPk(id);
      if (!job) {
        res.status(404).json(errorResponse('Evaluation job not found'));
        return;
      }

      // If the job is running, cancel it first
      if (job.status === EVAL_STATUS.RUNNING) {
        await cancelJob(id);
      }

      // Delete associated tasks then the job
      await EvalTask.destroy({ where: { jobId: id } });
      await job.destroy();

      res.json(successResponse(null, 'Evaluation job deleted'));
    } catch (error: any) {
      logger.error('Failed to delete eval job:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  /**
   * GET /api/eval/categories — List evaluation categories with their benchmarks.
   */
  async getCategories(_req: Request, res: Response): Promise<void> {
    try {
      const categories = Object.values(EVAL_CATEGORIES).map((cat) => ({
        key: cat.key,
        name: cat.name,
        nameEn: cat.nameEn,
        description: cat.description,
        priority: cat.priority,
        benchmarks: CATEGORY_BENCHMARK_MAP[cat.key] || [],
      }));

      res.json(successResponse(categories));
    } catch (error: any) {
      logger.error('Failed to get categories:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default evalController;
