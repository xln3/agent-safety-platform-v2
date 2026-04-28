import api from './api';
import type { PaginatedResult } from './agentService';

/* ------------------------------------------------------------------ */
/*  Benchmark & Task-meta types (new inspect_ai-based API)            */
/* ------------------------------------------------------------------ */

export interface BenchmarkInfo {
  name: string;
  category: string;
  description?: string;
  taskCount?: number;
  /**
   * Catalog-declared judge model. When non-empty the benchmark needs a runtime
   * judge to score (e.g. agentharm, safeagentbench). The frontend uses this
   * flag to mark the judge field required at submit time, mirroring the
   * backend evalController gate that 400s a missing-judge submission.
   */
  judgeModel?: string | null;
}

export interface TaskMeta {
  name: string;
  description?: string;
  category?: string;
}

/* ------------------------------------------------------------------ */
/*  Eval Job types                                                     */
/* ------------------------------------------------------------------ */

export interface EvalJob {
  id: number;
  name?: string;
  agentId: number;
  modelId?: string;
  benchmarks?: string[];
  limit?: number | null;
  judgeModel?: string | null;
  dataMode?: string;
  sampleCount?: number | null;
  totalItems?: number;
  completedItems?: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalTasks: number;
  completedTasks: number;
  config?: Record<string, unknown>;
  agent?: { id: number; name: string; modelId: string; agentType?: string; apiBase?: string };
  tasks?: EvalTask[];
  createdAt?: string;
  updatedAt?: string;
}

