import React, { useEffect, useState } from 'react';
import {
  Card,
  Descriptions,
  Table,
  Tag,
  Button,
  Spin,
  Space,
  Typography,
  Empty,
} from 'antd';
import {
  ArrowLeftOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { agentService } from '../services/agentService';
import { evalService } from '../services/evalService';
import type { Agent } from '../services/agentService';
import type { EvalJob } from '../services/evalService';
import dayjs from 'dayjs';

const { Title } = Typography;

const JOB_STATUS_MAP: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'default', icon: <ClockCircleOutlined />, label: '等待中' },
  running: { color: 'processing', icon: <SyncOutlined spin />, label: '运行中' },
  completed: { color: 'success', icon: <CheckCircleOutlined />, label: '已完成' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, label: '失败' },
};

const AgentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [jobs, setJobs] = useState<EvalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    if (!id) return;

    const agentId = parseInt(id, 10);

    const fetchData = async () => {
      setLoading(true);
      try {
        const agentData = await agentService.getById(agentId);
        setAgent(agentData);
      } catch {
        // Handled by interceptor
      } finally {
        setLoading(false);
      }

      setJobsLoading(true);
      try {
        const jobsData = await evalService.listJobs({ agentId, pageSize: 50 });
        setJobs(jobsData.list || []);
      } catch {
        // May not have jobs yet
      } finally {
        setJobsLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const jobColumns: ColumnsType<EvalJob> = [
    {
      title: '评估名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: EvalJob) => (
        <a onClick={() => navigate(`/eval/progress/${record.id}`)}>{text}</a>
      ),
    },
    {
      title: '评估类别',
      dataIndex: 'categories',
      key: 'categories',
      render: (cats: string[]) => (
        <Space wrap>
          {(cats || []).map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => {
        const cfg = JOB_STATUS_MAP[status] || JOB_STATUS_MAP.pending;
        return (
          <Tag color={cfg.color} icon={cfg.icon}>
            {cfg.label}
          </Tag>
        );
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 120,
      render: (_: unknown, record: EvalJob) =>
        `${record.completedTasks || 0} / ${record.totalTasks || 0}`,
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
      width: 120,
      render: (_: unknown, record: EvalJob) => (
        <Space>
          {record.status === 'completed' && (
            <Button
              type="link"
              size="small"
              onClick={() => navigate(`/eval/results/${record.id}`)}
            >
              查看结果
            </Button>
          )}
        </Space>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex-center" style={{ padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!agent) {
    return <Empty description="智能体不存在" />;
  }

  return (
    <div>
      <div className="page-header">
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/agents')}
          >
            返回
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            {agent.name}
          </Title>
        </Space>
        <Button
          type="primary"
          icon={<ExperimentOutlined />}
          onClick={() => navigate(`/eval/new?agentId=${agent.id}`)}
        >
          发起评估
        </Button>
      </div>

      <Card style={{ marginBottom: 24 }}>
        <Descriptions column={2} bordered size="middle">
          <Descriptions.Item label="名称">{agent.name}</Descriptions.Item>
          <Descriptions.Item label="模型 ID">
            {agent.modelId || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="API 地址">{agent.apiBase}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={agent.status === 'active' ? 'green' : 'default'}>
              {agent.status === 'active' ? '正常' : agent.status || '正常'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="描述" span={2}>
            {agent.description || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="系统提示词" span={2}>
            <div style={{ maxHeight: 100, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {agent.systemPrompt || '-'}
            </div>
          </Descriptions.Item>
          <Descriptions.Item label="工具调用">
            {agent.toolsEnabled ? (
              <Tag color="blue">已启用</Tag>
            ) : (
              <Tag>未启用</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="RAG">
            {agent.ragEnabled ? (
              <Tag color="blue">已启用</Tag>
            ) : (
              <Tag>未启用</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {agent.createdAt ? dayjs(agent.createdAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {agent.updatedAt ? dayjs(agent.updatedAt).format('YYYY-MM-DD HH:mm:ss') : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="评估历史">
        <Spin spinning={jobsLoading}>
          <Table
            rowKey="id"
            columns={jobColumns}
            dataSource={jobs}
            pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
            locale={{ emptyText: '暂无评估记录' }}
          />
        </Spin>
      </Card>
    </div>
  );
};

export default AgentDetailPage;
