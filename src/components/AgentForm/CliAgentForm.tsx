import React from 'react';
import { Form, Input, Select, InputNumber, Alert } from 'antd';

const { TextArea } = Input;

const CliAgentForm: React.FC = () => (
  <>
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="本地 CLI 智能体接入说明"
      description={
        <span>
          通过 shell 命令启动一个本地进程作为智能体，进程的 stdout 即作为输出。
          输入注入方式：<code>placeholder</code>（命令模板里用 <code>{'{INPUT}'}</code> 占位）或 <code>stdin</code>（通过标准输入传入）。
        </span>
      }
    />

    <Form.Item
      name={['config', 'commandTemplate']}
      label="命令模板"
      rules={[{ required: true, message: '请输入命令模板' }]}
    >
      <Input placeholder='例如 python my_agent.py "{INPUT}" 或 my-cli-tool' />
    </Form.Item>

    <Form.Item
      name={['config', 'inputMode']}
      label="输入注入方式"
      rules={[{ required: true, message: '请选择输入方式' }]}
      initialValue="placeholder"
    >
      <Select
        options={[
          { label: '占位符 {INPUT}（在命令模板里替换）', value: 'placeholder' },
          { label: '标准输入 stdin', value: 'stdin' },
        ]}
      />
    </Form.Item>

    <Form.Item
      name={['config', 'timeoutSec']}
      label="单次调用超时（秒）"
      initialValue={120}
    >
      <InputNumber min={1} max={3600} style={{ width: 200 }} />
    </Form.Item>

    <Form.Item
      name={['config', 'envText']}
      label="环境变量（可选，每行一条 KEY=VALUE）"
    >
      <TextArea rows={3} placeholder={'例如\nOPENAI_API_KEY=sk-xxx\nMODEL=gpt-4o'} />
    </Form.Item>
  </>
);

export default CliAgentForm;
