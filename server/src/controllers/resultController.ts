import { Request, Response } from 'express';
import { EvalJob, EvalTask, EvalItem, Agent } from '../models';
import { readEvalSamples } from '../services/resultReader';
import { aggregateDimensions, TaskResultRow } from '../services/dimensionAggregator';
import { evalItemToV1Sample, logSampleToV1Sample } from '../services/v1SampleShape';
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
      const failedTasks = tasks.filter((t) => t.status === 'failed');
      const overallSafetyScore =
        scoredTasks.length > 0
          ? Number(
              (
                scoredTasks.reduce((sum, t) => sum + Number(t.safetyScore), 0) /
                scoredTasks.length
              ).toFixed(2),
            )
          : null;

      // Coverage: fraction of tasks that produced a score. Below 0.8 the overall
      // number is statistically untrustworthy — the UI treats it as insufficient
      // and refuses to render a summary tier / star rating to avoid misleading
      // 甲方 (e.g. job 40 where 1/3 subtasks scored but UI showed "稳健 100/100").
      const coverage =
        tasks.length > 0 ? Number((scoredTasks.length / tasks.length).toFixed(3)) : 0;
      let aggregateStatus: 'sufficient' | 'insufficient' | 'no_data';
      if (scoredTasks.length === 0) aggregateStatus = 'no_data';
      else if (coverage < 0.8) aggregateStatus = 'insufficient';
      else aggregateStatus = 'sufficient';

      // Risk level distribution
      const riskDistribution: Record<string, number> = {};
      for (const task of tasks) {
        if (task.riskLevel) {
          riskDistribution[task.riskLevel] = (riskDistribution[task.riskLevel] || 0) + 1;
        }
      }

      // Per-category / per-dimension assessment (Q2 Layer 2). The aggregator
      // is data-driven from dimensions.yaml, so adding a new benchmark to the
      // catalog only needs a YAML edit, not a controller change.
      const aggregatorRows: TaskResultRow[] = taskResults.map((t) => ({
        benchmark: t.benchmark,
        taskName: t.taskName,
        safetyScore: t.safetyScore == null ? null : Number(t.safetyScore),
        riskLevel: t.riskLevel,
      }));
      const assessment = aggregateDimensions(aggregatorRows);

      res.json(
        successResponse({
          job,
          tasks: taskResults,
          aggregate: {
            overallSafetyScore,
            scoredTaskCount: scoredTasks.length,
            failedTaskCount: failedTasks.length,
            totalTaskCount: tasks.length,
            coverage,
            aggregateStatus,
            riskDistribution,
          },
          assessment,
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
   * Prefers EvalItem rows (real-time, written per-sample by the bridge solver)
   * over the inspect_ai .json log (only flushed at task completion). The DB
   * path lets the frontend show samples one-by-one during a live run; the log
   * fallback covers older jobs where EvalItem rows were never written.
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

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string, 10) || 20));
      const offset = (page - 1) * pageSize;

      const evalItemTotal = await EvalItem.count({ where: { taskId: task.id } });

      if (evalItemTotal > 0) {
        const items = await EvalItem.findAll({
          where: { taskId: task.id },
          order: [['createdAt', 'ASC']],
          offset,
          limit: pageSize,
        });
        res.json(
          successResponse({
            task: {
              id: task.id,
              benchmark: task.benchmark,
              taskName: task.taskName,
            },
            samples: items.map(evalItemToV1Sample),
            pagination: {
              page,
              pageSize,
              total: evalItemTotal,
              totalPages: Math.ceil(evalItemTotal / pageSize),
            },
            source: 'eval_items',
          }),
        );
        return;
      }

      if (!task.evalFile) {
        res.status(404).json(errorResponse('No eval result file available for this task'));
        return;
      }

      const { samples, total } = await readEvalSamples(task.evalFile, offset, pageSize);

      res.json(
        successResponse({
          task: {
            id: task.id,
            benchmark: task.benchmark,
            taskName: task.taskName,
          },
          samples: samples.map(logSampleToV1Sample),
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
          source: 'log_file',
        }),
      );
    } catch (error: any) {
      logger.error('Failed to get task samples:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default resultController;
