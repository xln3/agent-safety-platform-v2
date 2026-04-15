import api from './api';

export interface Agent {
  id: number;
  name: string;
  description?: string;
  apiBase: string;
  apiKey?: string;
  modelId?: string;
  systemPrompt?: string;
  toolsEnabled?: boolean;
  ragEnabled?: boolean;
  features?: Record<string, unknown>;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentForm {
  name: string;
  description?: string;
  apiBase: string;
  apiKey?: string;
  modelId?: string;
  systemPrompt?: string;
  toolsEnabled?: boolean;
  ragEnabled?: boolean;
  features?: string;
}

export interface PaginatedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const agentService = {
  list: (params: { page?: number; pageSize?: number; keyword?: string }) =>
    api.get<unknown, PaginatedResult<Agent>>('/api/agents', { params }),

  getById: (id: number) => api.get<unknown, Agent>(`/api/agents/${id}`),

  create: (data: AgentForm) => api.post<unknown, Agent>('/api/agents', data),

  update: (id: number, data: AgentForm) =>
    api.put<unknown, Agent>(`/api/agents/${id}`, data),

  remove: (id: number) => api.delete<unknown, void>(`/api/agents/${id}`),
};
