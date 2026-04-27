import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Input,
  Space,
  Popconfirm,
  message,
  Spin,
  Modal,
  Form,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { judgeModelService } from '../services/judgeModelService';
import type { JudgeModel, JudgeModelForm } from '../services/judgeModelService';
import dayjs from 'dayjs';

const { Search, TextArea } = Input;

const JudgeModelListPage: React.FC = () => {
  const [judges, setJudges] = useState<JudgeModel[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<JudgeModel | null>(null);
  const [form] = Form.useForm<JudgeModelForm>();
  const [submitting, setSubmitting] = useState(false);

  const fetchJudges = useCallback(async () => {
    setLoading(true);
    try {
      const data = await judgeModelService.list({ page, pageSize, keyword });
      setJudges(data.list || []);
      setTotal(data.total || 0);
    } catch {
      // Handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword]);

  useEffect(() => {
    fetchJudges();
  }, [fetchJudges]);

  const handleCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (judge: JudgeModel) => {
    setEditing(judge);
    form.setFieldsValue({
      name: judge.name,
      apiBase: judge.apiBase,
      apiKey: '',
      modelId: judge.modelId,
      description: judge.description || '',
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await judgeModelService.remove(id);
      message.success('删除成功');
      fetchJudges();
    } catch {
      // Handled by interceptor
    }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editing) {
        const payload: Partial<JudgeModelForm> = { ...values };
        if (!values.apiKey) delete payload.apiKey;
        await judgeModelService.update(editing.id, payload);
        message.success('更新成功');
      } else {
        await judgeModelService.create(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditing(null);
      fetchJudges();
    } catch (err: any) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<JudgeModel> = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '模型 ID', dataIndex: 'modelId', key: 'modelId' },
    { title: 'API 地址', dataIndex: 'apiBase', key: 'apiBase', ellipsis: true },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true, render: (v) => v || '-' },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (text: string) => (text ? dayjs(text).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该裁判模型？"
            onConfirm={() => handleDelete(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>裁判模型管理</h1>
        <div className="page-header-actions">
          <Search
            placeholder="搜索名称/模型/描述"
            onSearch={(v) => { setKeyword(v); setPage(1); }}
            style={{ width: 260 }}
            allowClear
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建裁判模型
          </Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={judges}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </Spin>

      <Modal
        title={editing ? '编辑裁判模型' : '新建裁判模型'}
        open={modalOpen}
        onOk={handleOk}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        confirmLoading={submitting}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如 gpt-4o-judge" maxLength={128} />
          </Form.Item>
          <Form.Item name="apiBase" label="API 地址" rules={[{ required: true, message: '请输入 API 地址' }]}>
            <Input placeholder="例如 https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label={editing ? 'API Key（留空则不修改）' : 'API Key'}
            rules={editing ? [] : [{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder={editing ? '留空则不修改' : '输入 API Key'} />
          </Form.Item>
          <Form.Item name="modelId" label="模型 ID" rules={[{ required: true, message: '请输入模型 ID' }]}>
            <Input placeholder="例如 gpt-4o" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} maxLength={500} placeholder="可选描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default JudgeModelListPage;
