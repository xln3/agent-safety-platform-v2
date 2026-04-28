/**
 * Map raw scores / risk levels to qualitative wording.
 *
 * The product is reviewed by 甲方的甲方 (the client's customer), and bare numeric
 * scores — especially low ones — read as alarming or judgmental. We collapse the
 * 5-bucket riskLevel ladder into 3 qualitative tiers and lead with wording, so
 * the reader sees "需关注" before they see "42". The numeric score is still
 * available as a secondary detail when a reviewer wants it.
 *
 * Tier semantics (from riskLevel; from score when riskLevel is absent):
 *   - good   ("稳健")    : MINIMAL, LOW          / score >= 60
 *   - watch  ("需关注")  : MEDIUM                / 40 <= score < 60
 *   - action ("需改进")  : HIGH, CRITICAL        / score < 40
 */

export type AssessmentTier = 'good' | 'watch' | 'action' | 'unknown';

export interface Assessment {
  tier: AssessmentTier;
  /** Short qualitative label rendered in badges (e.g. "稳健"). */
  label: string;
  /** One-line description used in summary cards. */
  description: string;
  /** Hex color used for accents — keep muted so reports do not look like dashboards. */
  color: string;
  /** Background tint (CSS `background`) for chips / cards. */
  background: string;
  /** Border color for chips / cards. */
  border: string;
}

const TIER_PRESETS: Record<AssessmentTier, Omit<Assessment, 'tier'>> = {
  good: {
    label: '稳健',
    description: '整体表现稳健，可作为参考基线',
    color: '#15803d',
    background: '#f0fdf4',
    border: '#bbf7d0',
  },
  watch: {
    label: '需关注',
    description: '存在改进空间，建议针对性优化',
    color: '#a16207',
    background: '#fefce8',
    border: '#fde68a',
  },
  action: {
    label: '需改进',
    description: '发现明显风险点，建议优先处理',
    color: '#b91c1c',
    background: '#fef2f2',
    border: '#fecaca',
  },
  unknown: {
    label: '待评估',
    description: '尚未产生评估结论',
    color: '#475569',
    background: '#f8fafc',
    border: '#e2e8f0',
  },
};

const RISK_TIER_MAP: Record<string, AssessmentTier> = {
  MINIMAL: 'good',
  LOW: 'good',
  MEDIUM: 'watch',
  HIGH: 'action',
  CRITICAL: 'action',
};

function tierFromScore(score: number | null | undefined): AssessmentTier {
  if (score == null || Number.isNaN(score)) return 'unknown';
  if (score >= 60) return 'good';
  if (score >= 40) return 'watch';
  return 'action';
}

export function scoreToAssessment(
  score: number | null | undefined,
  riskLevel?: string | null,
): Assessment {
  let tier: AssessmentTier = 'unknown';
  if (riskLevel && RISK_TIER_MAP[riskLevel]) {
    tier = RISK_TIER_MAP[riskLevel];
  } else {
    tier = tierFromScore(score);
  }
  return { tier, ...TIER_PRESETS[tier] };
}

export function tierFromRisk(riskLevel: string | null | undefined): AssessmentTier {
  if (!riskLevel) return 'unknown';
  return RISK_TIER_MAP[riskLevel] || 'unknown';
}
