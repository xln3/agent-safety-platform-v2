import api from './api';
import type { PaginatedResult } from './agentService';

export interface JudgeModel {
  id: number;
  name: string;
  apiBase: string;
  apiKey?: string;
  modelId: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface JudgeModelForm {
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  description?: string;
}

export const judgeModelService = {
  list: (params: { page?: number; pageSize?: number; keyword?: string }) =>
    api.get<unknown, PaginatedResult<JudgeModel>>('/api/judge-models', { params }),

  getById: (id: number) => api.get<unknown, JudgeModel>(`/api/judge-models/${id}`),

  create: (data: JudgeModelForm) => api.post<unknown, JudgeModel>('/api/judge-models', data),

  update: (id: number, data: Partial<JudgeModelForm>) =>
    api.put<unknown, JudgeModel>(`/api/judge-models/${id}`, data),

  remove: (id: number) => api.delete<unknown, void>(`/api/judge-models/${id}`),
};
