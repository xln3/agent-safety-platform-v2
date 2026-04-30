/**
 * Internal callback endpoint hit by the Python ts_bridge solver.
 *
 * The solver calls POST /api/internal/agent-runner/invoke once per sample.
 * This controller:
 *   1. Finds the EvalJob's active task via activeTaskRegistry (to attribute
 *      the sample to the right EvalTask, since the solver only knows jobId).
 *   2. Creates/updates an EvalItem (status=running) and emits `sample.start`.
 *   3. Dispatches to the right runner (openai_compat / dify_chat / dify_workflow / cli).
 *   4. On success: updates EvalItem (status=success, outputText, latencyMs)
 *      and increments task/job sample counters; emits `sample.finish`.
 *   5. On failure (after one retry): updates EvalItem (status=failed,
 *      errorMessage); emits `sample.finish` with status=failed.
 */

import { Request, Response } from 'express';
import { literal } from 'sequelize';
import { agentService } from '../services/agentService';
import { invokeAgent, RunnerInput } from '../services/agentRunner';
import { EvalItem, EvalTask, EvalJob } from '../models';
import { getActiveTask } from '../services/activeTaskRegistry';
import { sseService } from '../services/sseService';
import { successResponse, errorResponse } from '../utils/response';
import logger from '../utils/logger';

/**
 * Defensive bump: keep totalSamples / samplesTotal / totalItems at least as
 * large as the already-completed counters. Pre-computed at job-create time
 * from limit, but inspect_ai may exceed that (e.g. epochs > 1, or limit not
 * set). totalItems is the field surfaced by the job-list UI ("X / N 项"); if
 * we only bump totalSamples it stays at 0 forever — that was the 2026-04-28
 * audit's "367 / 0 项" finding.
 */
async function bumpTotalsToAtLeastCompleted(jobId: number, taskId: number): Promise<void> {
  await EvalTask.update(
    {
      samplesTotal: literal('GREATEST(samples_total, completed_samples)'),
      totalSamples: literal('GREATEST(total_samples, completed_samples)'),
    },
    { where: { id: taskId } },
  );
  await EvalJob.update(
    {
      totalSamples: literal('GREATEST(total_samples, completed_items)'),
      totalItems: literal('GREATEST(total_items, completed_items)'),
    },
    { where: { id: jobId } },
  );
}

const MAX_RETRIES = 1;

function isRetriable(err: any): boolean {
  if (!err) return false;
  if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENETUNREACH'].includes(err.code)) {
    return true;
  }
  const status = err.response?.status;
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) return true;
  }
  return false;
}

function parseInput(body: any): RunnerInput | string {
  if (!body || typeof body !== 'object') return 'request body must be a JSON object';
  const agentId = Number(body.agentId);
  if (!agentId || Number.isNaN(agentId)) return 'agentId is required and must be numeric';
  const sampleId = body.sampleId;
  if (!sampleId || typeof sampleId !== 'string') return 'sampleId is required';
  const input = typeof body.input === 'string' ? body.input : '';
  const tools = Array.isArray(body.tools)
    ? body.tools
        .filter((t: any) => t && typeof t === 'object' && typeof t.name === 'string' && t.name)
        .map((t: any) => ({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : '',
          parameters: t.parameters && typeof t.parameters === 'object' ? t.parameters : {},
        }))
    : [];
  return {
    agentId,
    jobId: body.jobId == null ? null : Number(body.jobId),
    sampleId,
    input,
    messages: Array.isArray(body.messages) ? body.messages : [],
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    target: body.target ?? null,
    tools: tools.length > 0 ? tools : undefined,
  };
}

/**
 * Locate or create an EvalItem row for (taskId, sampleId).
 * Returns null when no active task is registered for this jobId — that means
 * either the job already finished or the runner failed to register the task.
 */
async function ensureEvalItem(
  jobId: number,
  taskId: number,
  benchmark: string,
  sampleId: string,
  inputJson: object,
): Promise<EvalItem> {
  const [item] = await EvalItem.findOrCreate({
    where: { taskId, sampleId },
    defaults: {
      jobId,
      taskId,
      benchmark,
      sampleId,
      inputJson,
      status: 'running',
      retryCount: 0,
      startedAt: new Date(),
    },
  });

  // If the row already existed (e.g. the solver retried this sample at the
  // inspect_ai layer), bump retryCount and reset to running.
  if (item.status !== 'running') {
    await item.update({
      status: 'running',
      retryCount: (item.retryCount || 0) + 1,
      errorMessage: null,
      startedAt: new Date(),
      finishedAt: null,
      outputText: null,
      latencyMs: null,
    });
  }

  return item;
}

