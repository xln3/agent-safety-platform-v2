import api from './api';
import type { PaginatedResult } from './agentService';

export interface Report {
  id: number;
  title: string;
  jobId?: number;
  agentId?: number;
  agentName?: string;
  status: 'draft' | 'generating' | 'ready';
  content?: string;
  summary?: {
    overallScore: number;
    categories: Array<{ category: string; score: number }>;
  };
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
