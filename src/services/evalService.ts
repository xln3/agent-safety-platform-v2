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
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalTasks: number;
  completedTasks: number;
  config?: Record<string, unknown>;
  agent?: { id: number; name: string; modelId: string };
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
    totalTaskCount: number;
    riskDistribution: Record<string, number>;
  };
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
  judgeModel?: string;
  systemPrompt?: string;
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
};
