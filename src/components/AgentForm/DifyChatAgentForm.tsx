import React from 'react';
import { Form, Input, Alert } from 'antd';

const { TextArea } = Input;

interface Props {
  isEdit: boolean;
}

const DifyChatAgentForm: React.FC<Props> = ({ isEdit }) => (
  <>
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="Dify 对话应用接入说明"
      description={
        <span>
          需要在 Dify 应用后台获取 <b>Service API Endpoint</b>（如 <code>https://api.dify.ai/v1</code>）
          以及对应的 <b>API Key</b>（以 <code>app-</code> 开头）。WebApp 公开链接（<code>udify.app/...</code>）不能用于程序调用。
        </span>
      }
    />

    <Form.Item
      name={['config', 'apiBase']}
      label="Service API Endpoint"
      rules={[{ required: true, message: '请输入 Service API Endpoint' }]}
    >
      <Input placeholder="例如 https://api.dify.ai/v1" />
    </Form.Item>

    <Form.Item
      name={['config', 'apiKey']}
      label={isEdit ? 'API Key（留空则不修改）' : 'API Key'}
      rules={isEdit ? [] : [{ required: true, message: '请输入 API Key' }]}
    >
      <Input.Password placeholder={isEdit ? '留空则不修改' : '例如 app-xxxxxxxxxxxxxxxxxxxxxxxx'} />
    </Form.Item>

    <Form.Item name={['config', 'systemPrompt']} label="附加系统提示词（可选）">
      <TextArea placeholder="可选，会作为前置消息注入" rows={3} />
    </Form.Item>
  </>
);

export default DifyChatAgentForm;
