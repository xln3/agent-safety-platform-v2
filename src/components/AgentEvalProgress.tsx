import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Card, Progress, Tag, Table, Typography, Space, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ItemEvent {
  taskId: number;
  itemId: number;
  itemIndex: number;
  input: string;
  actualOutput: string | null;
  status: string;
  latencyMs?: number | null;
  errorMessage?: string | null;
  category?: string;
  _replay?: boolean;
}

interface JobMeta {
  jobId: number;
  status: string;
  agentName?: string;
  agentType?: string;
  apiBase?: string;
  totalItems: number;
  completedItems: number;
  totalTasks: number;
  completedTasks: number;
  startedAt?: string;
}

interface SSEEvent {
  type: string;
  data: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Category label map
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  tool_calling: '工具调用安全',
  rag_safety: 'RAG/记忆安全',
  task_planning: '任务规划安全',
  business_safety: '业务场景安全',
};

const STATUS_TAG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'default', icon: <ClockCircleOutlined />, label: '等待中' },
  running: { color: 'processing', icon: <SyncOutlined spin />, label: '运行中' },
  success: { color: 'success', icon: <CheckCircleOutlined />, label: '通过' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, label: '失败' },
  completed: { color: 'success', icon: <CheckCircleOutlined />, label: '已完成' },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AgentEvalProgressProps {
  jobId: number;
  onJobUpdate?: (meta: JobMeta) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentEvalProgress: React.FC<AgentEvalProgressProps> = ({ jobId, onJobUpdate }) => {
  const [items, setItems] = useState<ItemEvent[]>([]);
  const [meta, setMeta] = useState<JobMeta | null>(null);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const handleEvent = useCallback((event: SSEEvent) => {
    if (event.type === 'item_complete' || event.type === 'item_start') {
      if (event.type === 'item_complete') {
        setItems((prev) => {
          // Replace existing (from replay or start event) or append
          const idx = prev.findIndex((i) => i.itemId === event.data.itemId);
          const item = event.data as ItemEvent;
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = item;
            return next;
          }
          return [...prev, item];
        });

        // Update completed count
        setMeta((prev) => {
          if (!prev) return prev;
          const completedItems = event.data._replay
            ? prev.completedItems
            : prev.completedItems + 1;
          const next = { ...prev, completedItems };
          onJobUpdate?.(next);
          return next;
        });
      }
    } else if (event.type === 'task_complete') {
      setMeta((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          completedTasks: event.data._replay ? prev.completedTasks : prev.completedTasks + 1,
        };
        onJobUpdate?.(next);
        return next;
      });
    } else if (event.type === 'job_complete' || event.type === 'job_error') {
      if (event.data._initial) {
        // Initial state from SSE connect
        const m: JobMeta = {
          jobId: event.data.jobId,
          status: event.data.status,
          agentName: event.data.agentName,
          agentType: event.data.agentType,
          apiBase: event.data.apiBase,
          totalItems: event.data.totalItems || 0,
          completedItems: event.data.completedItems || 0,
          totalTasks: event.data.totalTasks || 0,
          completedTasks: event.data.completedTasks || 0,
          startedAt: event.data.startedAt,
        };
        setMeta(m);
        onJobUpdate?.(m);
      } else {
        setDone(true);
        setMeta((prev) => {
          if (!prev) return prev;
          const next = { ...prev, status: event.data.status || 'completed' };
          onJobUpdate?.(next);
          return next;
        });
      }
    }
  }, [onJobUpdate]);

  useEffect(() => {
    const es = new EventSource(`/api/eval/jobs/${jobId}/stream`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (evt) => {
      try {
        const parsed: SSEEvent = JSON.parse(evt.data);
        handleEvent(parsed);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, handleEvent]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const totalItems = meta?.totalItems || 0;
  const completedItems = meta?.completedItems || items.filter((i) => i.status === 'success' || i.status === 'failed').length;
  const percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const jobStatus = done
    ? 'completed'
    : meta?.status === 'running'
      ? 'running'
      : meta?.status || 'pending';

  const statusCfg = STATUS_TAG[jobStatus] || STATUS_TAG.pending;

  const columns: ColumnsType<ItemEvent> = [
    {
      title: '序号',
      dataIndex: 'itemIndex',
      key: 'itemIndex',
      width: 70,
      render: (v: number) => v + 1,
    },
    {
      title: '任务类型',
      dataIndex: 'category',
      key: 'category',
      width: 140,
      render: (v: string) => (
        <Tag>{CATEGORY_LABELS[v] || v}</Tag>
      ),
    },
    {
      title: '测试输入',
      dataIndex: 'input',
      key: 'input',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <span>{v}</span>
        </Tooltip>
      ),
    },
    {
      title: '测试输出',
      dataIndex: 'actualOutput',
      key: 'actualOutput',
      ellipsis: true,
      render: (v: string | null, record: ItemEvent) => {
        if (record.status === 'running') {
          return <SyncOutlined spin style={{ color: '#1677ff' }} />;
        }
        if (record.status === 'failed') {
          return <Text type="danger">{record.errorMessage || '请求失败'}</Text>;
        }
        return v ? (
          <Tooltip title={v} placement="topLeft">
            <span>{v}</span>
          </Tooltip>
        ) : '-';
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) => {
        const cfg = STATUS_TAG[v] || STATUS_TAG.pending;
        return <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag>;
      },
    },
    {
      title: '耗时',
      dataIndex: 'latencyMs',
      key: 'latencyMs',
      width: 90,
      render: (v: number | null) => v != null ? `${(v / 1000).toFixed(1)}s` : '-',
    },
  ];

  return (
    <div>
      {/* Job info card */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <Text strong style={{ fontSize: 16, marginRight: 12 }}>
              {meta?.agentName || `评估任务 #${jobId}`}
            </Text>
            <Tag color={statusCfg.color} icon={statusCfg.icon}>
              {statusCfg.label}
            </Tag>
            {!connected && !done && (
              <Tag color="warning">连接中...</Tag>
            )}
          </div>
          <Space>
            <Text type="secondary">
              {completedItems} / {totalItems} 测试项
            </Text>
          </Space>
        </div>

        <Progress
          percent={percent}
          status={
            jobStatus === 'failed' ? 'exception' :
            jobStatus === 'completed' ? 'success' :
            'active'
          }
          strokeWidth={12}
          format={() => `${completedItems}/${totalItems}`}
        />

        {meta && (
          <Space size="large" wrap style={{ marginTop: 12 }}>
            {meta.agentType && (
              <Text type="secondary">
                类型：<Text strong>
                  {meta.agentType === 'dify_chat' ? 'Dify 对话' : 'Dify 工作流'}
                </Text>
              </Text>
            )}
            {meta.apiBase && (
              <Text type="secondary">
                入口：<Text strong>{meta.apiBase}</Text>
              </Text>
            )}
            {meta.startedAt && (
              <Text type="secondary">
                开始时间：<Text strong>{new Date(meta.startedAt).toLocaleString()}</Text>
              </Text>
            )}
          </Space>
        )}
      </Card>

      {/* Real-time items table */}
      <Card title="测试项实时结果">
        <Table<ItemEvent>
          columns={columns}
          dataSource={items}
          rowKey="itemId"
          pagination={items.length > 50 ? { pageSize: 50, showSizeChanger: true } : false}
          size="small"
          scroll={{ x: 800 }}
        />
      </Card>
    </div>
  );
};

export default AgentEvalProgress;
