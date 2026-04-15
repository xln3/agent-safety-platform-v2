import React from 'react';
import { Card, Button, Row, Col } from 'antd';
import type { JobResultData, TaskResultItem } from '../../services/evalService';
import SafetyScoreGauge from '../SafetyScoreGauge';
import RiskLevelBadge from '../RiskLevelBadge';
import EvalRadarChart from '../EvalRadarChart';
import EvalScoreCard from '../EvalScoreCard';
import ScoreBar from '../ScoreBar';

interface BenchmarkSummary {
  benchmark: string;
  avgScore: number;
  riskLevel: string | null;
  taskCount: number;
  sampleCount: number;
  interpretation: string | null;
}

interface FullReportViewProps {
  result: JobResultData;
  onSelectTask: (taskId: number, taskName: string) => void;
  onHighRiskDetail: (taskId: number, taskName: string) => void;
  onGenerateReport: () => void;
  generating: boolean;
}

const getStars = (score: number): number => {
  if (score >= 90) return 5;
  if (score >= 80) return 4;
  if (score >= 70) return 3;
  if (score >= 60) return 2;
  if (score >= 40) return 1;
  return 0;
};

const getOverallRisk = (dist: Record<string, number>): string => {
  if (dist['CRITICAL']) return 'CRITICAL';
  if (dist['HIGH']) return 'HIGH';
  if (dist['MEDIUM']) return 'MEDIUM';
  if (dist['LOW']) return 'LOW';
  if (dist['MINIMAL']) return 'MINIMAL';
  return 'MEDIUM';
};

