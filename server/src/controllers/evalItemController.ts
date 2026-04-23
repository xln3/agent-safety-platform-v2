import { Request, Response } from 'express';
import { EvalItem, EvalJob, EvalTask, Agent } from '../models';
import { jobEvents, JobEvent } from '../services/agentEvalRunner';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import logger from '../utils/logger';

export const evalItemController = {
  /**
   * GET /api/eval/jobs/:id/items — Paginated list of test items for a job.
   *
   * Query: page, pageSize, taskId (optional filter)
   */
  async getItems(req: Request, res: Response): Promise<void> {
    try {
      const jobId = parseInt(req.params.id as string, 10);
      if (isNaN(jobId)) {
        res.status(400).json(errorResponse('Invalid job ID'));
        return;
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.max(1, Math.min(200, parseInt(req.query.pageSize as string, 10) || 50));
      const taskId = req.query.taskId ? parseInt(req.query.taskId as string, 10) : undefined;

      const where: any = { jobId };
      if (taskId) where.taskId = taskId;

      const { rows, count } = await EvalItem.findAndCountAll({
        where,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        order: [['itemIndex', 'ASC']],
        include: [
          { model: EvalTask, as: 'task', attributes: ['id', 'benchmark', 'taskName'] },
        ],
      });

      res.json(paginatedResponse(rows, count, page, pageSize));
    } catch (error: any) {
      logger.error('Failed to get eval items:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  /**
   * GET /api/eval/jobs/:id/stream — Server-Sent Events stream for real-time results.
   *
   * Replays completed items on connect, then streams live updates.
   */
  async streamJob(req: Request, res: Response): Promise<void> {
    const jobId = parseInt(req.params.id as string, 10);
    if (isNaN(jobId)) {
      res.status(400).json(errorResponse('Invalid job ID'));
      return;
    }

    // Check job exists
    const job = await EvalJob.findByPk(jobId, {
      include: [
        { model: Agent, as: 'agent', attributes: ['id', 'name', 'agentType', 'apiBase'] },
      ],
    });
    if (!job) {
      res.status(404).json(errorResponse('Job not found'));
      return;
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial job info
    const sendEvent = (event: JobEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Send job metadata
    sendEvent({
      type: 'job_complete', // reuse type just for initial state
      data: {
        jobId: job.id,
        status: job.status,
        agentName: (job as any).agent?.name,
        agentType: (job as any).agent?.agentType,
        apiBase: (job as any).agent?.apiBase,
        totalItems: job.totalItems,
        completedItems: job.completedItems,
        totalTasks: job.totalTasks,
        completedTasks: job.completedTasks,
        startedAt: job.startedAt,
        _initial: true,
      },
    });

    // Replay already-completed items
    const completedItems = await EvalItem.findAll({
      where: { jobId, status: ['success', 'failed'] },
      order: [['itemIndex', 'ASC']],
      include: [
        { model: EvalTask, as: 'task', attributes: ['id', 'benchmark', 'taskName'] },
      ],
    });

    for (const item of completedItems) {
      sendEvent({
        type: 'item_complete',
        data: {
          taskId: item.taskId,
          itemId: item.id,
          itemIndex: item.itemIndex,
          input: item.input,
          actualOutput: item.actualOutput,
          status: item.status,
          latencyMs: item.latencyMs,
          errorMessage: item.errorMessage,
          category: (item as any).task?.benchmark,
          _replay: true,
        },
      });
    }

    // If job is already done, close stream
    if (job.status === 'completed' || job.status === 'failed') {
      sendEvent({ type: 'job_complete', data: { jobId, status: job.status, _done: true } });
      res.end();
      return;
    }

    // Subscribe to live events
    const listener = (event: JobEvent) => {
      try {
        sendEvent(event);

        // Close stream when job finishes
        if (event.type === 'job_complete' || event.type === 'job_error') {
          cleanup();
          res.end();
        }
      } catch {
        cleanup();
      }
    };

    const eventKey = `job:${jobId}`;
    jobEvents.on(eventKey, listener);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        cleanup();
      }
    }, 15_000);

    const cleanup = () => {
      jobEvents.removeListener(eventKey, listener);
      clearInterval(heartbeat);
    };

    // Client disconnect
    req.on('close', cleanup);
  },
};

export default evalItemController;
