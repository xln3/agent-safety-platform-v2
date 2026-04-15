import React, { useEffect, useState } from 'react';
import {
  Button,
  Space,
  Spin,
  Empty,
  Typography,
  Tabs,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  BarChartOutlined,
  SearchOutlined,
  AlertOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { evalService } from '../services/evalService';
import type { JobResultData } from '../services/evalService';
import { reportService } from '../services/reportService';
import FullReportView from '../components/eval/FullReportView';
import SingleBenchmarkView from '../components/eval/SingleBenchmarkView';
import HighRiskView from '../components/eval/HighRiskView';
import DatasetExamplesView from '../components/eval/DatasetExamplesView';

const { Title, Text } = Typography;

const EvalResultsPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<JobResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('full-report');

  // For drill-down into specific tasks from FullReportView
  const [drillTaskId, setDrillTaskId] = useState<number | null>(null);
  const [drillTaskName, setDrillTaskName] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const fetchResults = async () => {
      setLoading(true);
      try {
        const data = (await evalService.getJobResults(
          parseInt(jobId, 10),
        )) as JobResultData;
        setResult(data);
      } catch {
        // Handled by interceptor
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [jobId]);

  const handleGenerateReport = async () => {
    if (!jobId) return;
    setGenerating(true);
    try {
      const report = await reportService.generate({
        jobId: parseInt(jobId, 10),
      });
      message.success('报告生成成功');
      navigate(`/reports/${report.id}`);
    } catch {
      // Handled by interceptor
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectTask = (taskId: number, _taskName: string) => {
    setDrillTaskId(taskId);
    setDrillTaskName(_taskName);
    setActiveTab('single-benchmark');
  };

  const handleHighRiskDetail = (taskId: number, _taskName: string) => {
    setDrillTaskId(taskId);
    setDrillTaskName(_taskName);
    setActiveTab('high-risk');
  };

  if (loading) {
    return (
      <div className="flex-center" style={{ padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!result) {
    return <Empty description="暂无评估结果" />;
  }

  const modelId = result.job?.modelId;

  const tabItems = [
    {
      key: 'full-report',
      label: (
        <span>
          <BarChartOutlined /> 全面报告
        </span>
      ),
      children: (
        <FullReportView
          result={result}
          onSelectTask={handleSelectTask}
          onHighRiskDetail={handleHighRiskDetail}
          onGenerateReport={handleGenerateReport}
          generating={generating}
        />
      ),
    },
    {
      key: 'single-benchmark',
      label: (
        <span>
          <SearchOutlined /> 单项基准
        </span>
      ),
      children: (
        <SingleBenchmarkView
          result={result}
          initialTaskId={drillTaskId}
          initialTaskName={drillTaskName}
        />
      ),
    },
    {
      key: 'high-risk',
      label: (
        <span>
          <AlertOutlined /> 高危案例
        </span>
      ),
      children: (
        <HighRiskView result={result} initialTaskId={drillTaskId} />
      ),
    },
    {
      key: 'dataset',
      label: (
        <span>
          <DatabaseOutlined /> 数据集
        </span>
      ),
      children: <DatasetExamplesView result={result} />,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/eval')}
          >
            返回
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            评估结果
          </Title>
          {modelId && <Text type="secondary">- {modelId}</Text>}
        </Space>
        <Button
          type="primary"
          icon={<FileTextOutlined />}
          onClick={handleGenerateReport}
          loading={generating}
        >
          生成报告
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key)}
        items={tabItems}
        size="large"
        style={{ marginTop: -8 }}
      />
    </div>
  );
};

export default EvalResultsPage;
