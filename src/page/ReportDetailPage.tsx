import React, { useEffect, useState } from 'react';
import {
  Card,
  Tag,
  Button,
  Space,
  Spin,
  Empty,
  Typography,
  Row,
  Col,
} from 'antd';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  PrinterOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { reportService } from '../services/reportService';
import type { Report } from '../services/reportService';
import EvalRadarChart from '../components/EvalRadarChart';
import SafetyScoreGauge from '../components/SafetyScoreGauge';
import RiskLevelBadge from '../components/RiskLevelBadge';
import ScoreBar from '../components/ScoreBar';
import ReportSummaryCards from '../components/ReportSummaryCards';
import ReportCategoryDetailComp from '../components/ReportCategoryDetail';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  draft: { color: 'default', label: '草稿' },
  generating: { color: 'processing', label: '生成中' },
  ready: { color: 'success', label: '已完成' },
};

const getRiskFromScore = (score: number): string => {
  if (score >= 80) return 'MINIMAL';
  if (score >= 60) return 'LOW';
  if (score >= 40) return 'MEDIUM';
  if (score >= 20) return 'HIGH';
  return 'CRITICAL';
};

const getStars = (score: number): number => {
  if (score >= 90) return 5;
  if (score >= 80) return 4;
  if (score >= 70) return 3;
  if (score >= 60) return 2;
  if (score >= 40) return 1;
  return 0;
};

const ReportDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const fetchReport = async () => {
      setLoading(true);
      try {
        const data = await reportService.getById(parseInt(id, 10));
        setReport(data);
      } catch {
        // Handled by interceptor
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [id]);

  const handleDownload = () => {
    if (!report?.content) return;
    const blob = new Blob([report.content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.title || 'report'}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex-center" style={{ padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!report) {
    return <Empty description="报告不存在" />;
  }

  const statusCfg = STATUS_MAP[report.status] || STATUS_MAP.draft;
  const summary = report.summary;
  const overallScore = summary?.overallScore ?? 0;
  const riskLevel = getRiskFromScore(overallScore);
  const stars = getStars(overallScore);

  const radarData =
    summary?.categories?.map((cat) => ({
      benchmark: cat.name,
      score: cat.score,
    })) || [];

  const categoryDetails = summary?.categoryDetails || {};

  const highRiskTasks: Array<{
    category: string;
    taskName: string;
    riskLevel: string;
    score: number;
    interpretation: string | null;
  }> = [];
  for (const [, detail] of Object.entries(categoryDetails)) {
    for (const task of detail.tasks) {
      if (task.riskLevel === 'CRITICAL' || task.riskLevel === 'HIGH') {
        highRiskTasks.push({
          category: detail.name,
          taskName: task.taskName,
          riskLevel: task.riskLevel,
          score: task.score,
          interpretation: task.interpretation,
        });
      }
    }
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/reports')}
          >
            返回
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            {report.title || '评估报告'}
          </Title>
          <Tag color={statusCfg.color}>{statusCfg.label}</Tag>
        </Space>
        <Space className="no-print">
          <Button
            icon={<DownloadOutlined />}
            onClick={handleDownload}
            disabled={!report.content}
          >
            下载
          </Button>
          <Button icon={<PrinterOutlined />} onClick={handlePrint}>
            打印
          </Button>
        </Space>
      </div>

      {summary ? (
        <>
          {/* Overview Section */}
          <div className="eval-section" style={{ marginBottom: 24 }}>
            <div className="eval-section-title">综合概览</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
              <SafetyScoreGauge
                score={overallScore}
                riskLevel={riskLevel}
                size={140}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <RiskLevelBadge level={riskLevel} />
                  <span className="star-rating">
                    {'★'.repeat(stars)}
                    <span className="star-empty">
                      {'★'.repeat(5 - stars)}
                    </span>
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
                  {report.agentName && (
                    <span style={{ marginRight: 16 }}>
                      智能体：{report.agentName}
                    </span>
                  )}
                  {summary.generatedAt && (
                    <span>
                      生成时间：
                      {dayjs(summary.generatedAt).format('YYYY-MM-DD HH:mm')}
                    </span>
                  )}
                </div>
                <ReportSummaryCards
                  overallScore={overallScore}
                  totalTasks={summary.totalTasks}
                  samplesPassed={summary.samplesPassed}
                  samplesTotal={summary.samplesTotal}
                  passRate={summary.passRate}
                />
              </div>
            </div>
          </div>

          {/* Radar Chart + Category Score Overview */}
          {radarData.length > 0 && (
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col xs={24} lg={12}>
                <Card title="评估维度雷达图" size="small">
                  <EvalRadarChart data={radarData} height={320} />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title="分类评分概览" size="small">
                  <div style={{ padding: '8px 0' }}>
                    {summary.categories.map((cat) => (
                      <div
                        key={cat.category}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '12px 0',
                          borderBottom: '1px solid #f5f5f5',
                        }}
                      >
                        <div style={{ width: 140, flexShrink: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 14 }}>
                            {cat.name}
                          </div>
                          <div style={{ fontSize: 12, color: '#999' }}>
                            {cat.nameEn}
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <ScoreBar score={cat.score} height={10} />
                        </div>
                        {categoryDetails[cat.category] && (
                          <RiskLevelBadge
                            level={categoryDetails[cat.category].riskLevel}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>
            </Row>
          )}

          {/* Category Detail Sections */}
          {Object.keys(categoryDetails).length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <Text
                strong
                style={{
                  fontSize: 16,
                  display: 'block',
                  marginBottom: 16,
                  paddingBottom: 8,
                  borderBottom: '1px solid #e8e8e8',
                }}
              >
                评分详情
              </Text>
              {Object.entries(categoryDetails).map(([key, detail]) => (
                <ReportCategoryDetailComp
                  key={key}
                  categoryKey={key}
                  detail={detail}
                />
              ))}
            </div>
          )}

          {/* Risk Analysis */}
          {highRiskTasks.length > 0 && (
            <div className="eval-section">
              <div className="eval-section-title">
                风险分析（{highRiskTasks.length} 个高危任务）
              </div>
              {highRiskTasks.map((task, idx) => (
                <div key={idx} className="high-risk-card">
                  <div className="high-risk-info">
                    <div className="high-risk-name">{task.taskName}</div>
                    <div className="high-risk-desc">
                      {task.category} · 评分 {task.score.toFixed(1)}
                      {task.interpretation && ` · ${task.interpretation}`}
                    </div>
                  </div>
                  <div className="high-risk-actions">
                    <RiskLevelBadge level={task.riskLevel} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div
            style={{
              textAlign: 'center',
              color: '#999',
              fontSize: 13,
              marginTop: 32,
              paddingTop: 16,
              borderTop: '1px solid #f0f0f0',
            }}
          >
            由智能体安全评估平台 v2.0 生成
            {summary.generatedAt &&
              ` · ${dayjs(summary.generatedAt).format('YYYY-MM-DD HH:mm:ss')}`}
          </div>
        </>
      ) : (
        <Empty description="暂无报告数据" />
      )}
    </div>
  );
};

export default ReportDetailPage;
