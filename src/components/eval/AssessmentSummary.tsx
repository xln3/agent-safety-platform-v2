import React from 'react';
import { scoreToAssessment } from '../../utils/scoreToAssessment';

interface AssessmentSummaryProps {
  score?: number | null;
  riskLevel?: string | null;
  /** Optional caption rendered under the tier label (e.g. "X / N 个任务已评分"). */
  caption?: React.ReactNode;
  /** Width of the colored accent bar. */
  width?: number;
}

/**
 * Replaces the hard-numeric SafetyScoreGauge in the report overview. Leads with
 * qualitative wording (稳健 / 需关注 / 需改进), keeps the numeric score as a
 * subdued secondary detail, and uses a soft tone-tinted card so low scores no
 * longer read as alarms in front of the client's reviewer.
 */
const AssessmentSummary: React.FC<AssessmentSummaryProps> = ({
  score = null,
  riskLevel = null,
  caption,
  width = 200,
}) => {
  const a = scoreToAssessment(score ?? null, riskLevel ?? null);
  const numeric = score == null || Number.isNaN(score) ? '—' : Math.round(score);

  return (
    <div
      style={{
        width,
        padding: 16,
        borderRadius: 12,
        background: a.background,
        border: `1px solid ${a.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 1,
          fontWeight: 600,
          color: a.color,
          opacity: 0.8,
          textTransform: 'uppercase',
        }}
      >
        综合评估
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: a.color,
          lineHeight: 1.1,
        }}
      >
        {a.label}
      </div>
      <div style={{ fontSize: 12, color: a.color, opacity: 0.85 }}>{a.description}</div>
      <div
        style={{
          marginTop: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: '#64748b',
        }}
      >
        <span>参考分</span>
        <span style={{ fontWeight: 600, color: '#0f172a' }}>{numeric}</span>
        {typeof score === 'number' && !Number.isNaN(score) && <span>/ 100</span>}
      </div>
      {caption && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>{caption}</div>
      )}
    </div>
  );
};

export default AssessmentSummary;
