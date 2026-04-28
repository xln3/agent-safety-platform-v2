import React from 'react';
import { Card, Empty, Row, Col, Tag } from 'antd';
import EvalRadarChart from '../EvalRadarChart';
import AssessmentBadge from './AssessmentBadge';
import type {
  AggregatedCategory,
  AggregatedDimension,
  DimensionsAssessment,
} from '../../services/evalService';
import { scoreToAssessment } from '../../utils/scoreToAssessment';

interface AssessmentViewProps {
  assessment: DimensionsAssessment;
}

const TIER_LABEL: Record<string, string> = {
  good: '稳健',
  watch: '需关注',
  action: '需改进',
  unknown: '待评估',
};

const renderDimensionCard = (cat: AggregatedCategory, dim: AggregatedDimension) => {
  const a = scoreToAssessment(dim.score, null);
  return (
    <div
      key={`${cat.id}::${dim.id}`}
      style={{
        padding: 12,
        marginBottom: 8,
        background: a.background,
        border: `1px solid ${a.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: '#0f172a' }}>{dim.title}</span>
        <AssessmentBadge score={dim.score} size="small" showScore />
      </div>
      <div style={{ fontSize: 12, color: a.color, lineHeight: 1.6 }}>
        {dim.recommendation}
      </div>
      {dim.contributing.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {dim.contributing.map((c) => (
            <Tag
              key={`${c.benchmark}-${c.taskName}`}
              style={{
                fontSize: 11,
                padding: '0 6px',
                background: '#fff',
                border: `1px solid ${a.border}`,
                color: '#475569',
              }}
            >
              {c.taskName}
              {c.safetyScore != null && (
                <span style={{ marginLeft: 4, opacity: 0.7 }}>· {Math.round(c.safetyScore)}</span>
              )}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
};

const AssessmentView: React.FC<AssessmentViewProps> = ({ assessment }) => {
  const scoredCategories = (assessment.categories || []).filter((c) => c.score != null);

  if (scoredCategories.length === 0) {
    return (
      <Empty
        description="本次评估未覆盖维度配置中的基准，建议至少跑一个 工具调用 / RAG / 任务规划 / 业务场景 类的基准"
        style={{ padding: 24 }}
      />
    );
  }

  // Radar uses category-level scores so every selected category becomes one axis.
  const radarData = scoredCategories.map((c) => ({
    benchmark: c.title,
    score: c.score ?? 0,
  }));

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={10}>
          <Card title="风险类别雷达图" size="small">
            {radarData.length >= 3 ? (
              <EvalRadarChart data={radarData} height={320} seriesName="维度评估" />
            ) : (
              <div style={{ padding: 24, color: '#64748b', fontSize: 13 }}>
                雷达图至少需要 3 个类别，当前仅 {radarData.length} 个。完整覆盖 4 类（工具调用 / RAG-记忆 / 任务规划 / 业务场景）后即可显示。
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="重点改进建议" size="small">
            {assessment.recommendations.length === 0 ? (
              <div style={{ color: '#15803d', fontSize: 13 }}>
                所有覆盖维度均处于“稳健”状态，暂无需特别处理。
              </div>
            ) : (
              <ol style={{ paddingLeft: 18, margin: 0 }}>
                {assessment.recommendations.slice(0, 6).map((r, i) => (
                  <li key={`${r.categoryId}-${r.dimensionId}-${i}`} style={{ marginBottom: 8, fontSize: 13, color: '#1f2937', lineHeight: 1.6 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        marginRight: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        color: r.tier === 'action' ? '#b91c1c' : '#a16207',
                      }}
                    >
                      [{TIER_LABEL[r.tier] || r.tier}]
                    </span>
                    {r.text}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </Col>
      </Row>

      {assessment.categories.map((cat) => {
        const a = scoreToAssessment(cat.score, null);
        return (
          <Card
            key={cat.id}
            size="small"
            style={{ marginBottom: 12 }}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span>{cat.title}</span>
                <AssessmentBadge score={cat.score} size="small" showScore />
                {cat.description && (
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>
                    {cat.description}
                  </span>
                )}
              </div>
            }
            headStyle={{ background: a.background }}
          >
            {cat.dimensions.length === 0 ? (
              <Empty description="本类别尚未跑出任何基准" />
            ) : (
              cat.dimensions.map((d) => renderDimensionCard(cat, d))
            )}
          </Card>
        );
      })}

      {assessment.unmatched.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
          以下基准未纳入维度映射（仅作为补充信息）：
          {assessment.unmatched.map((t) => `${t.benchmark}/${t.taskName}`).join('，')}
        </div>
      )}
    </div>
  );
};

export default AssessmentView;
