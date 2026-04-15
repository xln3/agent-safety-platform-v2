import { Request, Response } from 'express';
import { EvalJob, EvalTask, Agent } from '../models';
import { readEvalSamples } from '../services/resultReader';
import { successResponse, errorResponse } from '../utils/response';
import logger from '../utils/logger';

export const resultController = {
  /**
   * GET /api/results/by-job/:jobId — Results for an evaluation job.
   *
   * Returns all tasks with their scores plus aggregate statistics.
   */
  async getJobResults(req: Request, res: Response): Promise<void> {
    try {
      const jobId = parseInt(req.params.jobId as string, 10);
      if (isNaN(jobId)) {
        res.status(400).json(errorResponse('Invalid job ID'));
        return;
      }

      const job = await EvalJob.findByPk(jobId, {
        include: [
          { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId'] },
        ],
      });

      if (!job) {
        res.status(404).json(errorResponse('Evaluation job not found'));
        return;
      }

      const tasks = await EvalTask.findAll({
        where: { jobId },
        order: [['benchmark', 'ASC'], ['taskName', 'ASC']],
      });

      // --- Build per-task result list ---
      const taskResults = tasks.map((task) => ({
        id: task.id,
        benchmark: task.benchmark,
        taskName: task.taskName,
        status: task.status,
        safetyScore: task.safetyScore,
        riskLevel: task.riskLevel,
        rawScore: task.rawScore,
        interpretation: task.interpretation,
        samplesTotal: task.samplesTotal,
        samplesPassed: task.samplesPassed,
        errorMessage: task.errorMessage,
      }));

      // --- Compute aggregate stats ---
      const scoredTasks = tasks.filter((t) => t.safetyScore !== null);
      const overallSafetyScore =
        scoredTasks.length > 0
          ? Number(
              (
                scoredTasks.reduce((sum, t) => sum + Number(t.safetyScore), 0) /
                scoredTasks.length
              ).toFixed(2),
            )
          : null;

      // Risk level distribution
      const riskDistribution: Record<string, number> = {};
      for (const task of tasks) {
        if (task.riskLevel) {
          riskDistribution[task.riskLevel] = (riskDistribution[task.riskLevel] || 0) + 1;
        }
      }

      res.json(
        successResponse({
          job,
          tasks: taskResults,
          aggregate: {
            overallSafetyScore,
            scoredTaskCount: scoredTasks.length,
            totalTaskCount: tasks.length,
            riskDistribution,
          },
        }),
      );
    } catch (error: any) {
      logger.error('Failed to get job results:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  /**
   * GET /api/results/by-job/:jobId/tasks/:taskId/samples — Paginated sample details.
   *
   * Query params: page (default 1), pageSize (default 20)
   */
  async getTaskSamples(req: Request, res: Response): Promise<void> {
    try {
      const jobId = parseInt(req.params.jobId as string, 10);
      const taskId = parseInt(req.params.taskId as string, 10);

      if (isNaN(jobId) || isNaN(taskId)) {
        res.status(400).json(errorResponse('Invalid job ID or task ID'));
        return;
      }

      const task = await EvalTask.findOne({
        where: { id: taskId, jobId },
      });

      if (!task) {
        res.status(404).json(errorResponse('Evaluation task not found'));
        return;
      }

      if (!task.evalFile) {
        res.status(404).json(errorResponse('No eval result file available for this task'));
        return;
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string, 10) || 20));
      const offset = (page - 1) * pageSize;

      const { samples, total } = await readEvalSamples(task.evalFile, offset, pageSize);

      res.json(
        successResponse({
          task: {
            id: task.id,
            benchmark: task.benchmark,
            taskName: task.taskName,
          },
          samples,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        }),
      );
    } catch (error: any) {
      logger.error('Failed to get task samples:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default resultController;
