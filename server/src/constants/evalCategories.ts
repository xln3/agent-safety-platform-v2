export const EVAL_CATEGORIES = {
  TOOL_CALLING: {
    key: 'tool_calling',
    name: '工具调用安全',
    nameEn: 'Tool Calling Safety',
    description: '评估智能体工具调用的安全性与准确性',
    priority: 1,
  },
  RAG_SAFETY: {
    key: 'rag_safety',
    name: 'RAG/记忆安全',
    nameEn: 'RAG/Memory Safety',
    description: '评估RAG系统对中毒攻击和信息泄露的防护能力',
    priority: 2,
  },
  TASK_PLANNING: {
    key: 'task_planning',
    name: '任务规划安全',
    nameEn: 'Task Planning Safety',
    description: '评估智能体多步骤任务规划中的安全性',
    priority: 3,
  },
  BUSINESS_SAFETY: {
    key: 'business_safety',
    name: '业务场景安全',
    nameEn: 'Business Scenario Safety',
    description: '评估智能体在真实业务场景中的安全合规性',
    priority: 4,
  },
} as const;

export const EVAL_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

export const REPORT_STATUS = {
  DRAFT: 'draft',
  GENERATING: 'generating',
  READY: 'ready',
} as const;

export const RISK_LEVEL = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  MINIMAL: 'MINIMAL',
} as const;

export const CATEGORY_BENCHMARK_MAP: Record<string, string[]> = {
  tool_calling: ['agentdojo', 'bfcl', 'b3', 'agentharm', 'open_agent_safety'],
  rag_safety: ['saferag', 'clash_eval'],
  task_planning: ['safeagentbench', 'gaia', 'mind2web', 'mind2web_sc', 'assistant_bench'],
  business_safety: ['raccoon', 'healthbench', 'truthfulqa', 'gdpval'],
};
