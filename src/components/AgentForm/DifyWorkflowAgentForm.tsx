import React from 'react';
import { Form, Input, Alert, Button, Space } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';

interface Props {
  isEdit: boolean;
}

const DifyWorkflowAgentForm: React.FC<Props> = ({ isEdit }) => (
  <>
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="Dify 工作流接入说明"
      description={
        <span>
          需要 Dify 工作流的 <b>Service API Endpoint</b> 和 <b>API Key</b>。
          下方"输入变量映射"用来把基准测试样本的字段映射到工作流的输入变量名。
          例如把样本的 <code>input</code> 映射到工作流变量 <code>query</code>。
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

    <Form.Item label="输入变量映射" required>
      <Form.List
        name={['config', 'inputVariableMappingList']}
        rules={[
          {
            validator: async (_, list) => {
              if (!list || list.length === 0) {
                return Promise.reject(new Error('至少需要一对映射'));
              }
            },
          },
        ]}
      >
        {(fields, { add, remove }, { errors }) => (
          <>
            {fields.map(({ key, name }) => (
              <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                <Form.Item
                  name={[name, 'workflowVar']}
                  rules={[{ required: true, message: '工作流变量名' }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="工作流变量名（如 query）" style={{ width: 200 }} />
                </Form.Item>
                <span>←</span>
                <Form.Item
                  name={[name, 'sampleField']}
                  rules={[{ required: true, message: '样本字段路径' }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="样本字段（如 input）" style={{ width: 200 }} />
                </Form.Item>
                <MinusCircleOutlined onClick={() => remove(name)} />
              </Space>
            ))}
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="dashed"
                onClick={() => add()}
                icon={<PlusOutlined />}
                style={{ width: 200 }}
              >
                添加映射
              </Button>
              <Form.ErrorList errors={errors} />
            </Form.Item>
          </>
        )}
      </Form.List>
    </Form.Item>
  </>
);

export default DifyWorkflowAgentForm;
