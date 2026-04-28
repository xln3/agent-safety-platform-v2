import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Card, Progress, Tag, List, Spin, Typography, Badge } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { evalService } from '../services/evalService';
import type { EvalJob, EvalTask } from '../services/evalService';

const { Text } = Typography;

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'default', icon: <ClockCircleOutlined />, label: '等待中' },
  running: { color: 'processing', icon: <SyncOutlined spin />, label: '运行中' },
  completed: { color: 'success', icon: <CheckCircleOutlined />, label: '已完成' },
  success: { color: 'success', icon: <CheckCircleOutlined />, label: '已完成' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, label: '失败' },
};

const RISK_COLOR_MAP: Record<string, string> = {
  CRITICAL: 'red',
  HIGH: 'orange',
  MEDIUM: 'gold',
  LOW: 'blue',
  MINIMAL: 'green',
};

interface EvalJobProgressProps {
  jobId: number;
  onJobUpdate?: (job: EvalJob) => void;
}

interface LiveTask {
  id: number;
  benchmark: string;
  taskName: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  totalSamples: number;
  completedSamples: number;
  failedSamples: number;
  safetyScore?: number | null;
  riskLevel?: string | null;
}

interface LiveSampleEvent {
  taskId: number;
  benchmark: string;
  taskName: string;
  sampleId: string;
  status: 'running' | 'success' | 'failed';
  outputPreview?: string;
  errorMessage?: string;
  latencyMs?: number;
  ts: number;
}

const RECENT_BUFFER = 8;

