import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Tag,
  Button,
  Space,
  Popconfirm,
  Spin,
  message,
} from 'antd';
import { EyeOutlined, DeleteOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { reportService } from '../services/reportService';
import type { Report } from '../services/reportService';
import dayjs from 'dayjs';

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  draft: { color: 'default', label: '草稿' },
  generating: { color: 'processing', label: '生成中' },
  ready: { color: 'success', label: '已完成' },
};

const ReportListPage: React.FC = () => {
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await reportService.list({ page, pageSize });
      setReports(data.list || []);
      setTotal(data.total || 0);
    } catch {
      // Handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleDelete = async (id: number) => {
    try {
      await reportService.remove(id);
      message.success('删除成功');
      fetchReports();
    } catch {
      // Handled by interceptor
    }
  };

  const columns: ColumnsType<Report> = [
    {
      title: '报告标题',
      dataIndex: 'title',
      key: 'title',
      render: (text: string, record: Report) => (
        <a onClick={() => navigate(`/reports/${record.id}`)}>
          {text || '未命名报告'}
        </a>
      ),
    },
    {
      title: '智能体',
      dataIndex: 'agentName',
      key: 'agentName',
      render: (text: string) => text || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const cfg = STATUS_MAP[status] || STATUS_MAP.draft;
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
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
      render: (_: unknown, record: Report) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/reports/${record.id}`)}
          >
            查看
          </Button>
          <Popconfirm
            title="确认删除该报告？"
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
        <h1>评估报告</h1>
      </div>

      <Spin spinning={loading}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={reports}
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
    </div>
  );
};

export default ReportListPage;
