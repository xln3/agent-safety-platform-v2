import React from 'react';
import { scoreToAssessment } from '../../utils/scoreToAssessment';

interface AssessmentBadgeProps {
  /** Either riskLevel or score (or both) drives the tier. */
  riskLevel?: string | null;
  score?: number | null;
  /** When true, the numeric score is appended in parentheses for technical reviewers. */
  showScore?: boolean;
  size?: 'small' | 'default';
  className?: string;
  style?: React.CSSProperties;
}

const AssessmentBadge: React.FC<AssessmentBadgeProps> = ({
  riskLevel,
  score = null,
  showScore = false,
  size = 'default',
  className = '',
  style,
}) => {
  const a = scoreToAssessment(score ?? null, riskLevel ?? null);
  const padding = size === 'small' ? '1px 8px' : '2px 12px';
  const fontSize = size === 'small' ? 12 : 13;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding,
        fontSize,
        fontWeight: 500,
        color: a.color,
        background: a.background,
        border: `1px solid ${a.border}`,
        borderRadius: 999,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {a.label}
      {showScore && score != null && !Number.isNaN(score) && (
        <span style={{ opacity: 0.7, fontWeight: 400 }}>· {Math.round(score)}</span>
      )}
    </span>
  );
};

export default AssessmentBadge;
