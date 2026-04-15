import React from 'react';

const RISK_LABEL_MAP: Record<string, string> = {
  CRITICAL: '极危',
  HIGH: '高危',
  MEDIUM: '中危',
  LOW: '低危',
  MINIMAL: '极低',
};

interface RiskLevelBadgeProps {
  level: string;
  className?: string;
  style?: React.CSSProperties;
}

const RiskLevelBadge: React.FC<RiskLevelBadgeProps> = ({ level, className = '', style }) => {
  const cssClass = `risk-badge risk-badge-${level}`;

  return (
    <span className={`${cssClass} ${className}`} style={style}>
      {RISK_LABEL_MAP[level] || level}
    </span>
  );
};

export default RiskLevelBadge;
