import React from 'react';
import { scoreToAssessment } from '../../utils/scoreToAssessment';

interface AssessmentBarProps {
  score: number | null;
  riskLevel?: string | null;
  /** Force max width of the bar segment (excluding label). */
  maxWidth?: string;
  height?: number;
  /** When true, the numeric score is shown after the label. Off by default. */
  showScore?: boolean;
}

/**
 * Replaces the bare ScoreBar in benchmark rows. Width still tracks the score
 * but the trailing number is replaced with the qualitative tier label, so a
 * 30 / 100 reads as "需改进" rather than a red bar with a giant "30".
 */
const AssessmentBar: React.FC<AssessmentBarProps> = ({
  score,
  riskLevel = null,
  maxWidth = '100%',
  height = 6,
  showScore = false,
}) => {
  const numeric = score == null || Number.isNaN(score) ? null : score;
  const a = scoreToAssessment(numeric, riskLevel);
  const pct = numeric == null ? 0 : Math.max(0, Math.min(100, numeric));
  const radius = height / 2;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth }}>
      <div
        style={{
          flex: 1,
          height,
          borderRadius: radius,
          background: '#f1f5f9',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: radius,
            background: a.color,
            transition: 'width 0.6s ease-out',
          }}
        />
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: a.color,
          minWidth: 56,
          textAlign: 'right',
        }}
      >
        {a.label}
        {showScore && numeric != null && (
          <span style={{ opacity: 0.7, fontWeight: 400 }}> · {Math.round(numeric)}</span>
        )}
      </span>
    </div>
  );
};

export default AssessmentBar;
