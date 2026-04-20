/**
 * Evaluation Runner Service
 *
 * Orchestrates evaluation jobs by directly spawning `inspect eval` for each
 * EvalTask. Provides concurrency control, process management, retry logic with
 * error classification, and result file discovery.
 *
 * This module is designed to be fire-and-forget from the controller's
 * perspective: `runJob()` kicks off work asynchronously and returns immediately.
 */

import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { Op } from 'sequelize';
import { Agent, EvalJob, EvalTask } from '../models';
import { EVAL_STATUS, TASK_STATUS } from '../constants';
import { config } from '../config';
import logger from '../utils/logger';
import { computeTaskScore } from './scoreService';
import catalogService from './catalogService';
import * as venvService from './venvService';
import { buildEnvironment } from './environmentBuilder';
import { buildInspectCommand, normalizeModelName } from './commandBuilder';
import { resolveIndexSampleIds } from './indexService';
import { dockerPreCleanup, cleanupDockerNetworks, ensureThorServer } from './dockerService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ErrorType =
  | 'AUTH_FAILURE'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT'
  | 'RESOURCE_EXHAUSTED'
  | 'CONTENT_FILTERED'
  | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of tasks processed in parallel per job. */
const DEFAULT_MAX_CONCURRENCY = 2;

/** Maximum retry attempts for retryable errors. */
const MAX_RETRIES = 2;

/** Per-task timeout in milliseconds (90 minutes — full-sample runs can be long). */
const TASK_TIMEOUT_MS = 90 * 60 * 1000;

/** Max connections passed to inspect_ai per task. */
const DEFAULT_MAX_CONNECTIONS = 16;

/** Maximum captured stdout/stderr size per subprocess (10 MB). Prevents OOM. */
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

/** Errors that should never be retried. */
const NON_RETRYABLE: Set<ErrorType> = new Set([
  'AUTH_FAILURE',
  'ACCESS_DENIED',
  'MODEL_NOT_FOUND',
]);

/** Errors eligible for retry. */
const RETRYABLE: Set<ErrorType> = new Set([
  'RATE_LIMITED',
  'TIMEOUT',
]);

// ---------------------------------------------------------------------------
// Process tracking
// ---------------------------------------------------------------------------

/**
 * Active child processes keyed by jobId.
 * Used by `cancelJob` to terminate running subprocesses.
 */
const runningProcesses: Map<string, ChildProcess[]> = new Map();

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function classifyError(message: string): ErrorType {
  const lower = message.toLowerCase();

  if (['401', 'unauthorized', 'authentication', 'invalid api key', 'invalid_api_key'].some(kw => lower.includes(kw))) {
    return 'AUTH_FAILURE';
  }
  if (['403', 'forbidden', 'access denied'].some(kw => lower.includes(kw))) {
    return 'ACCESS_DENIED';
  }
  if (['429', 'rate limit', 'rate_limit', 'too many requests', 'quota exceeded'].some(kw => lower.includes(kw))) {
    return 'RATE_LIMITED';
  }
  if (['404', 'model not found', 'model_not_found', 'no such model'].some(kw => lower.includes(kw))) {
    return 'MODEL_NOT_FOUND';
  }
  if (['connection refused', 'connect timeout', 'connection reset', 'name resolution', 'dns', 'ssl'].some(kw => lower.includes(kw))) {
    return 'CONNECTION_ERROR';
  }
  if (['timeout', 'timed out', 'deadline exceeded'].some(kw => lower.includes(kw))) {
    return 'TIMEOUT';
  }
  if (['out of memory', 'oom', 'resource exhausted', 'cuda out of memory'].some(kw => lower.includes(kw))) {
    return 'RESOURCE_EXHAUSTED';
  }
  if (['content filter', 'content_filter', 'safety filter', 'blocked by', 'content policy'].some(kw => lower.includes(kw))) {
    return 'CONTENT_FILTERED';
  }

  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Semaphore for concurrency control
// ---------------------------------------------------------------------------

class Semaphore {
  private current = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.waiting.shift();
    if (next) {
      next();
    }
  }
}

