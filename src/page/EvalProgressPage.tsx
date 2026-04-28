import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Typography, Tag, Popconfirm, message, Spin, Tabs } from 'antd';
import {
  ArrowLeftOutlined,
  EyeOutlined,
  StopOutlined,
  DashboardOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { evalService } from '../services/evalService';
import type { EvalJob } from '../services/evalService';
import EvalJobProgress from '../components/EvalJobProgress';
import LiveItemsView from '../components/eval/LiveItemsView';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const EvalProgressPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<EvalJob | null>(null);
  const [loading, setLoading] = useState(true);

  const jobId = id ? parseInt(id, 10) : 0;

  useEffect(() => {
    if (!jobId) return;
    evalService.getJob(jobId).then((data) => {
      setJob(data as EvalJob);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [jobId]);

  const handleJobUpdate = (updatedJob: any) => {
    setJob((prev) => prev ? { ...prev, ...updatedJob } : updatedJob);
  };

  const handleCancel = async () => {
    if (!jobId) return;
    try {
      await evalService.deleteJob(jobId);
      message.success('评估任务已取消');
    } catch {
      // Handled by interceptor
    }
  };

  if (!jobId) return null;

  if (loading) {
    return (
      <div className="flex-center" style={{ padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const jobStatus = job?.status || 'pending';
  const isTerminal = jobStatus === 'completed' || jobStatus === 'failed';

  return (
    <div>
      <div className="page-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/eval')}>
            返回
          </Button>
          <Title level={4} style={{ margin: 0 }}>评估进度</Title>
        </Space>
        <Space>
          {job && !isTerminal && (
            <Popconfirm
              title="确认取消此评估任务？"
              onConfirm={handleCancel}
              okText="确认"
              cancelText="取消"
            >
              <Button danger icon={<StopOutlined />}>
                取消评估
              </Button>
            </Popconfirm>
          )}
          {job && jobStatus === 'completed' && (
            <Button
              type="primary"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/eval/results/${jobId}`)}
            >
              查看结果
            </Button>
          )}
        </Space>
      </div>

      {job && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space size="large" wrap>
            {job.modelId && (
              <Text type="secondary">模型：<Text strong>{job.modelId}</Text></Text>
            )}
            <Text type="secondary">
              基准测试：
              {(job.benchmarks || []).map((b) => (
                <Tag key={b} style={{ marginLeft: 4 }}>{b}</Tag>
              ))}
            </Text>
            <Text type="secondary">
              进度：<Text strong>{job.completedTasks} / {job.totalTasks}</Text> 任务
            </Text>
            {job.createdAt && (
              <Text type="secondary">
                创建时间：{dayjs(job.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </Text>
            )}
          </Space>
        </Card>
      )}

      <Tabs
        defaultActiveKey="progress"
        items={[
          {
            key: 'progress',
            label: <span><DashboardOutlined /> 进度概览</span>,
            children: <EvalJobProgress jobId={jobId} onJobUpdate={handleJobUpdate} />,
          },
          {
            key: 'samples',
            label: <span><UnorderedListOutlined /> 样本明细</span>,
            children: <LiveItemsView jobId={jobId} live={!isTerminal} />,
          },
        ]}
      />
    </div>
  );
};

export default EvalProgressPage;
