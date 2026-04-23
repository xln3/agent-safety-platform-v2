/**
 * Agent Evaluation Runner
 *
 * Orchestrates evaluation of Dify agents by iterating through test items,
 * calling the agent's API for each, recording results, and emitting SSE
 * events for real-time frontend display.
 *
 * This is a parallel execution path to evalRunner.ts (which handles
 * inspect_ai benchmark evaluations). It is fire-and-forget from the
 * controller's perspective.
 */

import { EventEmitter } from 'events';
import { Agent, EvalJob, EvalTask, EvalItem } from '../models';
import { EVAL_STATUS, TASK_STATUS } from '../constants';
import { sendChatMessage, runWorkflow, classifyDifyError } from './difyClient';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// SSE Event Bus
// ---------------------------------------------------------------------------

/**
 * Global event emitter for real-time job updates.
 * SSE endpoint subscribes to `job:<jobId>` events.
 */
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);

export interface JobEvent {
  type: 'item_start' | 'item_complete' | 'task_complete' | 'job_complete' | 'job_error';
  data: Record<string, any>;
}

function emitJobEvent(jobId: number, event: JobEvent): void {
  jobEvents.emit(`job:${jobId}`, event);
}

// ---------------------------------------------------------------------------
// Active job tracking
// ---------------------------------------------------------------------------

const activeJobs = new Map<number, { cancelled: boolean }>();

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

/**
 * Run an agent evaluation job. Fire-and-forget from the controller.
 *
 * Flow:
 *  1. Load job + agent + tasks + items
 *  2. For each item: call Dify API, record result, emit SSE event
 *  3. Update task/job status as items/tasks complete
 */
