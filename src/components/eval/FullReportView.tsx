import React from 'react';
import { Card, Button, Row, Col, Tag } from 'antd';
import type { JobResultData, TaskResultItem } from '../../services/evalService';
import EvalRadarChart from '../EvalRadarChart';
import AssessmentSummary from './AssessmentSummary';
import AssessmentBadge from './AssessmentBadge';
import AssessmentBar from './AssessmentBar';

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
  /**
   * 仅采样模式 — V1 `skipJudge=true` 提交的 job 不调裁判，因此没有 score。
   * 这种模式下隐藏综合分卡片、雷达图、基准评分、改进项等评分相关 UI，
   * 只保留任务列表和样本入口。
   */
  unscored?: boolean;
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
  unscored = false,
  onSelectTask,
  onHighRiskDetail,
  onGenerateReport,
  generating,
}) => {
  const overallScore = result.aggregate.overallSafetyScore ?? 0;
  const riskDistribution = result.aggregate.riskDistribution || {};
  const overallRisk = getOverallRisk(riskDistribution);
  const aggregateStatus = result.aggregate.aggregateStatus ?? 'sufficient';
  const failedTaskCount = result.aggregate.failedTaskCount ?? 0;
  // Stars only meaningful when coverage is sufficient — otherwise hide rating
  // (avoids showing "⭐⭐⭐⭐⭐ 稳健" on a job where 2/3 subtasks silently failed).
  const stars = aggregateStatus === 'sufficient' ? getStars(overallScore) : 0;
  const showStars = aggregateStatus === 'sufficient';
  const tierOverride =
    aggregateStatus === 'no_data'
      ? ('no_data' as const)
      : aggregateStatus === 'insufficient'
        ? ('insufficient' as const)
        : undefined;

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
      {/* Overview Section — 仅采样模式下没有综合分，改成基本信息提示卡 */}
      {unscored ? (
        <div className="eval-section">
          <div className="eval-section-title">
            概览 <Tag style={{ marginLeft: 8 }}>仅采样</Tag>
          </div>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.8 }}>
            <div>
              本次评估以「仅采样」模式运行，未调用裁判模型，因此没有综合分 / 风险分布 / 维度评估。
            </div>
            <div>
              共 {result.aggregate.totalTaskCount} 个任务{result.job?.createdAt
                ? `，评估时间 ${new Date(result.job.createdAt).toLocaleString('zh-CN')}`
                : ''}。可通过下方任务列表进入「单项基准」查看 prompt / 标准答案 / 模型输出。
            </div>
          </div>
        </div>
      ) : (
        <div className="eval-section">
          <div className="eval-section-title">概览</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <AssessmentSummary
              score={overallScore}
              riskLevel={overallRisk}
              tierOverride={tierOverride}
              caption={
                <>
                  <div>
                    {result.aggregate.scoredTaskCount} / {result.aggregate.totalTaskCount} 个任务已产出结论
                  </div>
                  {failedTaskCount > 0 && (
                    <div style={{ color: '#b91c1c', marginTop: 2 }}>
                      {failedTaskCount} 个任务未出分（请检查裁判模型 / JUDGE_MODEL_NAME 配置）
                    </div>
                  )}
                </>
              }
            />
            <div>
              {showStars ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span className="star-rating" aria-hidden>
                    {'★'.repeat(stars)}
                    <span className="star-empty">{'★'.repeat(5 - stars)}</span>
                  </span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>评级强度（5 星制）</span>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600 }}>
                    ⚠ 数据覆盖率 {Math.round((result.aggregate.coverage ?? 0) * 100)}% — 暂不评定星级
                  </span>
                </div>
              )}
              <div style={{ fontSize: 13, color: '#666' }}>
                {result.job?.createdAt && (
                  <span>
                    评估时间：{new Date(result.job.createdAt).toLocaleString('zh-CN')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Radar Chart + Benchmark Cards — 仅采样模式无评分可展示 */}
      {!unscored && (
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="评估维度雷达图" size="small">
            <EvalRadarChart data={radarData} height={320} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="基准测试评分" size="small">
            <div>
              {benchmarkCards.map((bm) => (
                <div className="benchmark-row" key={bm.benchmark}>
                  <div className="benchmark-row-label">
                    <div className="benchmark-name">{bm.benchmark}</div>
                    {bm.riskLevel && <AssessmentBadge riskLevel={bm.riskLevel} size="small" />}
                  </div>
                  <div className="benchmark-row-bar">
                    <AssessmentBar score={bm.avgScore} riskLevel={bm.riskLevel} height={10} />
                    <div className="benchmark-row-meta">
                      {bm.sampleCount > 0 && <span>{bm.sampleCount} 样本</span>}
                      {bm.interpretation && (
                        <span style={{ marginLeft: bm.sampleCount > 0 ? 12 : 0 }}>
                          {bm.interpretation}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
      )}

      {/* Score Table — grouped by benchmark. In 仅采样 mode the score / risk
          columns become a single "仅采样" tag and 样本数 turns into a flat
          sample count (no passed/total ratio because there is no judge). */}
      <div className="eval-section">
        <div className="eval-section-title">{unscored ? '任务列表' : '评分详情'}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#666' }}>
                  任务名称
                </th>
                {!unscored && (
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: '#666', width: 160 }}>
                    评估趋势
                  </th>
                )}
                <th style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, color: '#666', width: 96 }}>
                  {unscored ? '状态' : '评估等级'}
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
                      colSpan={unscored ? 3 : 4}
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
                      {!unscored && (
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {task.safetyScore !== null ? (
                            <AssessmentBar
                              score={task.safetyScore}
                              riskLevel={task.riskLevel}
                              maxWidth="160px"
                            />
                          ) : (
                            <span style={{ color: '#999' }}>-</span>
                          )}
                        </td>
                      )}
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {unscored ? (
                          <Tag>仅采样</Tag>
                        ) : task.riskLevel ? (
                          <AssessmentBadge riskLevel={task.riskLevel} size="small" />
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
                        {unscored
                          ? task.samplesTotal
                          : `${task.samplesPassed}/${task.samplesTotal}`}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Improvement queue (formerly "高危任务"). Wording softened so the badge
          drives prioritisation, not a "高危" label. Hidden in 仅采样 mode where
          there is no riskLevel to prioritize. */}
      {!unscored && highRiskTasks.length > 0 && (
        <div className="eval-section">
          <div className="eval-section-title">
            重点改进项（{highRiskTasks.length} 项需优先处理）
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
                  <AssessmentBadge riskLevel={task.riskLevel!} size="small" />
                  <Button
                    type="link"
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

      {/* Generate Report — 仅采样模式没有可生成的报告 */}
      {!unscored && (
        <div style={{ marginTop: 16 }}>
          <Button type="primary" onClick={onGenerateReport} loading={generating}>
            {generating ? '正在生成报告...' : '生成评估报告'}
          </Button>
        </div>
      )}
    </div>
  );
};

export default FullReportView;
