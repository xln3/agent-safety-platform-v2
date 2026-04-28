import api from './api';

export type AgentType = 'openai_compat' | 'dify_chat' | 'dify_workflow' | 'cli';

export interface OpenAICompatConfig {
  apiBase: string;
  apiKey: string;
  modelId: string;
  systemPrompt?: string | null;
}

export interface DifyChatConfig {
  apiBase: string;
  apiKey: string;
  systemPrompt?: string | null;
}

export interface DifyWorkflowConfig {
  apiBase: string;
  apiKey: string;
  inputVariableMapping: Record<string, string>;
}

export interface CliConfig {
  commandTemplate: string;
  inputMode: 'placeholder' | 'stdin';
  timeoutSec?: number;
  env?: Record<string, string>;
}

export type AgentConfig =
  | OpenAICompatConfig
  | DifyChatConfig
  | DifyWorkflowConfig
  | CliConfig;

export interface Agent {
  id: number;
  name: string;
  agentType: AgentType;
  description?: string | null;
  config?: AgentConfig | null;
  /** Legacy fields — populated for openai_compat agents to keep evalRunner working. */
  apiBase?: string | null;
  apiKey?: string | null;
  modelId?: string | null;
  systemPrompt?: string | null;
  toolsEnabled?: boolean;
  ragEnabled?: boolean;
  features?: Record<string, unknown>;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentForm {
  name: string;
  agentType: AgentType;
  description?: string;
  config: AgentConfig;
}

export interface PaginatedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  openai_compat: 'OpenAI 兼容模型',
  dify_chat: 'Dify 对话',
  dify_workflow: 'Dify 工作流',
  cli: '本地 CLI',
};

export interface DifyParameterVariable {
  variable: string;
  label?: string;
  type: string;
  required?: boolean;
  maxLength?: number | null;
  default?: string | null;
  options?: string[];
}

export interface DifyParametersResponse {
  variables: DifyParameterVariable[];
  raw: Record<string, unknown>;
}

export const agentService = {
  list: (params: { page?: number; pageSize?: number; keyword?: string }) =>
    api.get<unknown, PaginatedResult<Agent>>('/api/agents', { params }),

  getById: (id: number) => api.get<unknown, Agent>(`/api/agents/${id}`),

  create: (data: AgentForm) => api.post<unknown, Agent>('/api/agents', data),

  update: (id: number, data: AgentForm) =>
    api.put<unknown, Agent>(`/api/agents/${id}`, data),

  remove: (id: number) => api.delete<unknown, void>(`/api/agents/${id}`),

  fetchDifyParameters: (data: { apiBase: string; apiKey: string }) =>
    api.post<unknown, DifyParametersResponse>('/api/dify-proxy/parameters', data),
};
