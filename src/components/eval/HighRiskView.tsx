import React, { useState, useEffect, useCallback } from 'react';
import { Spin, Button, Typography } from 'antd';
import type { JobResultData, TaskResultItem, SampleItem } from '../../services/evalService';
import { evalService } from '../../services/evalService';
import RiskLevelBadge from '../RiskLevelBadge';

const { Text } = Typography;

const getRiskFromScore = (score: number | null): string => {
  if (score === null) return 'MEDIUM';
  if (score <= 0.2) return 'CRITICAL';
  if (score <= 0.4) return 'HIGH';
  if (score <= 0.6) return 'MEDIUM';
  if (score <= 0.8) return 'LOW';
  return 'MINIMAL';
};

interface HighRiskViewProps {
  result: JobResultData;
  initialTaskId?: number | null;
}

interface HighRiskSample extends SampleItem {
  riskLevel: string;
}

const HighRiskView: React.FC<HighRiskViewProps> = ({ result, initialTaskId }) => {
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(initialTaskId || null);
  const [samples, setSamples] = useState<HighRiskSample[]>([]);
  const [loading, setLoading] = useState(false);

  // Filter to CRITICAL/HIGH tasks
  const highRiskTasks = (result.tasks || []).filter(
    (t) => t.riskLevel === 'CRITICAL' || t.riskLevel === 'HIGH',
  );

  // Group by benchmark
  const groupedTasks = new Map<string, TaskResultItem[]>();
  highRiskTasks.forEach((task) => {
    const group = groupedTasks.get(task.benchmark) || [];
    group.push(task);
    groupedTasks.set(task.benchmark, group);
  });

  // Load samples
  const loadSamples = useCallback(async () => {
    if (!selectedTaskId || !result.job?.id) return;
    setLoading(true);
    try {
      const data = await evalService.getTaskSamples(result.job.id, selectedTaskId, {
        page: 1,
        pageSize: 200,
      });
      const all: HighRiskSample[] = (data.samples || []).map((s) => ({
        ...s,
        riskLevel: getRiskFromScore(s.score),
      }));
      // Only show high-risk samples
      setSamples(all.filter((s) => s.riskLevel === 'CRITICAL' || s.riskLevel === 'HIGH'));
    } catch {
      setSamples([]);
    } finally {
      setLoading(false);
    }
  }, [selectedTaskId, result.job?.id]);

  useEffect(() => {
    loadSamples();
  }, [loadSamples]);

  useEffect(() => {
    if (initialTaskId) setSelectedTaskId(initialTaskId);
  }, [initialTaskId]);

  const selectedTask = highRiskTasks.find((t) => t.id === selectedTaskId);

  return (
    <div>
      {/* Task Selector */}
      <div className="eval-section">
        <div className="eval-section-title">高危任务列表</div>
        {highRiskTasks.length === 0 ? (
          <div className="flex-center" style={{ padding: 24, color: '#999' }}>
            无高危任务
          </div>
        ) : (
          Array.from(groupedTasks.entries()).map(([benchmark, tasks]) => (
            <div key={benchmark} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#999', marginBottom: 6 }}>
                {benchmark}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {tasks.map((task) => (
                  <Button
                    key={task.id}
                    size="small"
                    danger={selectedTaskId === task.id}
                    type={selectedTaskId === task.id ? 'primary' : 'default'}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    {task.taskName}
                    <RiskLevelBadge
                      level={task.riskLevel!}
                      style={{ marginLeft: 6, fontSize: 10, padding: '0 6px' }}
                    />
                  </Button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Selected Task Info */}
      {selectedTask && (
        <div className="eval-section">
          <div className="eval-section-title">
            {selectedTask.taskName}
            <RiskLevelBadge level={selectedTask.riskLevel!} style={{ marginLeft: 12 }} />
          </div>
          {selectedTask.interpretation && (
            <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
              {selectedTask.interpretation}
            </Text>
          )}
          <Text style={{ fontSize: 13, color: '#666' }}>
            安全评分：
            <span style={{ fontWeight: 700, color: selectedTask.safetyScore && selectedTask.safetyScore >= 60 ? '#52c41a' : '#ff4d4f' }}>
              {selectedTask.safetyScore?.toFixed(1) ?? '-'}
            </span>
            <span style={{ marginLeft: 16 }}>
              样本：{selectedTask.samplesPassed}/{selectedTask.samplesTotal}
            </span>
          </Text>
        </div>
      )}

      {/* High-Risk Sample Cards */}
      {selectedTaskId && loading && (
        <div className="flex-center" style={{ padding: 40 }}>
          <Spin tip="加载高危案例..." />
        </div>
      )}

      {selectedTaskId && !loading && samples.length > 0 && (
        <div>
          {samples.map((sample, i) => (
            <div
              key={sample.id || i}
              className="eval-section"
              style={{ borderLeft: `3px solid ${sample.riskLevel === 'CRITICAL' ? '#ef4444' : '#f97316'}` }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    案例 #{sample.id}
                  </Text>
                  <RiskLevelBadge level={sample.riskLevel} />
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  得分：{sample.score != null ? sample.score.toFixed(2) : '-'}
                </Text>
              </div>

              {sample.input && (
                <div style={{ marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 12, color: '#666' }}>攻击输入</Text>
                  <div className="sample-block">
                    {sample.input}
                  </div>
                </div>
              )}

              {sample.output && (
                <div>
                  <Text strong style={{ fontSize: 12, color: '#666' }}>模型响应</Text>
                  <div className={`sample-block ${sample.riskLevel === 'CRITICAL' || sample.riskLevel === 'HIGH' ? 'sample-block-fail' : 'sample-block-pass'}`}>
                    {sample.output}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedTaskId && !loading && samples.length === 0 && (
        <div className="flex-center" style={{ padding: 40, color: '#999' }}>
          未发现高危样本
        </div>
      )}
    </div>
  );
};

export default HighRiskView;
