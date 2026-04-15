import { Request, Response } from 'express';
import { Agent, EvalJob, EvalTask } from '../models';
import { runJob, cancelJob } from '../services/evalRunner';
import { catalogService } from '../services/catalogService';
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
      const { agentId, benchmarks, limit, judgeModel, systemPrompt } = req.body;

      // --- Validation ---
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

      // --- Resolve tasks for each requested benchmark from catalog ---
      const allBenchmarks = catalogService.getAllBenchmarks();
      const benchmarkMap = new Map(allBenchmarks.map((b) => [b.name, b]));

      const tasksToCreate: { benchmark: string; taskName: string }[] = [];

      for (const bmName of benchmarks) {
        const bmInfo = benchmarkMap.get(bmName);
        if (!bmInfo) {
          // Skip unknown benchmarks (could also 400, but lenient approach)
          logger.warn(`createJob: unknown benchmark "${bmName}", skipping`);
          continue;
        }

        if (bmInfo.tasks.length > 0) {
          for (const task of bmInfo.tasks) {
            tasksToCreate.push({ benchmark: bmName, taskName: task.name });
          }
        } else {
          // Benchmark has no sub-tasks listed — treat the benchmark itself as one task
          tasksToCreate.push({ benchmark: bmName, taskName: bmName });
        }
      }

      if (tasksToCreate.length === 0) {
        res.status(400).json(errorResponse('No valid benchmarks or tasks found for the provided benchmark names'));
        return;
      }

      // --- Determine modelId ---
      let modelId = agent.modelId;
      if (modelId && !modelId.includes('/')) {
        modelId = `openai/${modelId}`;
      }

      // --- Auto-generate a job name ---
      const jobName = `eval-${agent.name}-${Date.now()}`;

      // --- Create EvalJob ---
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

      // --- Create EvalTask records ---
      for (const taskDef of tasksToCreate) {
        await EvalTask.create({
          jobId: job.id,
          agentId,
          benchmark: taskDef.benchmark,
          taskName: taskDef.taskName,
        });
      }

      logger.info(`Eval job created: ${job.id} with ${tasksToCreate.length} tasks`);

      // --- Fire-and-forget: start the job ---
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
          { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId'] },
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
          { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId'] },
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

      // If the job is running, cancel it first (kills sub-processes)
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
