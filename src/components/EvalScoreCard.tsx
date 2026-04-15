import React from 'react';
import { Card, Typography } from 'antd';
import {
  SafetyOutlined,
  BugOutlined,
  LockOutlined,
  AuditOutlined,
  ExperimentOutlined,
  AlertOutlined,
  SecurityScanOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import SafetyScoreGauge from './SafetyScoreGauge';
import RiskLevelBadge from './RiskLevelBadge';

const { Text } = Typography;

const ICON_MAP: Record<string, React.ReactNode> = {
  safety: <SafetyOutlined style={{ fontSize: 20 }} />,
  jailbreak: <BugOutlined style={{ fontSize: 20 }} />,
  privacy: <LockOutlined style={{ fontSize: 20 }} />,
  compliance: <AuditOutlined style={{ fontSize: 20 }} />,
  toxicity: <AlertOutlined style={{ fontSize: 20 }} />,
  robustness: <ThunderboltOutlined style={{ fontSize: 20 }} />,
  security: <SecurityScanOutlined style={{ fontSize: 20 }} />,
};

const DEFAULT_ICON = <ExperimentOutlined style={{ fontSize: 20 }} />;

const getScoreColor = (score: number): string => {
  if (score >= 80) return '#52c41a';
  if (score >= 60) return '#faad14';
  return '#ff4d4f';
};

const getRiskFromScore = (score: number): string => {
  if (score >= 80) return 'MINIMAL';
  if (score >= 60) return 'LOW';
  if (score >= 40) return 'MEDIUM';
  if (score >= 20) return 'HIGH';
  return 'CRITICAL';
};

interface EvalScoreCardProps {
  benchmark: string;
  name: string;
  score: number;
  riskLevel?: string | null;
  interpretation?: string | null;
  sampleCount?: number;
}

const EvalScoreCard: React.FC<EvalScoreCardProps> = ({
  benchmark,
  name,
  score,
  riskLevel,
  interpretation,
  sampleCount,
}) => {
  const benchmarkLower = benchmark.toLowerCase();
  const icon = Object.keys(ICON_MAP).reduce<React.ReactNode>((found, key) => {
    if (found !== DEFAULT_ICON) return found;
    return benchmarkLower.includes(key) ? ICON_MAP[key] : found;
  }, DEFAULT_ICON);
  const color = getScoreColor(score);
  const effectiveRisk = riskLevel || getRiskFromScore(score);

  return (
    <Card hoverable bodyStyle={{ textAlign: 'center', padding: '20px 12px' }}>
      <div style={{ color, marginBottom: 8 }}>{icon}</div>
      <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
        {name}
      </Text>
      {effectiveRisk && (
        <div style={{ marginBottom: 10 }}>
          <RiskLevelBadge level={effectiveRisk} />
        </div>
      )}
      <SafetyScoreGauge score={score} riskLevel={effectiveRisk} size={100} label="" />
      <div style={{ marginTop: 12 }}>
        {interpretation && (
          <div style={{ marginBottom: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {interpretation}
            </Text>
          </div>
        )}
        {sampleCount !== undefined && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            样本：{sampleCount}
          </Text>
        )}
      </div>
    </Card>
  );
};

export default EvalScoreCard;
