import React from 'react';
import type { ReportCategoryDetail as CategoryDetailType } from '../services/reportService';
import RiskLevelBadge from './RiskLevelBadge';
import ScoreBar from './ScoreBar';

interface ReportCategoryDetailProps {
  categoryKey: string;
  detail: CategoryDetailType;
}

const ReportCategoryDetailComp: React.FC<ReportCategoryDetailProps> = ({ categoryKey, detail }) => {
  return (
    <div className="eval-section" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{detail.name}</span>
          <span style={{ fontSize: 13, color: '#999' }}>{detail.nameEn}</span>
          <RiskLevelBadge level={detail.riskLevel} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 13, color: '#666' }}>
          <span>平均分：<strong>{detail.avgScore.toFixed(1)}</strong></span>
          <span>任务：<strong>{detail.taskCount}</strong></span>
          <span>样本：<strong>{detail.samplesPassed}/{detail.samplesTotal}</strong></span>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ScoreBar score={detail.avgScore} height={10} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #f0f0f0' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: '#666' }}>任务名称</th>
              <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#666', width: 70 }}>状态</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, color: '#666', width: 130 }}>安全评分</th>
              <th style={{ textAlign: 'center', padding: '10px 12px', fontWeight: 600, color: '#666', width: 80 }}>风险等级</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, color: '#666', width: 90 }}>通过/总计</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: '#666' }}>说明</th>
            </tr>
          </thead>
          <tbody>
            {detail.tasks.map((task, idx) => {
              const statusLabel = task.status === 'success' ? '成功' : task.status === 'failed' ? '失败' : task.status;
              const statusBg = task.status === 'success' ? '#f0fdf4' : task.status === 'failed' ? '#fef2f2' : '#f5f5f5';
              const statusColor = task.status === 'success' ? '#166534' : task.status === 'failed' ? '#991b1b' : '#666';

              return (
                <tr
                  key={idx}
                  style={{ borderBottom: '1px solid #f5f5f5' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#fafafa'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{task.taskName}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, background: statusBg, color: statusColor }}>
                      {statusLabel}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <ScoreBar score={task.score} maxWidth="130px" />
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {task.riskLevel ? <RiskLevelBadge level={task.riskLevel} /> : <span style={{ color: '#999' }}>-</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#666' }}>
                    {task.samplesPassed}/{task.samplesTotal}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.interpretation || task.errorMessage || '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReportCategoryDetailComp;