// ---------------------------------------------------------------------------
// Result file discovery
// ---------------------------------------------------------------------------

/**
 * Check if an .eval file is complete by verifying it contains header.json
 * with a terminal status (success/error/cancelled).
 */
function isEvalFileComplete(filePath: string): boolean {
  try {
    const zip = new AdmZip(filePath);
    const headerEntry = zip.getEntry('header.json');
    if (!headerEntry) {
      return false;
    }
    const header = JSON.parse(headerEntry.getData().toString('utf8'));
    // A complete eval file has a terminal status
    return ['success', 'error', 'cancelled'].includes(header.status);
  } catch {
    return false;
  }
}

/**
 * Find the most recent .eval file produced for a given model + task.
 *
 * Directory layout:
 *   results/{sanitized_model}/{benchmark}/logs/{timestamp}_{benchmark}_{hash}.eval
 *
 * The model name is sanitized (slashes replaced with underscores).
 * We search across all matching model directories and pick the newest
 * **complete** file (contains header.json with terminal status) whose
 * name contains the task name.
 *
 * @param afterMs  Only consider files modified after this epoch (ms).
 *                 Useful for recovery — skip stale files from earlier jobs.
 */
function findLatestEvalFile(
  modelId: string,
  benchmark: string,
  taskName: string,
  afterMs = 0,
): string | null {
  const resultsDir = config.resultsDir;
  if (!fs.existsSync(resultsDir)) {
    return null;
  }

  // Sanitize model names: "openai/gpt-4o" -> "openai_gpt-4o"
  const sanitizedModel = modelId.replace(/\//g, '_');
  // Also try the short form (after the slash) for broader matching
  const modelShort = modelId.includes('/') ? modelId.split('/').pop()! : modelId;

  let bestFile: string | null = null;
  let bestMtime = 0;

  let modelDirs: string[];
  try {
    modelDirs = fs.readdirSync(resultsDir);
  } catch {
    return null;
  }

  for (const modelDir of modelDirs) {
    const dirName = modelDir.trim();
    // Prefer exact match on sanitized model name; fall back to short name exact match
    if (dirName !== sanitizedModel && dirName !== modelShort) {
      continue;
    }

    const benchDir = path.join(resultsDir, modelDir, benchmark);
    const logsDir = path.join(benchDir, 'logs');
    if (!fs.existsSync(logsDir)) {
      continue;
    }

    let files: string[];
    try {
      files = fs.readdirSync(logsDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.eval')) {
        continue;
      }

      // Match task name in the filename. Task names use underscores;
      // filenames may use hyphens. Normalize both for comparison.
      // Use word-boundary regex to prevent cross-task false positives
      // (e.g. "saferag_sn" should not match a file for "saferag_sa").
      const fileNormalized = file.replace(/_/g, '-').toLowerCase();
      const taskNormalized = taskName.replace(/_/g, '-').toLowerCase();
      const benchNormalized = benchmark.replace(/_/g, '-').toLowerCase();

      const taskPattern = new RegExp(`(^|[^a-z0-9])${taskNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
      const benchPattern = new RegExp(`(^|[^a-z0-9])${benchNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);

      if (!taskPattern.test(fileNormalized) && !benchPattern.test(fileNormalized)) {
        continue;
      }

      const filePath = path.join(logsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > bestMtime && stat.mtimeMs > afterMs && isEvalFileComplete(filePath)) {
          bestMtime = stat.mtimeMs;
          bestFile = filePath;
        }
      } catch {
        continue;
      }
    }
  }

  return bestFile;
}

// ---------------------------------------------------------------------------
// Subprocess execution
// ---------------------------------------------------------------------------

/**
 * Spawn `inspect eval` directly for a single task.
 *
 * Replaces the old flow (spawn python3 run-eval.py) with direct invocation
 * of the venv's inspect binary + TS-built environment/command.
 */
function debugLog(msg: string) {
  fs.appendFileSync('/tmp/eval-debug.log', `[${new Date().toISOString()}] ${msg}\n`);
}

async function spawnTaskProcess(
  task: EvalTask,
  agent: Agent,
  job: EvalJob,
): Promise<{ proc: ChildProcess; done: Promise<{ exitCode: number; stderr: string; stdout: string }> }> {
  debugLog(`spawnTaskProcess START: ${task.benchmark}/${task.taskName}`);
  // 1. Load benchmark config from catalog
  const benchmarkConfig = catalogService.getBenchmarkConfig(task.benchmark);
  if (!benchmarkConfig) {
    throw new Error(`Benchmark '${task.benchmark}' not found in catalog`);
  }
  const catalogModels = catalogService.getModels();

  // 2. Ensure venv is ready
  debugLog(`setupBenchmarkEnv START: ${task.benchmark}`);
  await venvService.setupBenchmarkEnv(task.benchmark, {
    python: benchmarkConfig.python,
    extras: benchmarkConfig.extras,
    source: benchmarkConfig.source,
    module: benchmarkConfig.module,
  });
  debugLog(`setupBenchmarkEnv DONE: ${task.benchmark}`);

  // 3. Resolve task spec and path
  const taskInfo = benchmarkConfig.tasks.find((t) => t.name === task.taskName);
  const taskSpec = taskInfo?.path || (
    task.benchmark !== task.taskName
      ? `${benchmarkConfig.module}/${task.taskName}`
      : benchmarkConfig.module
  );
  // Merge model roles: benchmark-level then task-level override
  const mergedModelRoles = { ...benchmarkConfig.modelRoles };
  if (taskInfo?.taskArgs) {
    // task-level model_roles would be in catalog but we pass taskArgs via -T
  }

  // 4. Build environment variables
  const { env, effectiveJudge } = buildEnvironment({
    benchmarkName: task.benchmark,
    model: job.modelId,
    apiBase: agent.apiBase,
    apiKey: agent.apiKey,
    judgeModel: job.judgeModel,
    benchmarkConfig: {
      judge_model: benchmarkConfig.judgeModel,
      judge_param: benchmarkConfig.judgeParam,
    },
    catalogModels,
  });

  // Ensure results directory exists
  const resultsDir = env.INSPECT_LOG_DIR;
  fs.mkdirSync(resultsDir, { recursive: true });

  // 5. Resolve index/sampling
  const indexResult = resolveIndexSampleIds({
    benchmarkName: task.benchmark,
    taskName: task.taskName,
  });

  // 6. Build inspect eval command
  const inspectPath = venvService.getInspectPath(task.benchmark);
  const cmd = buildInspectCommand({
    inspectPath,
    taskSpec,
    modelForInspect: normalizeModelName(job.modelId),
    apiBase: agent.apiBase,
    limit: job.limit || undefined,
    effectiveJudge,
    judgeParam: benchmarkConfig.judgeParam,
    modelRoles: mergedModelRoles,
    taskArgs: taskInfo?.taskArgs as Record<string, unknown> | undefined,
    sampleIds: indexResult?.sampleIds,
    indexMode: indexResult?.mode,
    maxConnections: DEFAULT_MAX_CONNECTIONS,
    systemMessage: job.systemPrompt || undefined,
    catalogModels,
  });

  // 7. Docker lifecycle
  if (benchmarkConfig.needsDocker) {
    await dockerPreCleanup(task.benchmark, task.taskName);
  }
  if (task.benchmark === 'safeagentbench') {
    await ensureThorServer();
  }

  // 8. Spawn inspect eval directly
  debugLog(`Spawning: ${cmd.join(' ')}`);
  logger.debug(`Spawning: ${cmd.join(' ')}`);

  const proc = spawn(cmd[0], cmd.slice(1), {
    cwd: config.evalPocRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let stdout = '';
  let stderr = '';

  const done = new Promise<{ exitCode: number; stderr: string; stdout: string }>((resolve, reject) => {
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += text;
      }
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          logger.debug(`[${task.benchmark}/${task.taskName}] ${trimmed}`);
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += text;
      }
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          logger.warn(`[${task.benchmark}/${task.taskName}] stderr: ${trimmed}`);
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn process: ${err.message}`));
    });

    proc.on('close', (code) => {
      // Docker post-cleanup (best-effort)
      if (benchmarkConfig.needsDocker) {
        cleanupDockerNetworks().catch(() => {});
      }
      resolve({ exitCode: code ?? 1, stderr, stdout });
    });
  });

  return { proc, done };
}

// ---------------------------------------------------------------------------
// Single task execution with retry
// ---------------------------------------------------------------------------

async function executeTask(
  task: EvalTask,
  agent: Agent,
  job: EvalJob,
  jobId: string,
): Promise<void> {
  debugLog(`executeTask START: ${task.benchmark}/${task.taskName}`);
  await task.update({
    status: TASK_STATUS.RUNNING,
    startedAt: new Date(),
  });

  let lastError: string | null = null;
  let lastErrorType: ErrorType = 'UNKNOWN';

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      lastError = null;
      await runTaskAttempt(task, agent, job, jobId);
      // Success — discover result file and compute scores
      const evalFile = findLatestEvalFile(job.modelId, task.benchmark, task.taskName);
      if (evalFile) {
        await task.update({ evalFile });
        try {
          await computeTaskScore(task.id, evalFile);
        } catch (scoreErr: any) {
          logger.warn(
            `Score computation failed for task ${task.benchmark}/${task.taskName}: ${scoreErr.message}`,
          );
        }
      } else {
        logger.warn(
          `No .eval result file found for ${task.benchmark}/${task.taskName}`,
        );
      }

      await task.update({
        status: TASK_STATUS.SUCCESS,
        completedAt: new Date(),
      });
      return;
    } catch (err: any) {
      lastError = err.message || String(err);
      lastErrorType = classifyError(lastError as string);

      logger.warn(
        `Task ${task.benchmark}/${task.taskName} attempt ${attempt}/${MAX_RETRIES + 1} failed [${lastErrorType}]: ${truncateError(lastError as string)}`,
      );

      // Non-retryable errors: stop immediately
      if (NON_RETRYABLE.has(lastErrorType)) {
        logger.info(
          `Task ${task.benchmark}/${task.taskName}: non-retryable error (${lastErrorType}), skipping remaining retries`,
        );
        break;
      }

      // Only retry for explicitly retryable errors
      if (!RETRYABLE.has(lastErrorType)) {
        break;
      }

      // Exponential backoff before retry: 2s, 4s
      if (attempt <= MAX_RETRIES) {
        const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 16000);
        logger.info(
          `Retrying task ${task.benchmark}/${task.taskName} in ${delayMs}ms...`,
        );
        await sleep(delayMs);
      }
    }
  }

  // All attempts exhausted — mark as failed
  await task.update({
    status: TASK_STATUS.FAILED,
    errorMessage: lastError ? `[${lastErrorType}] ${truncateError(lastError)}` : 'Unknown error',
    completedAt: new Date(),
  });
}

/**
 * Run a single attempt of a task (spawn process, wait with timeout).
 */
async function runTaskAttempt(
  task: EvalTask,
  agent: Agent,
  job: EvalJob,
  jobId: string,
): Promise<void> {
  const { proc, done } = await spawnTaskProcess(task, agent, job);

  // Track the process for cancellation
  const procs = runningProcesses.get(jobId);
  if (procs) {
    procs.push(proc);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Race the subprocess against the timeout
    const result = await Promise.race([
      done,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          killProcess(proc);
          reject(new Error(
            `Task ${task.benchmark}/${task.taskName} timed out after ${TASK_TIMEOUT_MS / 1000}s`,
          ));
        }, TASK_TIMEOUT_MS);
      }),
    ]);

    if (result.exitCode !== 0) {
      const errorOutput = result.stderr || result.stdout;
      const errorMsg = errorOutput
        ? truncateError(errorOutput)
        : `Process exited with code ${result.exitCode}`;
      throw new Error(errorMsg);
    }
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    // Remove process from tracking
    const tracked = runningProcesses.get(jobId);
    if (tracked) {
      const idx = tracked.indexOf(proc);
      if (idx !== -1) {
        tracked.splice(idx, 1);
      }
    }
    // Safety net: ensure process is dead
    killProcess(proc);
  }
}

// ---------------------------------------------------------------------------
// Job orchestration
// ---------------------------------------------------------------------------

/**
 * Query the database for the number of completed (success or failed) tasks
 * belonging to a job. Using a live DB count avoids any potential
 * inconsistency from an in-memory counter modified across awaits.
 */
async function getCompletedCount(jobId: number): Promise<number> {
  return EvalTask.count({
    where: {
      jobId,
      status: { [Op.in]: [TASK_STATUS.SUCCESS, TASK_STATUS.FAILED] },
    },
  });
}

/**
 * Run an evaluation job. This function is designed to be called fire-and-forget:
 * it starts processing asynchronously and does not block the caller.
 *
 * @param jobId - The ID of the EvalJob to run (numeric, but passed as string
 *   for Map key compatibility).
 */
export async function runJob(jobId: number): Promise<void> {
  // Load the job with its associated agent
  const job = await EvalJob.findByPk(jobId, {
    include: [{ model: Agent, as: 'agent' }],
  });

  if (!job) {
    logger.error(`runJob: Job not found: ${jobId}`);
    return;
  }

  const agent = (job as any).agent as Agent | undefined;
  if (!agent) {
    logger.error(`runJob: Agent not found for job ${jobId}`);
    await job.update({
      status: EVAL_STATUS.FAILED,
      completedAt: new Date(),
    });
    return;
  }

  // Bind non-null references so closures below don't lose type narrowing
  const theJob: EvalJob = job;
  const theAgent: Agent = agent;

  logger.info(`Starting eval job ${jobId} (agent=${theAgent.name}, model=${theJob.modelId})`);

  // Mark job as running
  await theJob.update({
    status: EVAL_STATUS.RUNNING,
    startedAt: new Date(),
  });

  // Fetch all tasks for this job
  const tasks = await EvalTask.findAll({
    where: { jobId },
    order: [['benchmark', 'ASC'], ['taskName', 'ASC']],
  });

  if (tasks.length === 0) {
    logger.warn(`runJob: No tasks found for job ${jobId}`);
    await theJob.update({
      status: EVAL_STATUS.COMPLETED,
      completedAt: new Date(),
    });
    return;
  }

  // Initialize process tracking for this job
  const jobIdStr = String(jobId);
  runningProcesses.set(jobIdStr, []);

  const sem = new Semaphore(DEFAULT_MAX_CONCURRENCY);
  let hasFailure = false;

  /**
   * Process a single task within the concurrency semaphore.
   */
  async function processTask(task: EvalTask): Promise<void> {
    await sem.acquire();
    try {
      // Check if the job was cancelled while waiting for the semaphore
      const currentJob = await EvalJob.findByPk(jobId);
      if (!currentJob || currentJob.status === EVAL_STATUS.FAILED) {
        logger.info(`Job ${jobId} was cancelled, skipping task ${task.benchmark}/${task.taskName}`);
        return;
      }

      await executeTask(task, theAgent, theJob, jobIdStr);

      if (task.status === TASK_STATUS.FAILED) {
        hasFailure = true;
      }
    } catch (err: any) {
      // Unexpected error in the orchestration layer itself
      hasFailure = true;
      logger.error(
        `Unexpected error processing task ${task.benchmark}/${task.taskName}: ${err.message}`,
      );
      await task.update({
        status: TASK_STATUS.FAILED,
        errorMessage: `Internal error: ${err.message}`,
        completedAt: new Date(),
      }).catch(() => {});
    } finally {
      const completed = await getCompletedCount(jobId);
      await theJob.update({ completedTasks: completed }).catch(() => {});
      logger.info(
        `Task finished: ${task.benchmark}/${task.taskName} [${task.status}] (${completed}/${tasks.length})`,
      );
      sem.release();
    }
  }

  // Launch all tasks — the semaphore limits actual concurrency
  try {
    await Promise.all(tasks.map((task) => processTask(task)));
  } catch (err: any) {
    logger.error(`runJob: Unexpected error in job ${jobId}: ${err.message}`);
    hasFailure = true;
  }

  // Update final job status
  const finalCompleted = await getCompletedCount(jobId);
  await theJob.update({
    status: hasFailure ? EVAL_STATUS.FAILED : EVAL_STATUS.COMPLETED,
    completedAt: new Date(),
    completedTasks: finalCompleted,
  });

  // Clean up process tracking
  runningProcesses.delete(jobIdStr);

  logger.info(
    `Eval job finished: ${jobId}, status=${hasFailure ? 'failed' : 'completed'}, ` +
    `completed=${finalCompleted}/${tasks.length}`,
  );
}

// ---------------------------------------------------------------------------
// Job cancellation
// ---------------------------------------------------------------------------

/**
 * Cancel a running job by killing all its child processes and updating statuses.
 */
export async function cancelJob(jobId: number): Promise<boolean> {
  const jobIdStr = String(jobId);
  const procs = runningProcesses.get(jobIdStr);

  if (procs && procs.length > 0) {
    logger.info(`Cancelling job ${jobId}: killing ${procs.length} subprocess(es)`);
    for (const proc of procs) {
      killProcess(proc);
    }
    runningProcesses.delete(jobIdStr);
  }

  // Update the job status in the database
  const job = await EvalJob.findByPk(jobId);
  if (!job) {
    return false;
  }

  if (job.status !== EVAL_STATUS.RUNNING && job.status !== EVAL_STATUS.PENDING) {
    return false;
  }

  await job.update({
    status: EVAL_STATUS.FAILED,
    completedAt: new Date(),
  });

  // Mark all pending/running tasks as failed
  await EvalTask.update(
    {
      status: TASK_STATUS.FAILED,
      errorMessage: 'Cancelled by user',
      completedAt: new Date(),
    },
    {
      where: {
        jobId,
        status: [TASK_STATUS.PENDING, TASK_STATUS.RUNNING],
      },
    },
  );

  logger.info(`Cancelled job ${jobId}`);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Kill a child process and its entire process group.
 * Sends SIGTERM first, then SIGKILL after a short grace period.
 */
function killProcess(proc: ChildProcess): void {
  if (proc.killed || proc.exitCode !== null) {
    return;
  }

  const pid = proc.pid;
  if (pid === undefined) {
    return;
  }

  // SIGTERM to the process group (negative pid targets the group since we
  // spawned with detached: true)
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Process already dead — ignore
  }

  // Force-kill after 3 seconds if still alive
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already dead
    }
    try {
      proc.kill('SIGKILL');
    } catch {
      // Already dead
    }
  }, 3000);
}

/**
 * Truncate an error message to a reasonable length for storage.
 * Keeps the beginning (where the root cause usually is) and the end (context).
 */
function truncateError(message: string, maxLength = 800): string {
  if (message.length <= maxLength) {
    return message;
  }
  const half = Math.floor(maxLength / 2);
  return message.slice(0, half) + '\n...[truncated]...\n' + message.slice(-half);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Job recovery (handles server restart while jobs are in-flight)
// ---------------------------------------------------------------------------

/**
 * Recover jobs that were in "running" state when the server restarted.
 *
 * For each task still marked "running":
 *   - If a complete .eval file exists → compute scores, mark as success
 *   - Otherwise → mark as failed (orphaned process)
 *
 * For each task still "pending":
 *   - Re-execute them (the job orchestration continues)
 *
 * After processing all tasks, update the job's final status.
 */
export async function recoverJobs(): Promise<void> {
  const stuckJobs = await EvalJob.findAll({
    where: { status: EVAL_STATUS.RUNNING },
    include: [{ model: Agent, as: 'agent' }],
  });

  if (stuckJobs.length === 0) {
    return;
  }

  debugLog(`recoverJobs: Found ${stuckJobs.length} stuck job(s)`);
  logger.info(`recoverJobs: Found ${stuckJobs.length} stuck job(s), attempting recovery...`);

  for (const job of stuckJobs) {
    const agent = (job as any).agent as Agent | undefined;
    if (!agent) {
      logger.warn(`recoverJobs: No agent for job ${job.id}, marking as failed`);
      await job.update({ status: EVAL_STATUS.FAILED, completedAt: new Date() });
      continue;
    }

    const tasks = await EvalTask.findAll({ where: { jobId: job.id } });
    let hasFailure = false;
    const pendingTasks: EvalTask[] = [];

    // Phase 1: recover tasks that were "running" (process may have finished)
    for (const task of tasks) {
      if (task.status === TASK_STATUS.SUCCESS) {
        continue;
      }

      if (task.status === TASK_STATUS.FAILED) {
        hasFailure = true;
        continue;
      }

      if (task.status === TASK_STATUS.RUNNING) {
        // Try to find a completed .eval file created after this task started
        const afterMs = task.startedAt ? new Date(task.startedAt).getTime() : 0;
        const evalFile = findLatestEvalFile(job.modelId, task.benchmark, task.taskName, afterMs);
        if (evalFile) {
          logger.info(`recoverJobs: Found completed eval file for ${task.benchmark}/${task.taskName}`);
          await task.update({ evalFile });
          try {
            await computeTaskScore(task.id, evalFile);
          } catch (scoreErr: any) {
            logger.warn(`recoverJobs: Score computation failed for ${task.benchmark}/${task.taskName}: ${scoreErr.message}`);
          }
          await task.update({ status: TASK_STATUS.SUCCESS, completedAt: new Date() });
        } else {
          // No complete file — re-queue for execution
          logger.info(`recoverJobs: No completed eval file for ${task.benchmark}/${task.taskName}, re-queuing`);
          await task.update({ status: TASK_STATUS.PENDING, startedAt: null });
          pendingTasks.push(task);
        }
        continue;
      }

      if (task.status === TASK_STATUS.PENDING) {
        pendingTasks.push(task);
      }
    }

    // Phase 2: re-run pending tasks
    if (pendingTasks.length > 0) {
      logger.info(`recoverJobs: Re-running ${pendingTasks.length} pending task(s) for job ${job.id}`);

      const jobIdStr = String(job.id);
      runningProcesses.set(jobIdStr, []);
      const sem = new Semaphore(DEFAULT_MAX_CONCURRENCY);

      const runPending = async (task: EvalTask) => {
        await sem.acquire();
        try {
          await executeTask(task, agent, job, jobIdStr);
          if (task.status === TASK_STATUS.FAILED) {
            hasFailure = true;
          }
        } catch (err: any) {
          hasFailure = true;
          logger.error(`recoverJobs: Error running ${task.benchmark}/${task.taskName}: ${err.message}`);
          await task.update({
            status: TASK_STATUS.FAILED,
            errorMessage: `Recovery error: ${err.message}`,
            completedAt: new Date(),
          }).catch(() => {});
        } finally {
          const completed = await getCompletedCount(job.id);
          await job.update({ completedTasks: completed }).catch(() => {});
          sem.release();
        }
      };

      try {
        await Promise.all(pendingTasks.map(runPending));
      } catch (err: any) {
        logger.error(`recoverJobs: Unexpected error in job ${job.id}: ${err.message}`);
        hasFailure = true;
      }

      runningProcesses.delete(jobIdStr);
    }

    // Phase 3: finalize job status
    const recoveredCount = await getCompletedCount(job.id);
    await job.update({
      status: hasFailure ? EVAL_STATUS.FAILED : EVAL_STATUS.COMPLETED,
      completedAt: new Date(),
      completedTasks: recoveredCount,
    });

    logger.info(
      `recoverJobs: Job ${job.id} recovered — status=${hasFailure ? 'failed' : 'completed'}, ` +
      `completed=${recoveredCount}/${tasks.length}`,
    );
  }
}

export default { runJob, cancelJob, recoverJobs };
