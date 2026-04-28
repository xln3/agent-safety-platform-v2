/**
 * Tracks the currently-running EvalTask per EvalJob.
 *
 * Within a job, tasks run serially (TASK_CONCURRENCY=1), so at any moment
 * a job has at most one "active" task. The ts-bridge solver's HTTP callbacks
 * carry only the jobId — to attribute samples to the correct task, the
 * runner registers the active task before spawning inspect_ai and clears
 * it afterwards. The internal agent-runner controller reads from here.
 */

interface ActiveTask {
  taskId: number;
  benchmark: string;
  taskName: string;
}

const activeByJob: Map<number, ActiveTask> = new Map();

export function setActiveTask(jobId: number, task: ActiveTask): void {
  activeByJob.set(jobId, task);
}

export function getActiveTask(jobId: number): ActiveTask | undefined {
  return activeByJob.get(jobId);
}

export function clearActiveTask(jobId: number): void {
  activeByJob.delete(jobId);
}
