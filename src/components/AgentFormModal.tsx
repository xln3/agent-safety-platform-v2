import React, { useEffect } from 'react';
import { Modal, Form, Input, Switch, Select, message } from 'antd';
import type { Agent, AgentForm, AgentType } from '../services/agentService';

const { TextArea } = Input;

const AGENT_TYPE_OPTIONS: { label: string; value: AgentType }[] = [
  { label: '模型测试', value: 'model' },
  { label: 'Dify 对话智能体', value: 'dify_chat' },
  { label: 'Dify 工作流智能体', value: 'dify_workflow' },
];

interface AgentFormModalProps {
  open: boolean;
  agent?: Agent | null;
  onCancel: () => void;
  onOk: (values: AgentForm) => Promise<void>;
}

const AgentFormModal: React.FC<AgentFormModalProps> = ({
  open,
  agent,
  onCancel,
  onOk,
}) => {
  const [form] = Form.useForm<AgentForm>();
  const [loading, setLoading] = React.useState(false);
  const isEdit = !!agent;

  const agentType = Form.useWatch('agentType', form) as AgentType | undefined;
  const isDify = agentType === 'dify_chat' || agentType === 'dify_workflow';

  useEffect(() => {
    if (open) {
      if (agent) {
        form.setFieldsValue({
          name: agent.name,
          agentType: agent.agentType || 'model',
          description: agent.description || '',
          apiBase: agent.apiBase,
          apiKey: agent.apiKey || '',
          modelId: agent.modelId || '',
          systemPrompt: agent.systemPrompt || '',
          toolsEnabled: agent.toolsEnabled ?? false,
          ragEnabled: agent.ragEnabled ?? false,
          features: agent.features ? JSON.stringify(agent.features, null, 2) : '',
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, agent, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await onOk(values);
      form.resetFields();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        return;
      }
      message.error('操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑智能体' : '新建智能体'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      width={640}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          agentType: 'model',
          toolsEnabled: false,
          ragEnabled: false,
        }}
      >
        <Form.Item
          name="agentType"
          label="智能体类型"
          rules={[{ required: true, message: '请选择智能体类型' }]}
        >
          <Select options={AGENT_TYPE_OPTIONS} />
        </Form.Item>

        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入智能体名称' }]}
        >
          <Input placeholder="输入智能体名称" maxLength={100} />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <TextArea placeholder="输入描述信息" rows={2} maxLength={500} />
        </Form.Item>

        <Form.Item
          name="apiBase"
          label={isDify ? '入口 URL' : 'API 地址'}
          rules={[{ required: true, message: isDify ? '请输入入口 URL' : '请输入 API 地址' }]}
        >
          <Input placeholder={isDify ? '例如 https://api.dify.ai/v1' : '例如 https://api.openai.com/v1'} />
        </Form.Item>

        <Form.Item
          name="apiKey"
          label={isDify ? '入口 Key' : 'API Key'}
          rules={[{ required: true, message: isDify ? '请输入入口 Key' : '请输入 API Key' }]}
        >
          <Input.Password placeholder={isDify ? '例如 app-xxxx' : '输入 API Key'} />
        </Form.Item>

        {!isDify && (
          <Form.Item
            name="modelId"
            label="模型 ID"
            rules={[{ required: !isDify, message: '请输入模型 ID' }]}
          >
            <Input placeholder="例如 gpt-4o" />
          </Form.Item>
        )}

        {!isDify && (
          <>
            <Form.Item name="systemPrompt" label="系统提示词">
              <TextArea placeholder="输入系统提示词" rows={4} />
            </Form.Item>

            <Form.Item
              name="toolsEnabled"
              label="启用工具调用"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="ragEnabled"
              label="启用 RAG"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="features"
              label="扩展特性 (JSON)"
              rules={[
                {
                  validator: (_, value) => {
                    if (!value || value.trim() === '') return Promise.resolve();
                    try {
                      JSON.parse(value);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject(new Error('请输入有效的 JSON'));
                    }
                  },
                },
              ]}
            >
              <TextArea
                placeholder='可选，例如 { "streaming": true }'
                rows={3}
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
};

export default AgentFormModal;
