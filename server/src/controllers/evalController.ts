import { Request, Response } from 'express';
import { Agent, EvalJob, EvalTask, EvalItem } from '../models';
import { runJob, cancelJob } from '../services/evalRunner';
import { runAgentJob, cancelAgentJob } from '../services/agentEvalRunner';
import { catalogService } from '../services/catalogService';
import { sampleTestData } from '../services/testDataService';
import { EVAL_STATUS, EVAL_CATEGORIES, CATEGORY_BENCHMARK_MAP } from '../constants';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import logger from '../utils/logger';

export const evalController = {
  /**
   * POST /api/eval/jobs — Create a new evaluation job.
   *
   * Body: { agentId, benchmarks, limit?, judgeModel?, systemPrompt? }
   */
  async createJob(req: Request, res: Response): Promise<void> {
    try {
      const { agentId } = req.body;

      if (!agentId) {
        res.status(400).json(errorResponse('Missing required field: agentId'));
        return;
      }

      const agent = await Agent.findByPk(agentId);
      if (!agent) {
        res.status(404).json(errorResponse(`Agent not found: ${agentId}`));
        return;
      }

      // Branch based on agent type
      const isDifyAgent = agent.agentType === 'dify_chat' || agent.agentType === 'dify_workflow';

      if (isDifyAgent) {
        await evalController._createAgentJob(req, res, agent);
      } else {
        await evalController._createBenchmarkJob(req, res, agent);
      }
    } catch (error: any) {
      logger.error('Failed to create eval job:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  /**
   * Create an agent evaluation job (Dify agent testing).
   * Body: { agentId, taskTypes: string[], dataMode: 'all'|'random', sampleCount?: number }
   */
  async _createAgentJob(req: Request, res: Response, agent: InstanceType<typeof Agent>): Promise<void> {
    const { agentId, taskTypes, dataMode, sampleCount } = req.body;

    // Validate taskTypes
    if (!taskTypes || !Array.isArray(taskTypes) || taskTypes.length === 0) {
      res.status(400).json(errorResponse('Missing required field: taskTypes (non-empty array of category keys)'));
      return;
    }

    const validCategories = new Set(Object.keys(CATEGORY_BENCHMARK_MAP));
    const invalidTypes = taskTypes.filter((t: string) => !validCategories.has(t));
    if (invalidTypes.length > 0) {
      res.status(400).json(errorResponse(`Unknown task type(s): ${invalidTypes.join(', ')}`));
      return;
    }

    // Validate dataMode
    const mode = dataMode || 'all';
    if (mode !== 'all' && mode !== 'random') {
      res.status(400).json(errorResponse('dataMode must be "all" or "random"'));
      return;
    }

    if (mode === 'random' && (!sampleCount || sampleCount <= 0)) {
      res.status(400).json(errorResponse('sampleCount must be a positive integer when dataMode is "random"'));
      return;
    }

    // Load and sample test data
    const testItems = sampleTestData(taskTypes, mode, sampleCount);
    if (testItems.length === 0) {
      res.status(400).json(errorResponse('No test data available for the selected task types'));
      return;
    }

    // Auto-generate job name
    const jobName = `agent-eval-${agent.name}-${Date.now()}`;

    // Create EvalJob
    const job = await EvalJob.create({
      agentId,
      name: jobName,
      benchmarks: taskTypes as string[],
      modelId: agent.modelId || '',
      dataMode: mode,
      sampleCount: mode === 'random' ? sampleCount : null,
      totalTasks: taskTypes.length,
      completedTasks: 0,
      totalItems: testItems.length,
      completedItems: 0,
    });

    // Create EvalTask per category
    const taskMap = new Map<string, number>();
    for (const cat of taskTypes) {
      const catName = Object.values(EVAL_CATEGORIES).find((c) => c.key === cat)?.name || cat;
      const task = await EvalTask.create({
        jobId: job.id,
        agentId,
        benchmark: cat,
        taskName: catName,
      });
      taskMap.set(cat, task.id);
    }

    // Create EvalItem per test item
    let globalIndex = 0;
    for (const item of testItems) {
      const taskId = taskMap.get(item.category);
      if (!taskId) continue;

      await EvalItem.create({
        taskId,
        jobId: job.id,
        itemIndex: globalIndex++,
        input: item.input,
      });
    }

    logger.info(`Agent eval job created: ${job.id} with ${taskTypes.length} tasks, ${testItems.length} items`);

    // Fire-and-forget
    runAgentJob(job.id).catch((err) => {
      logger.error(`Agent eval job ${job.id} failed:`, err.message);
    });

    res.status(201).json(successResponse(job, 'Agent evaluation job created and started'));
  },

  /**
   * Create a benchmark evaluation job (existing inspect_ai flow).
   * Body: { agentId, benchmarks: string[], limit?, judgeModel?, systemPrompt? }
   */
  async _createBenchmarkJob(req: Request, res: Response, agent: InstanceType<typeof Agent>): Promise<void> {
    const { agentId, benchmarks, limit, judgeModel, systemPrompt } = req.body;

    if (!benchmarks || !Array.isArray(benchmarks) || benchmarks.length === 0) {
      res.status(400).json(errorResponse('Missing required field: benchmarks (non-empty array)'));
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

    // Validate judgeModel if provided
    if (judgeModel !== undefined && judgeModel !== null) {
      if (typeof judgeModel !== 'string' || judgeModel.trim().length === 0) {
        res.status(400).json(errorResponse('judgeModel must be a non-empty string'));
        return;
      }
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

    // Determine modelId
    let modelId = agent.modelId || '';
    if (modelId && !modelId.includes('/')) {
      modelId = `openai/${modelId}`;
    }

    const jobName = `eval-${agent.name}-${Date.now()}`;

    const job = await EvalJob.create({
      agentId,
      name: jobName,
      benchmarks: benchmarks as string[],
      modelId,
      limit: limit ?? null,
      judgeModel: judgeModel ?? null,
      systemPrompt: systemPrompt ?? null,
      config: null,
      totalTasks: tasksToCreate.length,
      completedTasks: 0,
    });

    for (const taskDef of tasksToCreate) {
      await EvalTask.create({
        jobId: job.id,
        agentId,
        benchmark: taskDef.benchmark,
        taskName: taskDef.taskName,
      });
    }

    logger.info(`Eval job created: ${job.id} with ${tasksToCreate.length} tasks`);

    runJob(job.id).catch((err) => {
      logger.error(`Background job execution failed for job ${job.id}:`, err.message);
    });

    res.status(201).json(successResponse(job, 'Evaluation job created and started'));
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
        // Determine if this is an agent job
        const agent = await Agent.findByPk(job.agentId);
        const isDify = agent?.agentType === 'dify_chat' || agent?.agentType === 'dify_workflow';
        if (isDify) {
          await cancelAgentJob(id);
        } else {
          await cancelJob(id);
        }
      }

      // Delete associated items, tasks, then the job
      await EvalItem.destroy({ where: { jobId: id } });
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
