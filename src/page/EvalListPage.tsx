import React, { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Select, Space, Spin, Button } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { evalService } from '../services/evalService';
import type { EvalJob } from '../services/evalService';
import dayjs from 'dayjs';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '等待中' },
  { value: 'running', label: '运行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
];

const STATUS_MAP: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'default', icon: <ClockCircleOutlined />, label: '等待中' },
  running: { color: 'processing', icon: <SyncOutlined spin />, label: '运行中' },
  completed: { color: 'success', icon: <CheckCircleOutlined />, label: '已完成' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, label: '失败' },
};

const EvalListPage: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<EvalJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await evalService.listJobs({
        page,
        pageSize,
        status: statusFilter || undefined,
      });
      setJobs(data.list || []);
      setTotal(data.total || 0);
    } catch {
      // Handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const columns: ColumnsType<EvalJob> = [
    {
      title: '评估名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: EvalJob) => (
        <a onClick={() => navigate(`/eval/progress/${record.id}`)}>{text || `评估 #${record.id}`}</a>
      ),
    },
    {
      title: '模型',
      dataIndex: 'modelId',
      key: 'modelId',
      render: (text: string) => text || '-',
    },
    {
      title: '基准测试',
      dataIndex: 'benchmarks',
      key: 'benchmarks',
      render: (benchmarks: string[]) => (
        <Space wrap>
          {(benchmarks || []).map((b) => (
            <Tag key={b}>{b}</Tag>
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
        const cfg = STATUS_MAP[status] || STATUS_MAP.pending;
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
      width: 100,
      render: (_: unknown, record: EvalJob) => {
        const completed = record.completedTasks || 0;
        const t = record.totalTasks || 0;
        return `${completed} / ${t}`;
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
      width: 140,
      render: (_: unknown, record: EvalJob) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/eval/progress/${record.id}`);
            }}
          >
            详情
          </Button>
          {record.status === 'completed' && (
            <Button
              type="link"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/eval/results/${record.id}`);
              }}
            >
              结果
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>安全评估</h1>
        <div className="page-header-actions">
          <Select
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            style={{ width: 140 }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/eval/new')}
          >
            新建评估
          </Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={jobs}
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
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => navigate(`/eval/progress/${record.id}`),
          })}
        />
      </Spin>
    </div>
  );
};

export default EvalListPage;
