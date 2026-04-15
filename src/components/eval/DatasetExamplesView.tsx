import React from 'react';
import { Card, Row, Col, Typography } from 'antd';
import { DatabaseOutlined, ExperimentOutlined, AppstoreOutlined } from '@ant-design/icons';
import type { JobResultData } from '../../services/evalService';

const { Text, Title } = Typography;

interface DatasetExamplesViewProps {
  result: JobResultData;
}

const DatasetExamplesView: React.FC<DatasetExamplesViewProps> = ({ result }) => {
  const tasks = result.tasks || [];
  const benchmarks = new Set(tasks.map((t) => t.benchmark));
  const totalSamples = tasks.reduce((sum, t) => sum + t.samplesTotal, 0);

  // Group tasks by benchmark
  const benchmarkGroups = new Map<string, typeof tasks>();
  tasks.forEach((task) => {
    const group = benchmarkGroups.get(task.benchmark) || [];
    group.push(task);
    benchmarkGroups.set(task.benchmark, group);
  });

  return (
    <div>
      {/* Summary Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <div className="stat-card">
              <AppstoreOutlined style={{ fontSize: 24, color: '#1677ff', marginBottom: 8 }} />
              <div className="stat-value">{benchmarks.size}</div>
              <div className="stat-label">基准测试数</div>
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <div className="stat-card">
              <ExperimentOutlined style={{ fontSize: 24, color: '#52c41a', marginBottom: 8 }} />
              <div className="stat-value">{tasks.length}</div>
              <div className="stat-label">评估任务数</div>
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <div className="stat-card">
              <DatabaseOutlined style={{ fontSize: 24, color: '#faad14', marginBottom: 8 }} />
              <div className="stat-value">{totalSamples}</div>
              <div className="stat-label">样本总数</div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Benchmark Breakdown */}
      <div className="eval-section">
        <div className="eval-section-title">数据集概览</div>
        {Array.from(benchmarkGroups.entries()).map(([benchmark, benchTasks]) => {
          const bmSamples = benchTasks.reduce((s, t) => s + t.samplesTotal, 0);
          return (
            <div
              key={benchmark}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--border-radius)',
                marginBottom: 8,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  background: '#fafafa',
                }}
              >
                <Text strong style={{ fontSize: 14 }}>{benchmark}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {benchTasks.length} 个任务 · {bmSamples} 样本
                </Text>
              </div>
              <div style={{ padding: '8px 16px' }}>
                {benchTasks.map((task) => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid #f5f5f5',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: '#333' }}>{task.taskName}</span>
                    <span style={{ color: '#999' }}>
                      {task.samplesTotal} 样本
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13 }}>
        更多数据集详情功能开发中...
      </div>
    </div>
  );
};

export default DatasetExamplesView;