export async function runAgentJob(jobId: number): Promise<void> {
  const jobState = { cancelled: false };
  activeJobs.set(jobId, jobState);

  try {
    // Load job & agent
    const job = await EvalJob.findByPk(jobId);
    if (!job) {
      logger.error(`Agent eval job not found: ${jobId}`);
      return;
    }

    const agent = await Agent.findByPk(job.agentId);
    if (!agent) {
      logger.error(`Agent not found for job ${jobId}: ${job.agentId}`);
      await job.update({ status: EVAL_STATUS.FAILED });
      return;
    }

    // Mark job as running
    await job.update({ status: EVAL_STATUS.RUNNING, startedAt: new Date() });

    // Load tasks (one per category/task type)
    const tasks = await EvalTask.findAll({
      where: { jobId },
      order: [['id', 'ASC']],
    });

    for (const task of tasks) {
      if (jobState.cancelled) break;

      // Mark task running
      await task.update({ status: TASK_STATUS.RUNNING, startedAt: new Date() });

      // Load items for this task
      const items = await EvalItem.findAll({
        where: { taskId: task.id },
        order: [['itemIndex', 'ASC']],
      });

      await task.update({ samplesTotal: items.length });

      let passed = 0;

      for (const item of items) {
        if (jobState.cancelled) break;

        // Emit item start
        emitJobEvent(jobId, {
          type: 'item_start',
          data: {
            taskId: task.id,
            itemId: item.id,
            itemIndex: item.itemIndex,
            input: item.input,
            category: task.benchmark,
          },
        });

        await item.update({ status: 'running', startedAt: new Date() });

        try {
          let output: string;
          let latencyMs: number;

          if (agent.agentType === 'dify_workflow') {
            const result = await runWorkflow({
              apiBase: agent.apiBase,
              apiKey: agent.apiKey,
              inputs: { query: item.input },
            });
            output = typeof result.outputs === 'string'
              ? result.outputs
              : JSON.stringify(result.outputs, null, 2);
            latencyMs = result.latencyMs;
          } else {
            // dify_chat (default for dify agents)
            const result = await sendChatMessage({
              apiBase: agent.apiBase,
              apiKey: agent.apiKey,
              query: item.input,
            });
            output = result.answer;
            latencyMs = result.latencyMs;
          }

          await item.update({
            actualOutput: output,
            status: 'success',
            latencyMs,
            completedAt: new Date(),
          });

          passed++;

          // Emit item complete
          emitJobEvent(jobId, {
            type: 'item_complete',
            data: {
              taskId: task.id,
              itemId: item.id,
              itemIndex: item.itemIndex,
              input: item.input,
              actualOutput: output,
              status: 'success',
              latencyMs,
              category: task.benchmark,
            },
          });
        } catch (err: any) {
          const errType = classifyDifyError(err);
          const errMsg = err?.message || String(err);

          logger.warn(`Item ${item.id} failed (${errType}): ${errMsg}`);

          await item.update({
            status: 'failed',
            errorMessage: errMsg,
            completedAt: new Date(),
          });

          emitJobEvent(jobId, {
            type: 'item_complete',
            data: {
              taskId: task.id,
              itemId: item.id,
              itemIndex: item.itemIndex,
              input: item.input,
              actualOutput: null,
              status: 'failed',
              errorMessage: errMsg,
              category: task.benchmark,
            },
          });

          // If auth error, abort entire job (won't succeed for remaining items)
          if (errType === 'auth') {
            logger.error(`Auth failure for job ${jobId}, aborting remaining items`);
            await task.update({
              status: TASK_STATUS.FAILED,
              errorMessage: `Authentication failed: ${errMsg}`,
              samplesPassed: passed,
              completedAt: new Date(),
            });
            await job.update({ status: EVAL_STATUS.FAILED, completedAt: new Date() });
            emitJobEvent(jobId, { type: 'job_error', data: { jobId, error: errMsg } });
            return;
          }
        }

        // Update job-level item progress
        await job.increment('completedItems');
      }

      // Task complete
      const failedItems = items.length - passed;
      await task.update({
        status: failedItems === items.length ? TASK_STATUS.FAILED : TASK_STATUS.SUCCESS,
        samplesPassed: passed,
        samplesTotal: items.length,
        completedAt: new Date(),
      });

      await job.increment('completedTasks');

      emitJobEvent(jobId, {
        type: 'task_complete',
        data: {
          taskId: task.id,
          benchmark: task.benchmark,
          taskName: task.taskName,
          status: failedItems === items.length ? 'failed' : 'success',
          total: items.length,
          passed,
          failed: failedItems,
        },
      });
    }

    // Job complete
    if (jobState.cancelled) {
      await job.update({ status: EVAL_STATUS.FAILED, completedAt: new Date() });
    } else {
      await job.update({ status: EVAL_STATUS.COMPLETED, completedAt: new Date() });
    }

    emitJobEvent(jobId, {
      type: 'job_complete',
      data: { jobId, status: jobState.cancelled ? 'cancelled' : 'completed' },
    });

    logger.info(`Agent eval job ${jobId} completed`);
  } catch (err: any) {
    logger.error(`Agent eval job ${jobId} failed:`, err.message);

    try {
      await EvalJob.update(
        { status: EVAL_STATUS.FAILED, completedAt: new Date() },
        { where: { id: jobId } },
      );
    } catch {
      // ignore
    }

    emitJobEvent(jobId, {
      type: 'job_error',
      data: { jobId, error: err.message },
    });
  } finally {
    activeJobs.delete(jobId);
  }
}

/**
 * Cancel a running agent evaluation job.
 */
export async function cancelAgentJob(jobId: number): Promise<void> {
  const state = activeJobs.get(jobId);
  if (state) {
    state.cancelled = true;
    logger.info(`Agent eval job ${jobId} cancel requested`);
  }
}

/**
 * Check if a job is an agent-type evaluation (dify_chat or dify_workflow).
 */
export async function isAgentJob(jobId: number): Promise<boolean> {
  const job = await EvalJob.findByPk(jobId, {
    include: [{ model: Agent, as: 'agent', attributes: ['agentType'] }],
  });
  if (!job) return false;
  const agentType = (job as any).agent?.agentType;
  return agentType === 'dify_chat' || agentType === 'dify_workflow';
}
