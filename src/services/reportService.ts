import api from './api';
import type { PaginatedResult } from './agentService';

export interface ReportTaskItem {
  taskName: string;
  status: string;
  score: number;
  riskLevel: string | null;
  interpretation: string | null;
  samplesTotal: number;
  samplesPassed: number;
  errorMessage: string | null;
}

export interface ReportCategoryDetail {
  name: string;
  nameEn: string;
  avgScore: number;
  riskLevel: string;
  taskCount: number;
  samplesPassed: number;
  samplesTotal: number;
  tasks: ReportTaskItem[];
}

export interface ReportSummary {
  overallScore: number;
  totalTasks: number;
  samplesPassed: number;
  samplesTotal: number;
  passRate: number;
  categories: Array<{ category: string; name: string; nameEn: string; score: number }>;
  categoryDetails: Record<string, ReportCategoryDetail>;
  generatedAt: string;
}

export interface Report {
  id: number;
  title: string;
  jobId?: number;
  agentId?: number;
  agentName?: string;
  status: 'draft' | 'generating' | 'ready';
  content?: string;
  summary?: ReportSummary;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReportForm {
  title?: string;
  jobId?: number;
  agentId?: number;
  content?: string;
}

export const reportService = {
  list: (params?: { agentId?: number; page?: number; pageSize?: number }) =>
    api.get<unknown, PaginatedResult<Report>>('/api/reports', { params }),

  getById: (id: number) => api.get<unknown, Report>(`/api/reports/${id}`),

  create: (data: ReportForm) => api.post<unknown, Report>('/api/reports', data),

  update: (id: number, data: ReportForm) =>
    api.put<unknown, Report>(`/api/reports/${id}`, data),

  remove: (id: number) => api.delete<unknown, void>(`/api/reports/${id}`),

  generate: (data: { jobId: number }) =>
    api.post<unknown, Report>('/api/reports', data),
};
