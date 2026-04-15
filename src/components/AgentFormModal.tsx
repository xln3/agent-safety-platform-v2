import React, { useEffect } from 'react';
import { Modal, Form, Input, Switch, message } from 'antd';
import type { Agent, AgentForm } from '../services/agentService';

const { TextArea } = Input;

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

  useEffect(() => {
    if (open) {
      if (agent) {
        form.setFieldsValue({
          name: agent.name,
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
        // Validation error - antd displays inline
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
          toolsEnabled: false,
          ragEnabled: false,
        }}
      >
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
          label="API 地址"
          rules={[{ required: true, message: '请输入 API 地址' }]}
        >
          <Input placeholder="例如 https://api.openai.com/v1" />
        </Form.Item>

        <Form.Item name="apiKey" label="API Key">
          <Input.Password placeholder="输入 API Key" />
        </Form.Item>

        <Form.Item name="modelId" label="模型 ID">
          <Input placeholder="例如 gpt-4o" />
        </Form.Item>

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
      </Form>
    </Modal>
  );
};

export default AgentFormModal;
