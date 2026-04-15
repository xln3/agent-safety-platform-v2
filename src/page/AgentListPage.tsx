import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Input,
  Space,
  Popconfirm,
  Tag,
  message,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { agentService } from '../services/agentService';
import type { Agent, AgentForm } from '../services/agentService';
import AgentFormModal from '../components/AgentFormModal';
import dayjs from 'dayjs';

const { Search } = Input;

const AgentListPage: React.FC = () => {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await agentService.list({ page, pageSize, keyword });
      setAgents(data.list || []);
      setTotal(data.total || 0);
    } catch {
      // Handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleSearch = (value: string) => {
    setKeyword(value);
    setPage(1);
  };

  const handleCreate = () => {
    setEditingAgent(null);
    setModalOpen(true);
  };

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await agentService.remove(id);
      message.success('删除成功');
      fetchAgents();
    } catch {
      // Handled by interceptor
    }
  };

  const handleModalOk = async (values: AgentForm) => {
    if (editingAgent) {
      await agentService.update(editingAgent.id, values);
      message.success('更新成功');
    } else {
      await agentService.create(values);
      message.success('创建成功');
    }
    setModalOpen(false);
    setEditingAgent(null);
    fetchAgents();
  };

  const handleEval = (agentId: number) => {
    navigate(`/eval/new?agentId=${agentId}`);
  };

  const columns: ColumnsType<Agent> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Agent) => (
        <a onClick={() => navigate(`/agents/${record.id}`)}>{text}</a>
      ),
    },
    {
      title: '模型',
      dataIndex: 'modelId',
      key: 'modelId',
      render: (text: string) => text || '-',
    },
    {
      title: 'API 地址',
      dataIndex: 'apiBase',
      key: 'apiBase',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          active: 'green',
          inactive: 'default',
          error: 'red',
        };
        const labelMap: Record<string, string> = {
          active: '正常',
          inactive: '未激活',
          error: '异常',
        };
        return (
          <Tag color={colorMap[status] || 'default'}>
            {labelMap[status] || status || '正常'}
          </Tag>
        );
      },
    },
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
      render: (_: unknown, record: Agent) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该智能体？"
            onConfirm={() => handleDelete(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
          <Button
            type="link"
            size="small"
            icon={<ExperimentOutlined />}
            onClick={() => handleEval(record.id)}
          >
            评估
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>智能体管理</h1>
        <div className="page-header-actions">
          <Search
            placeholder="搜索智能体"
            onSearch={handleSearch}
            style={{ width: 260 }}
            allowClear
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建智能体
          </Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={agents}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Spin>

      <AgentFormModal
        open={modalOpen}
        agent={editingAgent}
        onCancel={() => {
          setModalOpen(false);
          setEditingAgent(null);
        }}
        onOk={handleModalOk}
      />
    </div>
  );
};

export default AgentListPage;
