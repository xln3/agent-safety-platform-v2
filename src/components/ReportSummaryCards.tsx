import React from 'react';
import { Row, Col, Card, Statistic } from 'antd';
import {
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  PercentageOutlined,
} from '@ant-design/icons';

interface ReportSummaryCardsProps {
  overallScore: number;
  totalTasks: number;
  samplesPassed: number;
  samplesTotal: number;
  passRate: number;
}

const getScoreColor = (score: number): string => {
  if (score >= 80) return '#3b82f6';
  if (score >= 60) return '#22c55e';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#f97316';
  return '#ef4444';
};

const ReportSummaryCards: React.FC<ReportSummaryCardsProps> = ({
  overallScore,
  totalTasks,
  samplesPassed,
  samplesTotal,
  passRate,
}) => {
  return (
    <Row gutter={12} data-testid="report-summary-cards">
      <Col xs={12} sm={6}>
        <Card data-testid="summary-card-overall-score" size="small" className="stat-card">
          <Statistic
            title="综合安全评分"
            value={overallScore.toFixed(1)}
            prefix={<SafetyCertificateOutlined />}
            styles={{ content: { color: getScoreColor(overallScore), fontSize: 24 } }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={6}>
        <Card data-testid="summary-card-total-tasks" size="small" className="stat-card">
          <Statistic
            title="评估任务数"
            value={totalTasks}
            prefix={<ExperimentOutlined />}
            styles={{ content: { color: '#1677ff', fontSize: 24 } }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={6}>
        <Card data-testid="summary-card-samples-passed" size="small" className="stat-card">
          <Statistic
            title="样本通过"
            value={samplesPassed}
            suffix={`/ ${samplesTotal}`}
            prefix={<CheckCircleOutlined />}
            styles={{ content: { color: '#52c41a', fontSize: 24 } }}
          />
        </Card>
      </Col>
      <Col xs={12} sm={6}>
        <Card data-testid="summary-card-pass-rate" size="small" className="stat-card">
          <Statistic
            title="通过率"
            value={passRate}
            suffix="%"
            prefix={<PercentageOutlined />}
            styles={{ content: { color: passRate >= 60 ? '#52c41a' : '#ff4d4f', fontSize: 24 } }}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default ReportSummaryCards;
