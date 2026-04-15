import React, { useEffect, useRef, useCallback } from 'react';
import { Card, Progress, Tag, List, Spin, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
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

const EvalJobProgress: React.FC<EvalJobProgressProps> = ({ jobId, onJobUpdate }) => {
  const [job, setJob] = React.useState<EvalJob | null>(null);
  const [loading, setLoading] = React.useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJob = useCallback(async () => {
    try {
      const data = await evalService.getJob(jobId) as EvalJob;
      setJob(data);
      onJobUpdate?.(data);

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
  }, [jobId, onJobUpdate]);

  useEffect(() => {
    fetchJob();
    timerRef.current = setInterval(fetchJob, 3000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [fetchJob]);

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
  const percent =
    job.totalTasks > 0
      ? Math.round((job.completedTasks / job.totalTasks) * 100)
      : 0;

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
          percent={percent}
          status={
            job.status === 'failed'
              ? 'exception'
              : job.status === 'completed'
                ? 'success'
                : 'active'
          }
          strokeWidth={12}
          style={{ marginBottom: 0 }}
        />
      </Card>

      {job.tasks && job.tasks.length > 0 && (
        <Card title="任务详情">
          <List
            dataSource={job.tasks}
            renderItem={(task: EvalTask) => {
              const taskStatus = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
              const taskPercent =
                task.samplesTotal > 0
                  ? Math.round((task.samplesPassed / task.samplesTotal) * 100)
                  : 0;

              return (
                <List.Item>
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
                          color={taskStatus.color}
                          icon={taskStatus.icon}
                          style={{ marginLeft: 8 }}
                        >
                          {taskStatus.label}
                        </Tag>
                        {task.riskLevel && (
                          <Tag
                            color={RISK_COLOR_MAP[task.riskLevel] || 'default'}
                            style={{ marginLeft: 4 }}
                          >
                            {task.riskLevel}
                          </Tag>
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
                    {task.status === 'running' && (
                      <Progress
                        percent={taskPercent}
                        size="small"
                        status="active"
                      />
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