const EvalJobProgress: React.FC<EvalJobProgressProps> = ({ jobId, onJobUpdate }) => {
  const [job, setJob] = useState<EvalJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveTasks, setLiveTasks] = useState<Map<number, LiveTask>>(new Map());
  const [recentEvents, setRecentEvents] = useState<LiveSampleEvent[]>([]);
  const [completedItems, setCompletedItems] = useState(0);
  const [totalItems, setTotalItems] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const mergeTasks = useCallback((tasks: EvalTask[]) => {
    setLiveTasks((prev) => {
      const next = new Map(prev);
      for (const t of tasks) {
        const existing = next.get(t.id);
        next.set(t.id, {
          id: t.id,
          benchmark: t.benchmark,
          taskName: t.taskName,
          status: t.status as LiveTask['status'],
          totalSamples: t.samplesTotal ?? existing?.totalSamples ?? 0,
          completedSamples: existing?.completedSamples ?? 0,
          failedSamples: existing?.failedSamples ?? 0,
          safetyScore: t.safetyScore,
          riskLevel: t.riskLevel,
        });
      }
      return next;
    });
  }, []);

  const fetchJob = useCallback(async () => {
    try {
      const data = (await evalService.getJob(jobId)) as EvalJob;
      setJob(data);
      onJobUpdate?.(data);
      setCompletedItems(data.completedItems ?? 0);
      setTotalItems(data.totalItems ?? 0);
      if (data.tasks) mergeTasks(data.tasks);

      if (data.status !== 'running' && data.status !== 'pending') {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    } catch {
      // Error handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [jobId, onJobUpdate, mergeTasks]);

  useEffect(() => {
    fetchJob();
    // Light fallback polling — SSE handles real-time, this catches drops.
    timerRef.current = setInterval(fetchJob, 15_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchJob]);

  useEffect(() => {
    const es = evalService.openJobStream(jobId, {
      onSnapshot: (data: any) => {
        setCompletedItems(data.completedItems ?? 0);
        setTotalItems(data.totalItems ?? 0);
        if (Array.isArray(data.tasks)) {
          setLiveTasks((prev) => {
            const next = new Map(prev);
            for (const t of data.tasks) {
              const existing = next.get(t.id);
              next.set(t.id, {
                id: t.id,
                benchmark: t.benchmark,
                taskName: t.taskName,
                status: t.status,
                totalSamples: t.totalSamples ?? existing?.totalSamples ?? 0,
                completedSamples: t.completedSamples ?? existing?.completedSamples ?? 0,
                failedSamples: t.failedSamples ?? existing?.failedSamples ?? 0,
                // Server snapshot omits scoring fields; preserve the values
                // we already have (e.g. fetched via /api/eval/jobs/:id) so a
                // mid-flight reconnect doesn't blank out the score.
                safetyScore: t.safetyScore ?? existing?.safetyScore,
                riskLevel: t.riskLevel ?? existing?.riskLevel,
              });
            }
            return next;
          });
        }
      },
      onTaskStart: (data: any) => {
        setLiveTasks((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.taskId);
          next.set(data.taskId, {
            id: data.taskId,
            benchmark: data.benchmark,
            taskName: data.taskName,
            status: 'running',
            totalSamples: existing?.totalSamples ?? 0,
            completedSamples: 0,
            failedSamples: 0,
          });
          return next;
        });
      },
      onTaskFinish: (data: any) => {
        setLiveTasks((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.taskId);
          if (existing) {
            next.set(data.taskId, {
              ...existing,
              status: data.status,
              safetyScore: data.safetyScore ?? existing.safetyScore,
              riskLevel: data.riskLevel ?? existing.riskLevel,
              totalSamples: data.samplesTotal ?? existing.totalSamples,
            });
          }
          return next;
        });
      },
      onSampleStart: (data: any) => {
        setRecentEvents((prev) => {
          const next: LiveSampleEvent[] = [
            {
              taskId: data.taskId,
              benchmark: data.benchmark,
              taskName: data.taskName,
              sampleId: data.sampleId,
              status: 'running',
              ts: Date.now(),
            },
            ...prev,
          ];
          return next.slice(0, RECENT_BUFFER);
        });
      },
      onSampleFinish: (data: any) => {
        setLiveTasks((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.taskId);
          if (existing) {
            next.set(data.taskId, {
              ...existing,
              completedSamples: existing.completedSamples + 1,
              failedSamples: existing.failedSamples + (data.status === 'failed' ? 1 : 0),
            });
          }
          return next;
        });
        setCompletedItems((c) => c + 1);
        setRecentEvents((prev) => {
          const next: LiveSampleEvent[] = [
            {
              taskId: data.taskId,
              benchmark: data.benchmark,
              taskName: data.taskName,
              sampleId: data.sampleId,
              status: data.status,
              outputPreview: data.outputPreview,
              errorMessage: data.errorMessage,
              latencyMs: data.latencyMs,
              ts: Date.now(),
            },
            ...prev.filter((e) => e.sampleId !== data.sampleId),
          ];
          return next.slice(0, RECENT_BUFFER);
        });
      },
      onJobFinish: () => {
        // Final state arrives via the next fetchJob() tick; trigger immediately.
        fetchJob();
      },
      onError: () => {
        // SSE will auto-reconnect; nothing to do here besides logging.
      },
    });
    esRef.current = es;
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, fetchJob]);

  if (loading && !job) {
    return (
      <div className="flex-center" style={{ padding: 48 }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (!job) {
    return null;
  }

  const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending;
  const taskPercent =
    job.totalTasks > 0 ? Math.round((job.completedTasks / job.totalTasks) * 100) : 0;
  const itemPercent =
    totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const taskList = Array.from(liveTasks.values()).sort((a, b) => {
    if (a.benchmark !== b.benchmark) return a.benchmark.localeCompare(b.benchmark);
    return a.taskName.localeCompare(b.taskName);
  });

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <Text strong style={{ fontSize: 16, marginRight: 12 }}>
              {job.name || `评估任务 #${job.id}`}
            </Text>
            <Tag color={statusCfg.color} icon={statusCfg.icon}>
              {statusCfg.label}
            </Tag>
          </div>
          <Text type="secondary">
            {job.completedTasks} / {job.totalTasks} 任务
          </Text>
        </div>
        <Progress
          percent={taskPercent}
          status={
            job.status === 'failed'
              ? 'exception'
              : job.status === 'completed'
                ? 'success'
                : 'active'
          }
          strokeWidth={12}
          style={{ marginBottom: totalItems > 0 ? 12 : 0 }}
        />
        {totalItems > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text type="secondary">样本进度</Text>
              <Text type="secondary">
                {completedItems} / {totalItems}
              </Text>
            </div>
            <Progress
              percent={itemPercent}
              size="small"
              // Mirror job-level status — `active` keeps the moving stripe
              // animation running forever, which looked like a flicker on
              // already-finished jobs.
              status={
                job.status === 'failed'
                  ? 'exception'
                  : job.status === 'completed'
                    ? 'success'
                    : 'active'
              }
              showInfo={false}
            />
          </div>
        )}
      </Card>

      {recentEvents.length > 0 && (
        <Card size="small" title={<><ThunderboltOutlined /> 实时活动</>} style={{ marginBottom: 16 }}>
          <List
            size="small"
            dataSource={recentEvents}
            renderItem={(e) => {
              const cfg = STATUS_CONFIG[e.status] || STATUS_CONFIG.running;
              return (
                <List.Item style={{ padding: '4px 0' }}>
                  <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Badge status={e.status === 'success' ? 'success' : e.status === 'failed' ? 'error' : 'processing'} />
                    <Text style={{ minWidth: 200 }} ellipsis>
                      <Text strong>{e.benchmark}</Text> · {e.taskName}
                    </Text>
                    <Text code style={{ fontSize: 12 }}>{e.sampleId}</Text>
                    <Tag color={cfg.color}>{cfg.label}</Tag>
                    {e.latencyMs != null && (
                      <Text type="secondary" style={{ fontSize: 12 }}>{e.latencyMs}ms</Text>
                    )}
                    <Text
                      type={e.status === 'failed' ? 'danger' : 'secondary'}
                      ellipsis
                      style={{ flex: 1, fontSize: 12 }}
                    >
                      {e.errorMessage || e.outputPreview || ''}
                    </Text>
                  </div>
                </List.Item>
              );
            }}
          />
        </Card>
      )}

      {taskList.length > 0 && (
        <Card title="任务详情">
          <List
            dataSource={taskList}
            renderItem={(task) => {
              const taskStatusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
              const sampleTotal = task.totalSamples || 0;
              const samplePercent =
                sampleTotal > 0 ? Math.round((task.completedSamples / sampleTotal) * 100) : 0;

              return (
                <List.Item key={task.id}>
                  <div style={{ width: '100%' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                      }}
                    >
                      <div>
                        <Text strong>{task.benchmark}</Text>
                        <Text type="secondary" style={{ marginLeft: 8 }}>
                          {task.taskName}
                        </Text>
                        <Tag
                          color={taskStatusCfg.color}
                          icon={taskStatusCfg.icon}
                          style={{ marginLeft: 8 }}
                        >
                          {taskStatusCfg.label}
                        </Tag>
                        {task.riskLevel && (
                          <Tag
                            color={RISK_COLOR_MAP[task.riskLevel] || 'default'}
                            style={{ marginLeft: 4 }}
                          >
                            {task.riskLevel}
                          </Tag>
                        )}
                        {sampleTotal > 0 && (
                          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            {task.completedSamples}/{sampleTotal} 样本
                            {task.failedSamples > 0 && (
                              <Text type="danger" style={{ marginLeft: 4 }}>
                                · {task.failedSamples} 失败
                              </Text>
                            )}
                          </Text>
                        )}
                      </div>
                      {task.safetyScore !== undefined && task.safetyScore !== null && (
                        <Text
                          strong
                          className={
                            task.safetyScore >= 80
                              ? 'score-high'
                              : task.safetyScore >= 60
                                ? 'score-mid'
                                : 'score-low'
                          }
                        >
                          {task.safetyScore.toFixed(1)} 分
                        </Text>
                      )}
                    </div>
                    {task.status === 'running' && sampleTotal > 0 && (
                      <Progress percent={samplePercent} size="small" status="active" />
                    )}
                  </div>
                </List.Item>
              );
            }}
          />
        </Card>
      )}
    </div>
  );
};

export default EvalJobProgress;
