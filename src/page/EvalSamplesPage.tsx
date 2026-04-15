import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Tag,
  Button,
  Space,
  Spin,
  Typography,
  Card,
  Descriptions,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { evalService } from '../services/evalService';
import type { SampleItem } from '../services/evalService';

const { Title, Text, Paragraph } = Typography;

const MAX_DISPLAY_LENGTH = 120;

const RISK_COLOR_MAP: Record<string, string> = {
  CRITICAL: 'red',
  HIGH: 'orange',
  MEDIUM: 'gold',
  LOW: 'blue',
  MINIMAL: 'green',
};

const RISK_LABEL_MAP: Record<string, string> = {
  CRITICAL: '极危',
  HIGH: '高危',
  MEDIUM: '中危',
  LOW: '低危',
  MINIMAL: '极低',
};

interface TaskInfo {
  id: number;
  benchmark: string;
  taskName: string;
  safetyScore?: number | null;
  riskLevel?: string | null;
}

interface DisplaySample extends SampleItem {
  passed: boolean;
}

const EvalSamplesPage: React.FC = () => {
  const { jobId, taskId } = useParams<{ jobId: string; taskId: string }>();
  const navigate = useNavigate();
  const [samples, setSamples] = useState<DisplaySample[]>([]);
  const [taskInfo, setTaskInfo] = useState<TaskInfo | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  const fetchSamples = useCallback(async () => {
    if (!jobId || !taskId) return;
    setLoading(true);
    try {
      const data = await evalService.getTaskSamples(
        parseInt(jobId, 10),
        parseInt(taskId, 10),
        { page, pageSize },
      );
      const displaySamples = (data.samples || []).map((s) => ({
        ...s,
        passed: s.score !== null && s.score >= 0.5,
      }));
      setSamples(displaySamples);
      setTotal(data.pagination?.total || 0);
      if (data.task) {
        setTaskInfo(data.task);
      }
    } catch {
      // Handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [jobId, taskId, page, pageSize]);

  useEffect(() => {
    fetchSamples();
  }, [fetchSamples]);

  const truncate = (text: string) => {
    if (!text) return '-';
    return text.length > MAX_DISPLAY_LENGTH
      ? text.slice(0, MAX_DISPLAY_LENGTH) + '...'
      : text;
  };

  const columns: ColumnsType<DisplaySample> = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_: unknown, __: unknown, index: number) =>
        (page - 1) * pageSize + index + 1,
    },
    {
      title: '输入',
      dataIndex: 'input',
      key: 'input',
      ellipsis: true,
      render: (text: string) => truncate(text),
    },
    {
      title: '模型输出',
      dataIndex: 'output',
      key: 'output',
      ellipsis: true,
      render: (text: string) => truncate(text),
    },
    {
      title: '得分',
      dataIndex: 'score',
      key: 'score',
      width: 80,
      sorter: (a, b) => (a.score ?? 0) - (b.score ?? 0),
      render: (score: number | null) => {
        if (score === null || score === undefined) return <Text type="secondary">-</Text>;
        const className =
          score >= 0.8 ? 'score-high' : score >= 0.5 ? 'score-mid' : 'score-low';
        return (
          <Text strong className={className}>
            {typeof score === 'number' ? score.toFixed(2) : score}
          </Text>
        );
      },
    },
    {
      title: '通过',
      dataIndex: 'passed',
      key: 'passed',
      width: 80,
      render: (passed: boolean) =>
        passed ? (
          <Tag color="success">通过</Tag>
        ) : (
          <Tag color="error">未通过</Tag>
        ),
    },
  ];

  const getScoreColor = (score: number | null): string => {
    if (score === null) return '#999';
    if (score >= 80) return '#52c41a';
    if (score >= 60) return '#faad14';
    return '#ff4d4f';
  };

  return (
    <div>
      <div className="page-header">
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(`/eval/results/${jobId}`)}
          >
            返回结果
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            样本详情
          </Title>
        </Space>
      </div>

      {/* Task info header */}
      {taskInfo && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Descriptions column={{ xs: 1, sm: 2, md: 4 }} size="small">
            <Descriptions.Item label="基准测试">
              <Tag>{taskInfo.benchmark}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="任务名称">
              {taskInfo.taskName}
            </Descriptions.Item>
            <Descriptions.Item label="安全评分">
              {taskInfo.safetyScore !== null && taskInfo.safetyScore !== undefined ? (
                <Text strong style={{ color: getScoreColor(taskInfo.safetyScore) }}>
                  {taskInfo.safetyScore.toFixed(1)}
                </Text>
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="风险等级">
              {taskInfo.riskLevel ? (
                <Tag color={RISK_COLOR_MAP[taskInfo.riskLevel] || 'default'}>
                  {RISK_LABEL_MAP[taskInfo.riskLevel] || taskInfo.riskLevel}
                </Tag>
              ) : (
                '-'
              )}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Spin spinning={loading}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={samples}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条样本`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          expandable={{
            expandedRowRender: (record: DisplaySample) => (
              <Card size="small">
                <div style={{ marginBottom: 12 }}>
                  <Text strong>输入（测试提示）：</Text>
                  <Paragraph
                    style={{
                      whiteSpace: 'pre-wrap',
                      background: '#fafafa',
                      padding: 12,
                      borderRadius: 6,
                      marginTop: 4,
                      maxHeight: 300,
                      overflow: 'auto',
                    }}
                  >
                    {record.input || '-'}
                  </Paragraph>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <Text strong>模型输出：</Text>
                  <Paragraph
                    style={{
                      whiteSpace: 'pre-wrap',
                      background: record.passed ? '#f0f9eb' : '#fff2f0',
                      padding: 12,
                      borderRadius: 6,
                      marginTop: 4,
                      maxHeight: 300,
                      overflow: 'auto',
                    }}
                  >
                    {record.output || '-'}
                  </Paragraph>
                </div>
                <Space>
                  <Tag color={record.passed ? 'success' : 'error'}>
                    {record.passed ? '通过' : '未通过'}
                  </Tag>
                  {record.score !== null && record.score !== undefined && (
                    <Text>得分：{record.score.toFixed(2)}</Text>
                  )}
                </Space>
                {record.metadata && Object.keys(record.metadata).length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text strong>元数据：</Text>
                    <Paragraph
                      style={{
                        whiteSpace: 'pre-wrap',
                        background: '#f5f5f5',
                        padding: 12,
                        borderRadius: 6,
                        marginTop: 4,
                        fontSize: 12,
                      }}
                    >
                      {JSON.stringify(record.metadata, null, 2)}
                    </Paragraph>
                  </div>
                )}
              </Card>
            ),
          }}
        />
      </Spin>
    </div>
  );
};

export default EvalSamplesPage;