const FullReportView: React.FC<FullReportViewProps> = ({
  result,
  onSelectTask,
  onHighRiskDetail,
  onGenerateReport,
  generating,
}) => {
  const overallScore = result.aggregate.overallSafetyScore ?? 0;
  const riskDistribution = result.aggregate.riskDistribution || {};
  const overallRisk = getOverallRisk(riskDistribution);
  const stars = getStars(overallScore);

  // Build radar data
  const benchmarkMap = new Map<string, number[]>();
  (result.tasks || []).forEach((task) => {
    if (task.safetyScore !== null) {
      const existing = benchmarkMap.get(task.benchmark) || [];
      existing.push(task.safetyScore);
      benchmarkMap.set(task.benchmark, existing);
    }
  });

  const radarData = Array.from(benchmarkMap.entries()).map(([benchmark, scores]) => ({
    benchmark,
    score: scores.reduce((sum, s) => sum + s, 0) / scores.length,
  }));

  const benchmarkCards: BenchmarkSummary[] = Array.from(benchmarkMap.entries()).map(
    ([benchmark, scores]) => {
      const benchmarkTasks = (result.tasks || []).filter((t) => t.benchmark === benchmark);
      const totalSamples = benchmarkTasks.reduce((s, t) => s + t.samplesTotal, 0);
      return {
        benchmark,
        avgScore: scores.reduce((sum, s) => sum + s, 0) / scores.length,
        riskLevel: benchmarkTasks[0]?.riskLevel || null,
        taskCount: benchmarkTasks.length,
        sampleCount: totalSamples,
        interpretation: benchmarkTasks[0]?.interpretation || null,
      };
    },
  );

  // High risk tasks
  const highRiskTasks = (result.tasks || []).filter(
    (t) => t.riskLevel === 'CRITICAL' || t.riskLevel === 'HIGH',
  );

  // Group tasks by benchmark for the score table
  const groupedTasks = new Map<string, TaskResultItem[]>();
  (result.tasks || []).forEach((task) => {
    const group = groupedTasks.get(task.benchmark) || [];
    group.push(task);
    groupedTasks.set(task.benchmark, group);
  });

  return (
    <div>
      {/* Overview Section */}
      <div className="eval-section">
        <div className="eval-section-title">概览</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <SafetyScoreGauge score={overallScore} riskLevel={overallRisk} size={120} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <RiskLevelBadge level={overallRisk} />
              <span className="star-rating">
                {'★'.repeat(stars)}
                <span className="star-empty">{'★'.repeat(5 - stars)}</span>
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#666' }}>
              {result.aggregate.scoredTaskCount} / {result.aggregate.totalTaskCount} 个任务已评分
              {result.job?.createdAt && (
                <span style={{ marginLeft: 12 }}>
                  评估时间：{new Date(result.job.createdAt).toLocaleString('zh-CN')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Radar Chart + Benchmark Cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="评估维度雷达图" size="small">
            <EvalRadarChart data={radarData} height={320} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="基准测试评分" size="small">
            <Row gutter={[12, 12]}>
              {benchmarkCards.map((bm) => (
                <Col xs={12} key={bm.benchmark}>
                  <EvalScoreCard
                    benchmark={bm.benchmark}
                    name={bm.benchmark}
                    score={bm.avgScore}
                    riskLevel={bm.riskLevel}
                    interpretation={bm.interpretation}
                    sampleCount={bm.sampleCount}
                  />
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>

      {/* Score Table — grouped by benchmark */}
      <div className="eval-section">
        <div className="eval-section-title">评分详情</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#666' }}>
                  任务名称
                </th>
                <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: '#666', width: 80 }}>
                  安全评分
                </th>
                <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, color: '#666', width: 80 }}>
                  风险等级
                </th>
                <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: '#666', width: 80 }}>
                  样本数
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from(groupedTasks.entries()).map(([benchmark, tasks]) => (
                <React.Fragment key={benchmark}>
                  <tr>
                    <td
                      colSpan={4}
                      style={{ paddingTop: 12, paddingBottom: 4 }}
                    >
                      <div className="group-header-label">
                        <span className="group-bm">{benchmark}</span>
                        <span className="group-sub" style={{ marginLeft: 8 }}>
                          ({tasks.length} 个任务)
                        </span>
                      </div>
                    </td>
                  </tr>
                  {tasks.map((task) => (
                    <tr
                      key={task.id}
                      style={{
                        borderBottom: '1px solid #f0f0f0',
                        cursor: 'pointer',
                      }}
                      onClick={() => onSelectTask(task.id, task.taskName)}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#fafafa')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    >
                      <td style={{ padding: '8px 12px 8px 24px', color: '#1677ff' }}>
                        {task.taskName}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        {task.safetyScore !== null ? (
                          <ScoreBar score={task.safetyScore} maxWidth="120px" />
                        ) : (
                          <span style={{ color: '#999' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {task.riskLevel ? (
                          <RiskLevelBadge level={task.riskLevel} />
                        ) : (
                          <span style={{ color: '#999' }}>-</span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          textAlign: 'right',
                          color: '#666',
                        }}
                      >
                        {task.samplesPassed}/{task.samplesTotal}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Risk Analysis */}
      {highRiskTasks.length > 0 && (
        <div className="eval-section">
          <div className="eval-section-title">
            风险分析（{highRiskTasks.length} 个高危任务）
          </div>
          <div>
            {highRiskTasks.map((task) => (
              <div key={task.id} className="high-risk-card">
                <div className="high-risk-info">
                  <div className="high-risk-name">{task.taskName}</div>
                  {task.interpretation && (
                    <div className="high-risk-desc">{task.interpretation}</div>
                  )}
                </div>
                <div className="high-risk-actions">
                  <RiskLevelBadge level={task.riskLevel!} />
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={() => onHighRiskDetail(task.id, task.taskName)}
                  >
                    查看案例
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate Report */}
      <div style={{ marginTop: 16 }}>
        <Button type="primary" onClick={onGenerateReport} loading={generating}>
          {generating ? '正在生成报告...' : '生成评估报告'}
        </Button>
      </div>
    </div>
  );
};

export default FullReportView;
