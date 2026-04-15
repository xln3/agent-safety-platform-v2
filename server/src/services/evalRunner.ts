/**
 * Evaluation Runner Service
 *
 * Orchestrates evaluation jobs by spawning `run-eval.py` subprocesses for each
 * EvalTask. Provides concurrency control, process management, retry logic with
 * error classification, and result file discovery.
 *
 * This module is designed to be fire-and-forget from the controller's
 * perspective: `runJob()` kicks off work asynchronously and returns immediately.
 */

import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { Agent, EvalJob, EvalTask } from '../models';
import { EVAL_STATUS, TASK_STATUS } from '../constants';
import { config } from '../config';
import logger from '../utils/logger';
import { computeTaskScore } from './scoreService';

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

/** Per-task timeout in milliseconds (30 minutes). */
const TASK_TIMEOUT_MS = 30 * 60 * 1000;

/** Max connections passed to inspect_ai per task. */
const DEFAULT_MAX_CONNECTIONS = 16;

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
 * Find the most recent .eval file produced for a given model + task.
 *
 * Directory layout created by run-eval.py:
 *   results/{sanitized_model}/{benchmark}/logs/{timestamp}_{benchmark}_{hash}.eval
 *
 * The model name is sanitized (slashes replaced with underscores) by run-eval.py.
 * We search across all matching model directories and pick the newest file whose
 * name contains the task name.
 */
function findLatestEvalFile(modelId: string, benchmark: string, taskName: string): string | null {
  const resultsDir = config.resultsDir;
  if (!fs.existsSync(resultsDir)) {
    return null;
  }

  // run-eval.py sanitizes model names: "openai/gpt-4o" -> "openai_gpt-4o"
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
    // Match if directory name contains the sanitized model or short name
    if (!dirName.includes(sanitizedModel) && !dirName.includes(modelShort) &&
        !sanitizedModel.includes(dirName) && !modelShort.includes(dirName)) {
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
      const fileNormalized = file.replace(/_/g, '-').toLowerCase();
      const taskNormalized = taskName.replace(/_/g, '-').toLowerCase();
      const benchNormalized = benchmark.replace(/_/g, '-').toLowerCase();

      if (!fileNormalized.includes(taskNormalized) && !fileNormalized.includes(benchNormalized)) {
        continue;
      }

      const filePath = path.join(logsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > bestMtime) {
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
 * Spawn run-eval.py for a single task and return a promise that resolves when
 * the process exits. Collects stdout/stderr for error reporting.
 */
function spawnTaskProcess(
  task: EvalTask,
  agent: Agent,
  job: EvalJob,
): { proc: ChildProcess; done: Promise<{ exitCode: number; stderr: string; stdout: string }> } {
  const runEvalScript = path.join(config.evalPocRoot, 'run-eval.py');

  // Build the task spec: "benchmark:taskName" (or just benchmark if they match)
  const taskSpec = task.benchmark !== task.taskName
    ? `${task.benchmark}:${task.taskName}`
    : task.benchmark;

  // Build CLI arguments
  const args: string[] = [
    runEvalScript,
    taskSpec,
    '--model', job.modelId,
    '--api-base', agent.apiBase,
    '--api-key', agent.apiKey,
    '--max-connections', String(DEFAULT_MAX_CONNECTIONS),
  ];

  if (job.limit) {
    args.push('--limit', String(job.limit));
  }
  if (job.judgeModel) {
    args.push('--judge-model', job.judgeModel);
  }
  if (job.systemPrompt) {
    args.push('--system-message', job.systemPrompt);
  }

  logger.debug(`Spawning: ${config.pythonPath} ${args.join(' ')}`);

  const proc = spawn(config.pythonPath, args, {
    cwd: config.evalPocRoot,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Create a new process group so we can kill the tree on cancel
    detached: true,
  });

  let stdout = '';
  let stderr = '';

  const done = new Promise<{ exitCode: number; stderr: string; stdout: string }>((resolve, reject) => {
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      // Log subprocess output line by line
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          logger.debug(`[${task.benchmark}/${task.taskName}] ${trimmed}`);
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
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
  const { proc, done } = spawnTaskProcess(task, agent, job);

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
  let completedCount = 0;
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
      completedCount++;
      await theJob.update({ completedTasks: completedCount }).catch(() => {});
      logger.info(
        `Task finished: ${task.benchmark}/${task.taskName} [${task.status}] (${completedCount}/${tasks.length})`,
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
  await theJob.update({
    status: hasFailure ? EVAL_STATUS.FAILED : EVAL_STATUS.COMPLETED,
    completedAt: new Date(),
    completedTasks: completedCount,
  });

  // Clean up process tracking
  runningProcesses.delete(jobIdStr);

  logger.info(
    `Eval job finished: ${jobId}, status=${hasFailure ? 'failed' : 'completed'}, ` +
    `completed=${completedCount}/${tasks.length}`,
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

export default { runJob, cancelJob };
