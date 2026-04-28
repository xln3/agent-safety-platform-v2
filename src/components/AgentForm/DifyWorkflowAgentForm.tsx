import React, { useState } from 'react';
import { Form, Input, Alert, Button, Space, message, Tag, Tooltip } from 'antd';
import { PlusOutlined, MinusCircleOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { agentService } from '../../services/agentService';
import type { DifyParameterVariable } from '../../services/agentService';

interface Props {
  isEdit: boolean;
}

const DEFAULT_SAMPLE_FIELD = 'input';

const DifyWorkflowAgentForm: React.FC<Props> = ({ isEdit }) => {
  const form = Form.useFormInstance();
  const [pulling, setPulling] = useState(false);
  const [pulledVars, setPulledVars] = useState<DifyParameterVariable[] | null>(null);

  const handlePullParameters = async () => {
    const apiBase = form.getFieldValue(['config', 'apiBase']);
    const apiKey = form.getFieldValue(['config', 'apiKey']);
    if (!apiBase) {
      message.warning('请先填写 Service API Endpoint');
      return;
    }
    if (!apiKey) {
      message.warning('请先填写 API Key' + (isEdit ? '（编辑模式下需要重新输入用于拉取）' : ''));
      return;
    }
    setPulling(true);
    try {
      const data = await agentService.fetchDifyParameters({ apiBase, apiKey });
      const variables = data?.variables || [];
      setPulledVars(variables);
      if (variables.length === 0) {
        message.warning('该工作流未声明任何输入变量');
        return;
      }
      const existingList = form.getFieldValue(['config', 'inputVariableMappingList']) as
        | Array<{ workflowVar?: string; sampleField?: string }>
        | undefined;
      const existingMap = new Map<string, string>();
      (existingList || []).forEach((it) => {
        if (it?.workflowVar) existingMap.set(it.workflowVar, it.sampleField || '');
      });

      const merged = variables.map((v) => ({
        workflowVar: v.variable,
        sampleField:
          existingMap.get(v.variable) ||
          (variables.length === 1 ? DEFAULT_SAMPLE_FIELD : ''),
      }));
      form.setFieldValue(['config', 'inputVariableMappingList'], merged);
      message.success(`拉取成功，共 ${variables.length} 个输入变量`);
    } catch (err: any) {
      // axios interceptor will already toast; keep a fallback for safety
      if (err?.message && !err?.response) message.error(err.message);
    } finally {
      setPulling(false);
    }
  };

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Dify 工作流接入说明"
        description={
          <span>
            需要 Dify 工作流的 <b>Service API Endpoint</b> 和 <b>API Key</b>。
            填写完毕后可点击下方"拉取参数"自动抓取工作流声明的输入变量；
            "样本字段"用来指定从基准测试样本中取值的路径，例如 <code>input</code>。
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
        extra={isEdit ? '编辑模式下若要拉取参数，需要在此处重新粘贴一次 API Key' : undefined}
      >
        <Input.Password placeholder={isEdit ? '留空则不修改' : '例如 app-xxxxxxxxxxxxxxxxxxxxxxxx'} />
      </Form.Item>

      <Form.Item label="输入变量映射" required>
        <Space style={{ marginBottom: 8 }}>
          <Tooltip title="调用 Dify /parameters 接口，把工作流声明的输入变量自动填充到下方列表">
            <Button
              icon={<CloudDownloadOutlined />}
              loading={pulling}
              onClick={handlePullParameters}
            >
              拉取参数
            </Button>
          </Tooltip>
          {pulledVars && pulledVars.length > 0 && (
            <span style={{ color: '#666', fontSize: 12 }}>
              已识别变量：
              {pulledVars.map((v) => (
                <Tag key={v.variable} color={v.required ? 'blue' : 'default'} style={{ marginLeft: 4 }}>
                  {v.variable}
                  {v.label ? `（${v.label}）` : ''}
                </Tag>
              ))}
            </span>
          )}
        </Space>

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
                  onClick={() => add({ sampleField: DEFAULT_SAMPLE_FIELD })}
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
};

export default DifyWorkflowAgentForm;
