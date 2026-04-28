/**
 * SSE stream + per-sample item listing for an eval job.
 *
 * GET /api/eval/jobs/:id/stream
 *   Server-Sent Events feed of job/task/sample lifecycle events. Clients
 *   open this once the job is created; the runner emits events via sseService.
 *   The connection is kept alive with periodic heartbeat events so proxies
 *   don't drop it.
 *
 * GET /api/eval/jobs/:id/items
 *   Paginated list of EvalItem rows for a job (per-sample run records).
 */

import { Request, Response } from 'express';
import { EvalJob, EvalItem, EvalTask } from '../models';
import { sseService } from '../services/sseService';
import { errorResponse, paginatedResponse } from '../utils/response';
import logger from '../utils/logger';

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function evalStreamHandler(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id as string, 10);
  if (Number.isNaN(id)) {
    res.status(400).json(errorResponse('Invalid job ID'));
    return;
  }

  const job = await EvalJob.findByPk(id);
  if (!job) {
    res.status(404).json(errorResponse('Evaluation job not found'));
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Initial snapshot so the client can render immediately without waiting
  // for the next live event.
  const tasks = await EvalTask.findAll({
    where: { jobId: id },
    order: [['benchmark', 'ASC'], ['taskName', 'ASC']],
  });
  const snapshot = {
    jobId: id,
    status: job.status,
    totalTasks: job.totalTasks,
    completedTasks: job.completedTasks,
    totalItems: job.totalItems,
    completedItems: job.completedItems,
    tasks: tasks.map((t) => ({
      id: t.id,
      benchmark: t.benchmark,
      taskName: t.taskName,
      status: t.status,
      totalSamples: t.totalSamples,
      completedSamples: t.completedSamples,
      failedSamples: t.failedSamples,
      safetyScore: t.safetyScore,
      riskLevel: t.riskLevel,
    })),
  };
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

  sseService.subscribe(id, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch (err: any) {
      logger.warn(`SSE heartbeat failed for job=${id}: ${err.message}`);
    }
  }, HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseService.unsubscribe(id, res);
    logger.debug(`SSE client disconnected job=${id}`);
  });
}

export async function getJobItemHandler(req: Request, res: Response): Promise<void> {
  try {
    const jobId = parseInt(req.params.id as string, 10);
    const itemId = parseInt(req.params.itemId as string, 10);
    if (Number.isNaN(jobId) || Number.isNaN(itemId)) {
      res.status(400).json(errorResponse('Invalid job or item ID'));
      return;
    }

    const item = await EvalItem.findOne({ where: { id: itemId, jobId } });
    if (!item) {
      res.status(404).json(errorResponse('Eval item not found'));
      return;
    }

    res.json({ code: 0, message: 'success', data: item });
  } catch (err: any) {
    logger.error(`Failed to get eval item: ${err.message}`);
    res.status(500).json(errorResponse(err.message));
  }
}

export async function listJobItemsHandler(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (Number.isNaN(id)) {
      res.status(400).json(errorResponse('Invalid job ID'));
      return;
    }

    const job = await EvalJob.findByPk(id);
    if (!job) {
      res.status(404).json(errorResponse('Evaluation job not found'));
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.max(1, Math.min(200, parseInt(req.query.pageSize as string, 10) || 50));
    const taskIdQ = req.query.taskId ? parseInt(req.query.taskId as string, 10) : null;
    const status = (req.query.status as string) || undefined;

    const where: any = { jobId: id };
    if (taskIdQ && !Number.isNaN(taskIdQ)) where.taskId = taskIdQ;
    if (status) where.status = status;

    const offset = (page - 1) * pageSize;
    const { rows, count } = await EvalItem.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [['id', 'ASC']],
    });

    res.json(paginatedResponse(rows, count, page, pageSize));
  } catch (err: any) {
    logger.error(`Failed to list eval items: ${err.message}`);
    res.status(500).json(errorResponse(err.message));
  }
}

export default { evalStreamHandler, listJobItemsHandler, getJobItemHandler };
