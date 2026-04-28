/**
 * Per-sample table view backed by the EvalItem table.
 *
 * Lists every sample run within a job (across all tasks). Useful both during
 * a running job (live SSE updates) and after completion. Click a row to open
 * the detail drawer.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Table, Tag, Typography, Space, Select, Input, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { evalService } from '../../services/evalService';
import type { EvalItem } from '../../services/evalService';
import SampleDetailDrawer from './SampleDetailDrawer';
import dayjs from 'dayjs';

const { Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '等待中' },
  running: { color: 'processing', label: '运行中' },
  success: { color: 'success', label: '成功' },
  failed: { color: 'error', label: '失败' },
};

const truncate = (s: string | null | undefined, n = 80): string => {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
};

interface Props {
  jobId: number;
  /** When true, periodically refetch (used during a running job). */
  live?: boolean;
}

const LiveItemsView: React.FC<Props> = ({ jobId, live = false }) => {
  const [items, setItems] = useState<EvalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [drawerItemId, setDrawerItemId] = useState<number | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await evalService.listJobItems(jobId, {
        page,
        pageSize,
        status: statusFilter,
      });
      const list = (res?.list as EvalItem[]) || [];
      const filtered = search
        ? list.filter(
            (i) =>
              i.sampleId.toLowerCase().includes(search.toLowerCase()) ||
              (i.outputText || '').toLowerCase().includes(search.toLowerCase()),
          )
        : list;
      setItems(filtered);
      setTotal(res?.total ?? 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [jobId, page, pageSize, statusFilter, search]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (!live) return;
    refreshTimer.current = setInterval(fetchItems, 5_000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [live, fetchItems]);

  const columns: ColumnsType<EvalItem> = [
    {
      title: '样本',
      dataIndex: 'sampleId',
      key: 'sampleId',
      width: 220,
      render: (v: string, row) => (
        <Space size={4}>
          <Text code style={{ fontSize: 12 }}>
            {v}
          </Text>
          <Tag>{row.benchmark}</Tag>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => {
        const cfg = STATUS_TAG[s] || STATUS_TAG.pending;
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '输出预览',
      dataIndex: 'outputText',
      key: 'outputText',
      ellipsis: true,
      render: (v: string | null, row) => {
        if (row.status === 'failed' && row.errorMessage) {
          return <Text type="danger">{truncate(row.errorMessage, 100)}</Text>;
        }
        return <Text type="secondary">{truncate(v, 120) || '—'}</Text>;
      },
    },
    {
      title: '耗时',
      dataIndex: 'latencyMs',
      key: 'latencyMs',
      width: 100,
      render: (ms: number | null) => (ms != null ? `${ms} ms` : '-'),
    },
    {
      title: '重试',
      dataIndex: 'retryCount',
      key: 'retryCount',
      width: 70,
      render: (n: number) => (n > 0 ? <Tag color="orange">{n}</Tag> : '-'),
    },
    {
      title: '完成时间',
      dataIndex: 'finishedAt',
      key: 'finishedAt',
      width: 160,
      render: (d: string | null) => (d ? dayjs(d).format('HH:mm:ss') : '-'),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          placeholder="按状态筛选"
          style={{ width: 160 }}
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={[
            { value: 'running', label: '运行中' },
            { value: 'success', label: '成功' },
            { value: 'failed', label: '失败' },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜索样本 ID 或输出"
          style={{ width: 280 }}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={fetchItems}>
          刷新
        </Button>
        {live && <Tag color="processing">每 5s 自动刷新</Tag>}
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={items}
        onRow={(row) => ({
          onClick: () => setDrawerItemId(row.id),
          style: { cursor: 'pointer' },
        })}
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

      <SampleDetailDrawer
        jobId={jobId}
        itemId={drawerItemId}
        open={drawerItemId != null}
        onClose={() => setDrawerItemId(null)}
      />
    </div>
  );
};

export default LiveItemsView;