export interface EvalTask {
  id: number;
  jobId: number;
  agentId?: number;
  benchmark: string;
  taskName: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  evalFile?: string | null;
  rawScore?: number | null;
  safetyScore?: number | null;
  score?: number | null;
  riskLevel?: string | null;
  interpretation?: string | null;
  samplesTotal: number;
  samplesPassed: number;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/* ------------------------------------------------------------------ */
/*  Result types — match backend resultController responses           */
/* ------------------------------------------------------------------ */

/** GET /api/results/by-job/:jobId */
export interface JobResultData {
  job: EvalJob;
  tasks: TaskResultItem[];
  aggregate: {
    overallSafetyScore: number | null;
    scoredTaskCount: number;
    failedTaskCount: number;
    totalTaskCount: number;
    /** Fraction in [0,1] of tasks that produced a score. */
    coverage: number;
    /** 'sufficient' (>=80% scored), 'insufficient' (<80% scored), 'no_data' (0 scored). */
    aggregateStatus: 'sufficient' | 'insufficient' | 'no_data';
    riskDistribution: Record<string, number>;
  };
  /** Per-category / per-dimension qualitative assessment (Q2 Layer 2). May be empty when dimensions.yaml has no coverage. */
  assessment?: DimensionsAssessment;
}

export type AssessmentTier = 'good' | 'watch' | 'action' | 'unknown';

export interface AggregatedDimension {
  id: string;
  title: string;
  score: number | null;
  tier: AssessmentTier;
  recommendation: string;
  contributing: { benchmark: string; taskName: string; safetyScore: number | null }[];
}

export interface AggregatedCategory {
  id: string;
  title: string;
  description?: string;
  score: number | null;
  tier: AssessmentTier;
  dimensions: AggregatedDimension[];
}

export interface DimensionsAssessment {
  categories: AggregatedCategory[];
  recommendations: { categoryId: string; dimensionId: string; tier: AssessmentTier; text: string }[];
  unmatched: { benchmark: string; taskName: string }[];
}

export interface TaskResultItem {
  id: number;
  benchmark: string;
  taskName: string;
  status: string;
  safetyScore: number | null;
  riskLevel: string | null;
  rawScore: number | null;
  interpretation: string | null;
  samplesTotal: number;
  samplesPassed: number;
  errorMessage: string | null;
}

/** GET /api/results/by-job/:jobId/tasks/:taskId/samples */
export interface SamplesResponseData {
  task: { id: number; benchmark: string; taskName: string };
  samples: SampleItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface SampleItem {
  id: string;
  input: string;
  target?: string;
  output: string;
  score: number | null;
  metadata?: Record<string, any>;
}

/* ------------------------------------------------------------------ */
/*  Category type (for EvalCategoryCard, etc.)                         */
/* ------------------------------------------------------------------ */

export interface EvalCategory {
  id: string;
  name: string;
  description: string;
  icon?: string;
  priority?: number;
  taskCount?: number;
}

/* ------------------------------------------------------------------ */
/*  Create-job payload                                                 */
/* ------------------------------------------------------------------ */

export interface CreateJobPayload {
  agentId: number;
  benchmarks: string[];
  limit?: number;
  /** Legacy free-text judge model name (kept for backwards-compat on older flows). */
  judgeModel?: string;
  /** ID of a JudgeModel DB row — preferred over the legacy string. */
  judgeModelId?: number;
  systemPrompt?: string;
}

/* ------------------------------------------------------------------ */
/*  EvalItem (per-sample) types                                        */
/* ------------------------------------------------------------------ */

export interface EvalItemToolCall {
  id?: string;
  name: string;
  arguments: string;
  result?: string;
  metadata?: Record<string, any>;
}

export interface EvalItem {
  id: number;
  jobId: number;
  taskId: number;
  benchmark: string;
  sampleId: string;
  inputJson: any;
  outputText: string | null;
  score: number | null;
  scoreLabel: string | null;
  judgeRationale: string | null;
  status: 'pending' | 'running' | 'success' | 'failed';
  errorMessage: string | null;
  retryCount: number;
  latencyMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** OpenAI-style tool_calls captured from the agent's run, when any. */
  toolCallsJson: EvalItemToolCall[] | null;
}

/* ------------------------------------------------------------------ */
/*  SSE event types                                                    */
/* ------------------------------------------------------------------ */

export type SseEventName =
  | 'snapshot'
  | 'job.start'
  | 'job.finish'
  | 'task.start'
  | 'task.finish'
  | 'sample.start'
  | 'sample.finish'
  | 'heartbeat';

export interface SseHandlers {
  onSnapshot?: (data: any) => void;
  onJobStart?: (data: any) => void;
  onJobFinish?: (data: any) => void;
  onTaskStart?: (data: any) => void;
  onTaskFinish?: (data: any) => void;
  onSampleStart?: (data: any) => void;
  onSampleFinish?: (data: any) => void;
  onError?: (err: Event) => void;
}

/**
 * Open an SSE connection to the job stream. Returns the underlying EventSource
 * so the caller can `.close()` it. The vite dev proxy forwards `/api/...` to
 * the backend so we use a relative URL.
 */
function openJobStream(jobId: number, handlers: SseHandlers): EventSource {
  const es = new EventSource(`/api/eval/jobs/${jobId}/stream`);

  const wrap = (cb?: (d: any) => void) => (e: MessageEvent) => {
    if (!cb) return;
    try {
      cb(JSON.parse(e.data));
    } catch {
      cb(e.data);
    }
  };

  es.addEventListener('snapshot', wrap(handlers.onSnapshot) as EventListener);
  es.addEventListener('job.start', wrap(handlers.onJobStart) as EventListener);
  es.addEventListener('job.finish', wrap(handlers.onJobFinish) as EventListener);
  es.addEventListener('task.start', wrap(handlers.onTaskStart) as EventListener);
  es.addEventListener('task.finish', wrap(handlers.onTaskFinish) as EventListener);
  es.addEventListener('sample.start', wrap(handlers.onSampleStart) as EventListener);
  es.addEventListener('sample.finish', wrap(handlers.onSampleFinish) as EventListener);
  // heartbeat events are intentionally ignored — they only keep the connection alive
  es.onerror = (err) => {
    handlers.onError?.(err);
  };

  return es;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

export const evalService = {
  /* ---------- Benchmark APIs ---------- */

  getBenchmarks: () =>
    api.get<unknown, BenchmarkInfo[]>('/api/benchmarks'),

  getBenchmarksByCategory: (category: string) =>
    api.get<unknown, BenchmarkInfo[]>(`/api/benchmarks/by-category/${encodeURIComponent(category)}`),

  getTaskMeta: () =>
    api.get<unknown, Record<string, TaskMeta>>('/api/benchmarks/task-meta'),

  /* ---------- Job APIs ---------- */

  createJob: (data: CreateJobPayload) =>
    api.post<unknown, EvalJob>('/api/eval/jobs', data),

  listJobs: (params?: { agentId?: number; page?: number; pageSize?: number; status?: string }) =>
    api.get<unknown, PaginatedResult<EvalJob>>('/api/eval/jobs', { params }),

  getJob: (id: number) =>
    api.get<unknown, EvalJob>(`/api/eval/jobs/${id}`),

  deleteJob: (id: number) =>
    api.delete<unknown, void>(`/api/eval/jobs/${id}`),

  /* ---------- Result APIs ---------- */

  getJobResults: (jobId: number) =>
    api.get<unknown, JobResultData>(`/api/results/by-job/${jobId}`),

  getTaskSamples: (jobId: number, taskId: number, params?: { page?: number; pageSize?: number }) =>
    api.get<unknown, SamplesResponseData>(
      `/api/results/by-job/${jobId}/tasks/${taskId}/samples`,
      { params },
    ),

  /* ---------- Category API ---------- */

  getCategories: () =>
    api.get<unknown, EvalCategory[]>('/api/eval/categories'),

  /* ---------- Per-sample item API ---------- */

  listJobItems: (jobId: number, params?: { page?: number; pageSize?: number; taskId?: number; status?: string }) =>
    api.get<unknown, PaginatedResult<EvalItem>>(`/api/eval/jobs/${jobId}/items`, { params }),

  getJobItem: (jobId: number, itemId: number) =>
    api.get<unknown, EvalItem>(`/api/eval/jobs/${jobId}/items/${itemId}`),

  /* ---------- SSE stream ---------- */

  openJobStream,

};