export const internalAgentRunnerController = {
  async invoke(req: Request, res: Response): Promise<void> {
    const parsed = parseInput(req.body);
    if (typeof parsed === 'string') {
      res.status(400).json(errorResponse(parsed));
      return;
    }
    const input = parsed;

    try {
      const agent = await agentService.findById(input.agentId);
      if (!agent) {
        res.status(404).json(errorResponse(`Agent ${input.agentId} not found`));
        return;
      }

      // Locate the active task within this job so we can attribute samples.
      const jobId = input.jobId ?? null;
      const active = jobId != null ? getActiveTask(jobId) : undefined;

      let item: EvalItem | null = null;
      if (jobId != null && active) {
        try {
          item = await ensureEvalItem(
            jobId,
            active.taskId,
            active.benchmark,
            input.sampleId,
            {
              input: input.input,
              messages: input.messages,
              metadata: input.metadata,
              target: input.target,
            },
          );

          sseService.emit(jobId, 'sample.start', {
            jobId,
            taskId: active.taskId,
            benchmark: active.benchmark,
            taskName: active.taskName,
            sampleId: input.sampleId,
            itemId: item.id,
            target: input.target ?? null,
            startedAt: item.startedAt,
          });
        } catch (persistErr: any) {
          // Don't fail the agent call if persistence fails — log and continue.
          logger.warn(
            `EvalItem persistence failed (job=${jobId} sample=${input.sampleId}): ${persistErr.message}`,
          );
        }
      }

      let lastErr: any = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await invokeAgent(agent, input);

          if (item && jobId != null) {
            await item.update({
              status: 'success',
              outputText: result.output,
              latencyMs: result.latencyMs,
              finishedAt: new Date(),
              errorMessage: null,
              toolCallsJson: result.toolCalls && result.toolCalls.length > 0
                ? (result.toolCalls as unknown as object)
                : null,
            });

            // Bump per-task and per-job sample counters.
            await EvalTask.increment(
              { completedSamples: 1, samplesPassed: 1 },
              { where: { id: active!.taskId } },
            );
            await EvalJob.increment(
              { completedItems: 1 },
              { where: { id: jobId } },
            );
            await bumpTotalsToAtLeastCompleted(jobId, active!.taskId);

            sseService.emit(jobId, 'sample.finish', {
              jobId,
              taskId: active!.taskId,
              benchmark: active!.benchmark,
              taskName: active!.taskName,
              sampleId: input.sampleId,
              itemId: item.id,
              status: 'success',
              target: input.target ?? null,
              latencyMs: result.latencyMs,
              outputPreview: typeof result.output === 'string'
                ? result.output.slice(0, 240)
                : '',
              finishedAt: new Date().toISOString(),
            });
          }

          res.json(
            successResponse({
              output: result.output,
              latencyMs: result.latencyMs,
              attempts: attempt + 1,
              toolCalls: result.toolCalls ?? [],
            }),
          );
          return;
        } catch (err: any) {
          lastErr = err;
          logger.warn(
            `Agent ${agent.id} (${agent.agentType}) sample=${input.sampleId} attempt=${attempt + 1} failed: ${err.message}`,
          );
          if (attempt >= MAX_RETRIES || !isRetriable(err)) break;
        }
      }

      // All attempts exhausted — record failure.
      if (item && jobId != null && active) {
        const errMsg = lastErr?.message || 'unknown error';
        await item.update({
          status: 'failed',
          errorMessage: errMsg.slice(0, 4000),
          finishedAt: new Date(),
        });
        await EvalTask.increment(
          { completedSamples: 1, failedSamples: 1 },
          { where: { id: active.taskId } },
        );
        await EvalJob.increment(
          { completedItems: 1 },
          { where: { id: jobId } },
        );
        await bumpTotalsToAtLeastCompleted(jobId, active.taskId);
        sseService.emit(jobId, 'sample.finish', {
          jobId,
          taskId: active.taskId,
          benchmark: active.benchmark,
          taskName: active.taskName,
          sampleId: input.sampleId,
          itemId: item.id,
          status: 'failed',
          target: input.target ?? null,
          errorMessage: errMsg.slice(0, 240),
          finishedAt: new Date().toISOString(),
        });
      }

      res
        .status(502)
        .json(errorResponse(`Agent invocation failed: ${lastErr?.message || 'unknown error'}`));
    } catch (error: any) {
      logger.error(`internal agent runner error: ${error.message}`);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default internalAgentRunnerController;
