import React from 'react';
import { Form, Input } from 'antd';

const { TextArea } = Input;

interface Props {
  isEdit: boolean;
}

const OpenAIAgentForm: React.FC<Props> = ({ isEdit }) => (
  <>
    <Form.Item
      name={['config', 'apiBase']}
      label="API 地址"
      rules={[{ required: true, message: '请输入 API 地址' }]}
    >
      <Input placeholder="例如 https://api.openai.com/v1" />
    </Form.Item>

    <Form.Item
      name={['config', 'apiKey']}
      label={isEdit ? 'API Key（留空则不修改）' : 'API Key'}
      rules={isEdit ? [] : [{ required: true, message: '请输入 API Key' }]}
    >
      <Input.Password placeholder={isEdit ? '留空则不修改' : '输入 API Key'} />
    </Form.Item>

    <Form.Item
      name={['config', 'modelId']}
      label="模型 ID"
      rules={[{ required: true, message: '请输入模型 ID' }]}
    >
      <Input placeholder="例如 gpt-4o-mini" />
    </Form.Item>

    <Form.Item name={['config', 'systemPrompt']} label="系统提示词">
      <TextArea placeholder="可选，输入系统提示词" rows={3} />
    </Form.Item>
  </>
);

export default OpenAIAgentForm;
