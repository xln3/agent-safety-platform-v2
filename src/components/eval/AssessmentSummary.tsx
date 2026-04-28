import React from 'react';
import { scoreToAssessment, type Assessment } from '../../utils/scoreToAssessment';

export type AssessmentOverride = 'insufficient' | 'no_data';

interface AssessmentSummaryProps {
  score?: number | null;
  riskLevel?: string | null;
  /** Optional caption rendered under the tier label (e.g. "X / N 个任务已评分"). */
  caption?: React.ReactNode;
  /** Width of the colored accent bar. */
  width?: number;
  /**
   * Force a meta tier instead of computing one from score/riskLevel. Used when
   * the underlying job has too few scored tasks to be statistically meaningful
   * (insufficient) or no scored tasks at all (no_data) — surfaces the gap to
   * the reviewer so a partial run does not read as a confident "稳健 100/100".
   */
  tierOverride?: AssessmentOverride;
}

const OVERRIDE_PRESETS: Record<AssessmentOverride, Omit<Assessment, 'tier'>> = {
  insufficient: {
    label: '数据不足',
    description: '部分任务未产出评分，结论仅供参考',
    color: '#475569',
    background: '#f1f5f9',
    border: '#cbd5e1',
  },
  no_data: {
    label: '暂无数据',
    description: '未产出有效评分，无法形成结论',
    color: '#475569',
    background: '#f8fafc',
    border: '#e2e8f0',
  },
};

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
  tierOverride,
}) => {
  const a: Omit<Assessment, 'tier'> = tierOverride
    ? OVERRIDE_PRESETS[tierOverride]
    : scoreToAssessment(score ?? null, riskLevel ?? null);
  const numeric = score == null || Number.isNaN(score) ? '—' : Math.round(score);
  const showNumeric = !tierOverride;

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
      {showNumeric && (
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
      )}
      {caption && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>{caption}</div>
      )}
    </div>
  );
};

export default AssessmentSummary;
