import React, { useState, useEffect, useCallback } from 'react';
import { Spin, Button, Tag, Typography, Card, Descriptions } from 'antd';
import type { JobResultData, TaskResultItem, SampleItem } from '../../services/evalService';
import { evalService } from '../../services/evalService';
import RiskLevelBadge from '../RiskLevelBadge';
import SafetyScoreGauge from '../SafetyScoreGauge';

const { Text, Paragraph } = Typography;

const ALL_RISK_LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'MINIMAL'];

const RISK_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  MINIMAL: 4,
};

const getRiskFromScore = (score: number | null): string => {
  if (score === null) return 'MEDIUM';
  if (score <= 0.2) return 'CRITICAL';
  if (score <= 0.4) return 'HIGH';
  if (score <= 0.6) return 'MEDIUM';
  if (score <= 0.8) return 'LOW';
  return 'MINIMAL';
};

const getScoreColorClass = (score: number | null): string => {
  if (score === null) return '';
  if (score <= 0.3) return 'score-low';
  if (score <= 0.6) return 'score-mid';
  return 'score-high';
};

interface SingleBenchmarkViewProps {
  result: JobResultData;
  initialTaskId?: number | null;
  initialTaskName?: string | null;
}

interface DisplaySample extends SampleItem {
  riskLevel: string;
  passed: boolean;
}

