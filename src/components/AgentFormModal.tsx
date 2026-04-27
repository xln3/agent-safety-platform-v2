import React, { useEffect } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import type { Agent, AgentForm, AgentType } from '../services/agentService';
import { AGENT_TYPE_LABELS } from '../services/agentService';
import OpenAIAgentForm from './AgentForm/OpenAIAgentForm';
import DifyChatAgentForm from './AgentForm/DifyChatAgentForm';
import DifyWorkflowAgentForm from './AgentForm/DifyWorkflowAgentForm';
import CliAgentForm from './AgentForm/CliAgentForm';

const { TextArea } = Input;

const AGENT_TYPE_OPTIONS: { label: string; value: AgentType }[] = (
  ['openai_compat', 'dify_chat', 'dify_workflow', 'cli'] as const
).map((v) => ({ label: AGENT_TYPE_LABELS[v], value: v }));

interface AgentFormModalProps {
  open: boolean;
  agent?: Agent | null;
  onCancel: () => void;
  onOk: (values: AgentForm) => Promise<void>;
}

/** Convert form values into the canonical AgentForm payload. */
function buildSubmitPayload(values: any): AgentForm {
  const { agentType, name, description, config = {} } = values;

  const out: any = { name, description, agentType, config: {} };

  if (agentType === 'openai_compat') {
    out.config = {
      apiBase: config.apiBase,
      apiKey: config.apiKey,
      modelId: config.modelId,
      systemPrompt: config.systemPrompt || null,
    };
  } else if (agentType === 'dify_chat') {
    out.config = {
      apiBase: config.apiBase,
      apiKey: config.apiKey,
      systemPrompt: config.systemPrompt || null,
    };
  } else if (agentType === 'dify_workflow') {
    const list = (config.inputVariableMappingList || []) as Array<{
      workflowVar: string;
      sampleField: string;
    }>;
    const mapping: Record<string, string> = {};
    for (const item of list) {
      if (item?.workflowVar) mapping[item.workflowVar] = item.sampleField;
    }
    out.config = {
      apiBase: config.apiBase,
      apiKey: config.apiKey,
      inputVariableMapping: mapping,
    };
  } else if (agentType === 'cli') {
    const env: Record<string, string> = {};
    const envText = (config.envText || '').trim();
    if (envText) {
      for (const line of envText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
        }
      }
    }
    out.config = {
      commandTemplate: config.commandTemplate,
      inputMode: config.inputMode || 'placeholder',
      ...(config.timeoutSec ? { timeoutSec: Number(config.timeoutSec) } : {}),
      ...(Object.keys(env).length ? { env } : {}),
    };
  }

  return out as AgentForm;
}

/** Convert agent record into form initial values. */
function buildInitialValues(agent: Agent | null | undefined): Record<string, any> {
  if (!agent) {
    return {
      agentType: 'openai_compat',
      config: { inputMode: 'placeholder', timeoutSec: 120 },
    };
  }

  const cfg = (agent.config as any) || {};
  const base: Record<string, any> = {
    name: agent.name,
    agentType: agent.agentType,
    description: agent.description || '',
    config: {} as Record<string, any>,
  };

  if (agent.agentType === 'openai_compat') {
    base.config = {
      apiBase: cfg.apiBase ?? agent.apiBase ?? '',
      modelId: cfg.modelId ?? agent.modelId ?? '',
      systemPrompt: cfg.systemPrompt ?? agent.systemPrompt ?? '',
      apiKey: '',
    };
  } else if (agent.agentType === 'dify_chat') {
    base.config = {
      apiBase: cfg.apiBase ?? agent.apiBase ?? '',
      systemPrompt: cfg.systemPrompt ?? agent.systemPrompt ?? '',
      apiKey: '',
    };
  } else if (agent.agentType === 'dify_workflow') {
    const mapping = cfg.inputVariableMapping || {};
    base.config = {
      apiBase: cfg.apiBase ?? agent.apiBase ?? '',
      apiKey: '',
      inputVariableMappingList: Object.entries(mapping).map(([workflowVar, sampleField]) => ({
        workflowVar,
        sampleField,
      })),
    };
  } else if (agent.agentType === 'cli') {
    const envObj = cfg.env || {};
    const envText = Object.entries(envObj)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    base.config = {
      commandTemplate: cfg.commandTemplate || '',
      inputMode: cfg.inputMode || 'placeholder',
      timeoutSec: cfg.timeoutSec || 120,
      envText,
    };
  }

  return base;
}

const AgentFormModal: React.FC<AgentFormModalProps> = ({ open, agent, onCancel, onOk }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = React.useState(false);
  const isEdit = !!agent;

  const agentType = Form.useWatch('agentType', form) as AgentType | undefined;

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue(buildInitialValues(agent));
    }
  }, [open, agent, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const payload = buildSubmitPayload(values);
      // For edit: drop blank apiKey so server keeps existing one
      if (isEdit && (payload.config as any).apiKey === '') {
        delete (payload.config as any).apiKey;
      }
      await onOk(payload);
    } catch (err: any) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(err?.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const renderSubForm = () => {
    switch (agentType) {
      case 'openai_compat':
        return <OpenAIAgentForm isEdit={isEdit} />;
      case 'dify_chat':
        return <DifyChatAgentForm isEdit={isEdit} />;
      case 'dify_workflow':
        return <DifyWorkflowAgentForm isEdit={isEdit} />;
      case 'cli':
        return <CliAgentForm />;
      default:
        return null;
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑智能体' : '新建智能体'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      width={680}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="agentType"
          label="智能体类型"
          rules={[{ required: true, message: '请选择智能体类型' }]}
        >
          <Select options={AGENT_TYPE_OPTIONS} disabled={isEdit} />
        </Form.Item>

        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入智能体名称' }]}
        >
          <Input placeholder="输入智能体名称" maxLength={100} />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <TextArea placeholder="可选描述信息" rows={2} maxLength={500} />
        </Form.Item>

        {renderSubForm()}
      </Form>
    </Modal>
  );
};

export default AgentFormModal;
