/**
 * Stale-job watchdog.
 *
 * recoverJobs() in evalRunner.ts only fires at server startup, so a job whose
 * subprocess silently exits (or whose ts-bridge callback dries up while the
 * inspect_ai loop is still nominally alive) sits in `status=running` forever
 * with no progress. The 2026-04-28 audit caught one such case (job 41,
 * running 8h+ since 03:04, 56% completion frozen) — UI showed no signal that
 * progress had stopped.
 *
 * The watchdog runs in the same Node process every CHECK_INTERVAL_MS, looks
 * for jobs that are still `running` but whose row hasn't been updated in
 * STALE_THRESHOLD_MS, and marks them `failed` with a `[STALE]` error message
 * so the UI shows "评估失败 — 长时间无进度" instead of an indefinite spinner.
 *
 * Threshold rationale: even the slowest local benchmarks (mssbench, osworld
 * with 2h task_timeout) update task progress at sample granularity, so 30min
 * with no DB write reliably signals a stuck loop / dead subprocess.
 */

import { Op } from 'sequelize';
import { EvalJob, EvalTask } from '../models';
import { EVAL_STATUS } from '../constants';
import sseService from './sseService';
import logger from '../utils/logger';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function checkOnce(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const stale = await EvalJob.findAll({
    where: {
      status: EVAL_STATUS.RUNNING,
      updatedAt: { [Op.lt]: cutoff },
    },
  });
  if (stale.length === 0) return;

  for (const job of stale) {
    // Double-check: are any of the job's tasks still actively writing? If a
    // task row updated more recently than the job, the job's updatedAt is
    // just slow to propagate — skip it. Only the truly silent ones get reaped.
    const lastTaskUpdate = await EvalTask.max<Date, EvalTask>('updatedAt', {
      where: { jobId: job.id },
    });
    const taskFresh = lastTaskUpdate && new Date(lastTaskUpdate).getTime() > cutoff.getTime();
    if (taskFresh) continue;

    const ageMin = Math.round((Date.now() - new Date(job.updatedAt).getTime()) / 60000);
    const errorMessage = `[STALE] 长时间无进度（${ageMin} 分钟未更新），自动判定失败`;
    logger.warn(`Watchdog reaping stale job ${job.id} (${ageMin}min idle)`);

    // EvalJob has no errorMessage column; the reason lives on per-task rows
    // and on the SSE payload below — that matches how evalRunner already
    // signals job-level failure.
    await job.update({
      status: EVAL_STATUS.FAILED,
      completedAt: new Date(),
    });

    // Mark any still-running tasks failed too so the per-task UI doesn't
    // misleadingly show a green spinner under a failed job.
    await EvalTask.update(
      { status: EVAL_STATUS.FAILED, errorMessage },
      {
        where: {
          jobId: job.id,
          status: { [Op.in]: [EVAL_STATUS.RUNNING, EVAL_STATUS.PENDING] },
        },
      },
    );

    sseService.emit(job.id, 'job.finish', {
      jobId: job.id,
      status: EVAL_STATUS.FAILED,
      errorMessage,
      reason: 'stale',
    });
  }
}

export function startWatchdog(): void {
  if (timer) return;
  // Fire once shortly after startup so existing stale jobs (those that survived
  // recoverJobs because they weren't running at restart) get reaped quickly.
  setTimeout(() => {
    checkOnce().catch((err) => logger.error('Watchdog initial check failed:', err.message));
  }, 30 * 1000);
  timer = setInterval(() => {
    checkOnce().catch((err) => logger.error('Watchdog tick failed:', err.message));
  }, CHECK_INTERVAL_MS);
  logger.info(
    `Job watchdog started (check every ${CHECK_INTERVAL_MS / 60000}min, stale=${STALE_THRESHOLD_MS / 60000}min)`,
  );
}

export function stopWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
