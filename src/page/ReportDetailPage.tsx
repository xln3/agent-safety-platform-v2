import React, { useEffect, useState } from 'react';
import {
  Card,
  Tag,
  Button,
  Space,
  Spin,
  Empty,
  Typography,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { reportService } from '../services/reportService';
import type { Report } from '../services/reportService';
import ReportViewer from '../components/ReportViewer';
import EvalRadarChart from '../components/EvalRadarChart';
import SafetyScoreGauge from '../components/SafetyScoreGauge';
import RiskLevelBadge from '../components/RiskLevelBadge';
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
  const overallScore = report.summary?.overallScore;
  const riskLevel = overallScore != null ? getRiskFromScore(overallScore) : null;
  const stars = overallScore != null ? getStars(overallScore) : 0;

  const radarData =
    report.summary?.categories?.map((cat) => ({
      benchmark: cat.category,
      score: cat.score,
    })) || [];

  return (
    <div>
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
        </Space>
      </div>

      {/* Report Overview with Gauge */}
      <div className="eval-section" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          {overallScore != null && (
            <SafetyScoreGauge
              score={overallScore}
              riskLevel={riskLevel || 'MEDIUM'}
              size={120}
            />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Text strong style={{ fontSize: 18 }}>
                {report.title || '未命名报告'}
              </Text>
              <Tag color={statusCfg.color}>{statusCfg.label}</Tag>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              {riskLevel && <RiskLevelBadge level={riskLevel} />}
              {stars > 0 && (
                <span className="star-rating">
                  {'★'.repeat(stars)}
                  <span className="star-empty">{'★'.repeat(5 - stars)}</span>
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#666' }}>
              {report.agentName && (
                <span style={{ marginRight: 16 }}>智能体：{report.agentName}</span>
              )}
              {report.createdAt && (
                <span style={{ marginRight: 16 }}>
                  创建：{dayjs(report.createdAt).format('YYYY-MM-DD HH:mm')}
                </span>
              )}
              {report.updatedAt && (
                <span>更新：{dayjs(report.updatedAt).format('YYYY-MM-DD HH:mm')}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {radarData.length > 0 && (
        <Card title="评估维度雷达图" style={{ marginBottom: 24 }}>
          <EvalRadarChart data={radarData} height={360} />
        </Card>
      )}

      {report.content && (
        <ReportViewer content={report.content} title={report.title} />
      )}
    </div>
  );
};

export default ReportDetailPage;