const SingleBenchmarkView: React.FC<SingleBenchmarkViewProps> = ({
  result,
  initialTaskId,
  initialTaskName,
}) => {
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(initialTaskId || null);
  const [samples, setSamples] = useState<DisplaySample[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [totalSamples, setTotalSamples] = useState(0);

  // Filter and sort state
  const [riskFilter, setRiskFilter] = useState<Set<string>>(new Set(ALL_RISK_LEVELS));
  const [sortKey, setSortKey] = useState<'score' | 'risk' | 'id'>('score');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [expandedSample, setExpandedSample] = useState<string | null>(null);
  const perPage = 20;

  // Group tasks by benchmark
  const groupedTasks = new Map<string, TaskResultItem[]>();
  (result.tasks || []).forEach((task) => {
    const group = groupedTasks.get(task.benchmark) || [];
    group.push(task);
    groupedTasks.set(task.benchmark, group);
  });

  const selectedTask = (result.tasks || []).find((t) => t.id === selectedTaskId);

  // Load samples when task selected
  const loadSamples = useCallback(async () => {
    if (!selectedTaskId || !result.job?.id) return;
    setSamplesLoading(true);
    try {
      const data = await evalService.getTaskSamples(result.job.id, selectedTaskId, {
        page: 1,
        pageSize: 200,
      });
      const displaySamples: DisplaySample[] = (data.samples || []).map((s) => ({
        ...s,
        riskLevel: getRiskFromScore(s.score),
        passed: s.score !== null && s.score >= 0.5,
      }));
      setSamples(displaySamples);
      setTotalSamples(data.pagination?.total || displaySamples.length);
    } catch {
      setSamples([]);
    } finally {
      setSamplesLoading(false);
    }
  }, [selectedTaskId, result.job?.id]);

  useEffect(() => {
    loadSamples();
    setPage(0);
    setExpandedSample(null);
  }, [loadSamples]);

  // Use initialTaskId on mount
  useEffect(() => {
    if (initialTaskId) setSelectedTaskId(initialTaskId);
  }, [initialTaskId]);

  const handleSelectTask = (taskId: number) => {
    setSelectedTaskId(taskId);
    setPage(0);
    setExpandedSample(null);
  };

  const handleFilterToggle = (level: string) => {
    setRiskFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
    setPage(0);
    setExpandedSample(null);
  };

  const handleSort = (key: 'score' | 'risk' | 'id') => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
    setPage(0);
    setExpandedSample(null);
  };

  // Filter and sort
  const filteredSamples = samples
    .filter((s) => riskFilter.size === 0 || riskFilter.has(s.riskLevel))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'score') {
        cmp = (a.score ?? 1) - (b.score ?? 1);
      } else if (sortKey === 'risk') {
        cmp = (RISK_ORDER[a.riskLevel] ?? 5) - (RISK_ORDER[b.riskLevel] ?? 5);
      } else {
        cmp = String(a.id || '').localeCompare(String(b.id || ''));
      }
      return sortAsc ? cmp : -cmp;
    });

  const totalPages = Math.ceil(filteredSamples.length / perPage);
  const pageItems = filteredSamples.slice(page * perPage, (page + 1) * perPage);

  const sortIcon = (col: string) => {
    if (sortKey !== col) return <span style={{ color: '#ccc', marginLeft: 4 }}>↕</span>;
    return (
      <span style={{ color: '#1677ff', marginLeft: 4 }}>
        {sortAsc ? '↑' : '↓'}
      </span>
    );
  };

  return (
    <div>
      {/* Task Sidebar */}
      <div className="eval-section">
        <div className="eval-section-title">选择任务</div>
        {Array.from(groupedTasks.entries()).map(([benchmark, tasks]) => (
          <div key={benchmark} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#999', marginBottom: 6 }}>
              {benchmark}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tasks.map((task) => (
                <Button
                  key={task.id}
                  size="small"
                  type={selectedTaskId === task.id ? 'primary' : 'default'}
                  onClick={() => handleSelectTask(task.id)}
                >
                  {task.taskName}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Task Summary */}
      {selectedTask && (
        <div className="eval-section">
          <div className="eval-section-title">{selectedTask.taskName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <SafetyScoreGauge
                score={selectedTask.safetyScore ?? 0}
                riskLevel={selectedTask.riskLevel || 'MEDIUM'}
                size={90}
                label=""
              />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                {selectedTask.riskLevel && (
                  <RiskLevelBadge level={selectedTask.riskLevel} />
                )}
                <Text style={{ fontSize: 13, color: '#666' }}>
                  样本：{selectedTask.samplesPassed}/{selectedTask.samplesTotal}
                </Text>
              </div>
              {selectedTask.interpretation && (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {selectedTask.interpretation}
                </Text>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sample Table */}
      {selectedTaskId && (
        <div className="eval-section">
          <div className="eval-section-title">
            样本详情（{samplesLoading ? '...' : `${filteredSamples.length}/${samples.length}`}）
          </div>

          {/* Risk Level Filter Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#999' }}>风险筛选：</span>
            {ALL_RISK_LEVELS.map((level) => (
              <Button
                key={level}
                size="small"
                type={riskFilter.has(level) ? 'primary' : 'default'}
                ghost={riskFilter.has(level)}
                onClick={() => handleFilterToggle(level)}
                style={{ fontSize: 11, padding: '0 8px', height: 24, borderRadius: 12 }}
              >
                {level === 'CRITICAL' ? '极危' : level === 'HIGH' ? '高危' : level === 'MEDIUM' ? '中危' : level === 'LOW' ? '低危' : '极低'}
              </Button>
            ))}
            <Button
              size="small"
              type="text"
              onClick={() => { setRiskFilter(new Set(ALL_RISK_LEVELS)); setPage(0); }}
              style={{ fontSize: 11 }}
            >
              全部
            </Button>
            <Button
              size="small"
              type="text"
              onClick={() => { setRiskFilter(new Set(['CRITICAL', 'HIGH'])); setPage(0); }}
              style={{ fontSize: 11 }}
            >
              仅高危
            </Button>
          </div>

          {samplesLoading ? (
            <div className="flex-center" style={{ padding: 40 }}>
              <Spin />
            </div>
          ) : filteredSamples.length > 0 ? (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                      <th
                        style={{ textAlign: 'left', padding: '8px', color: '#666', fontWeight: 600, width: 50, cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('id')}
                      >
                        # {sortIcon('id')}
                      </th>
                      <th
                        style={{ textAlign: 'right', padding: '8px', color: '#666', fontWeight: 600, width: 70, cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('score')}
                      >
                        得分 {sortIcon('score')}
                      </th>
                      <th
                        style={{ textAlign: 'center', padding: '8px', color: '#666', fontWeight: 600, width: 80, cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('risk')}
                      >
                        风险 {sortIcon('risk')}
                      </th>
                      <th style={{ textAlign: 'left', padding: '8px', color: '#666', fontWeight: 600 }}>
                        输入
                      </th>
                      <th style={{ textAlign: 'left', padding: '8px', color: '#666', fontWeight: 600 }}>
                        输出
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((sample, i) => {
                      const sid = sample.id || String(page * perPage + i + 1);
                      const isExpanded = expandedSample === sid;
                      const rowBg = sample.riskLevel === 'CRITICAL'
                        ? '#fff1f0'
                        : sample.riskLevel === 'HIGH'
                          ? '#fff7e6'
                          : undefined;
                      return (
                        <tr
                          key={sid}
                          onClick={() => setExpandedSample(isExpanded ? null : sid)}
                          style={{
                            borderBottom: '1px solid #f0f0f0',
                            cursor: 'pointer',
                            background: isExpanded ? '#f5f5f5' : rowBg,
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            if (!isExpanded) e.currentTarget.style.background = '#fafafa';
                          }}
                          onMouseLeave={(e) => {
                            if (!isExpanded)
                              e.currentTarget.style.background = rowBg || '';
                          }}
                        >
                          <td style={{ padding: '8px', fontSize: 12, color: '#999', fontFamily: 'monospace' }}>
                            {sid}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            <span className={getScoreColorClass(sample.score)} style={{ fontWeight: 600 }}>
                              {sample.score != null ? sample.score.toFixed(2) : '-'}
                            </span>
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <RiskLevelBadge level={sample.riskLevel} />
                          </td>
                          <td style={{ padding: '8px', maxWidth: 250 }}>
                            <div
                              style={{
                                fontSize: 12,
                                color: '#555',
                                ...(isExpanded
                                  ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
                                  : {
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }),
                              }}
                            >
                              {sample.input || '-'}
                            </div>
                          </td>
                          <td style={{ padding: '8px', maxWidth: 250 }}>
                            <div
                              style={{
                                fontSize: 12,
                                color: '#555',
                                ...(isExpanded
                                  ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
                                  : {
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }),
                              }}
                            >
                              {sample.output || '-'}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 16,
                  }}
                >
                  <span style={{ fontSize: 12, color: '#999' }}>
                    显示 {page * perPage + 1}-
                    {Math.min((page + 1) * perPage, filteredSamples.length)}{' '}
                    / 共 {filteredSamples.length} 条
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Button size="small" disabled={page === 0} onClick={() => setPage(0)}>
                      ««
                    </Button>
                    <Button
                      size="small"
                      disabled={page === 0}
                      onClick={() => setPage(Math.max(0, page - 1))}
                    >
                      «
                    </Button>
                    <span style={{ fontSize: 12, color: '#666', padding: '0 4px' }}>
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      size="small"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    >
                      »
                    </Button>
                    <Button
                      size="small"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(totalPages - 1)}
                    >
                      »»
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-center" style={{ padding: 40, color: '#999' }}>
              {samples.length === 0 ? '暂无样本数据' : '当前筛选条件无匹配样本'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SingleBenchmarkView;
