import React, { useEffect, useState } from 'react';
import {
  Button,
  Space,
  Spin,
  Empty,
  Typography,
  Tabs,
  message,
  Card,
  Table,
  Tag,
  Descriptions,
  Tooltip,
  Statistic,
  Row,
  Col,
} from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  BarChartOutlined,
  SearchOutlined,
  AlertOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { evalService } from '../services/evalService';
import type { JobResultData, EvalJob, EvalItemData } from '../services/evalService';
import type { PaginatedResult } from '../services/agentService';
import { reportService } from '../services/reportService';
import FullReportView from '../components/eval/FullReportView';
import SingleBenchmarkView from '../components/eval/SingleBenchmarkView';
import HighRiskView from '../components/eval/HighRiskView';
import DatasetExamplesView from '../components/eval/DatasetExamplesView';

const { Title, Text } = Typography;

const CATEGORY_LABELS: Record<string, string> = {
  tool_calling: '工具调用安全',
  rag_safety: 'RAG/记忆安全',
  task_planning: '任务规划安全',
  business_safety: '业务场景安全',
};

/* ------------------------------------------------------------------ */
/*  Agent Test Results Sub-Component                                   */
/* ------------------------------------------------------------------ */

const AgentTestResults: React.FC<{ job: EvalJob }> = ({ job }) => {
  const [items, setItems] = useState<EvalItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0 });

  const fetchItems = async (page = 1, pageSize = 50) => {
    setLoading(true);
    try {
      const data = await evalService.getJobItems(job.id, { page, pageSize }) as PaginatedResult<EvalItemData>;
      setItems(data.list || []);
      setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  const successCount = items.filter((i) => i.status === 'success').length;
  const failedCount = items.filter((i) => i.status === 'failed').length;
  const avgLatency = items.filter((i) => i.latencyMs).reduce((sum, i) => sum + (i.latencyMs || 0), 0) / (items.filter((i) => i.latencyMs).length || 1);

  const columns = [
    {
      title: '序号',
      dataIndex: 'itemIndex',
      key: 'itemIndex',
      width: 70,
      render: (v: number) => v + 1,
    },
    {
      title: '任务类型',
      key: 'category',
      width: 140,
      render: (_: any, record: EvalItemData) => (
        <Tag>{CATEGORY_LABELS[record.task?.benchmark || ''] || record.task?.benchmark}</Tag>
      ),
    },
    {
      title: '测试输入',
      dataIndex: 'input',
      key: 'input',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft"><span>{v}</span></Tooltip>
      ),
    },
    {
      title: '测试输出',
      dataIndex: 'actualOutput',
      key: 'actualOutput',
      ellipsis: true,
      render: (v: string | null, record: EvalItemData) => {
        if (record.status === 'failed') {
          return <Text type="danger">{record.errorMessage || '请求失败'}</Text>;
        }
        return v ? (
          <Tooltip title={v} placement="topLeft"><span>{v}</span></Tooltip>
        ) : '-';
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) => v === 'success'
        ? <Tag color="success" icon={<CheckCircleOutlined />}>通过</Tag>
        : <Tag color="error" icon={<CloseCircleOutlined />}>失败</Tag>,
    },
    {
      title: '耗时',
      dataIndex: 'latencyMs',
      key: 'latencyMs',
      width: 90,
      render: (v: number | null) => v != null ? `${(v / 1000).toFixed(1)}s` : '-',
    },
  ];

  return (
    <div>
      {/* Summary cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="总测试项" value={pagination.total} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="成功" value={successCount} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="失败" value={failedCount} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="平均耗时" value={avgLatency > 0 ? `${(avgLatency / 1000).toFixed(1)}s` : '-'} />
          </Card>
        </Col>
      </Row>

      {/* Agent info */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="智能体">{job.agent?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="入口 URL">{job.agent?.apiBase || '-'}</Descriptions.Item>
          <Descriptions.Item label="数据模式">
            {job.dataMode === 'random' ? `随机抽取 ${job.sampleCount} 条` : '全部数据'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Items table */}
      <Card title="测试项结果">
        <Table
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 800 }}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            onChange: (p, ps) => fetchItems(p, ps),
          }}
        />
      </Card>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

const EvalResultsPage: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<JobResultData | null>(null);
  const [job, setJob] = useState<EvalJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('full-report');

  const [drillTaskId, setDrillTaskId] = useState<number | null>(null);
  const [drillTaskName, setDrillTaskName] = useState<string | null>(null);

  const isDifyAgent = job?.agent?.agentType === 'dify_chat' || job?.agent?.agentType === 'dify_workflow';

  useEffect(() => {
    if (!jobId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch job info first to determine type
        const jobData = await evalService.getJob(parseInt(jobId, 10)) as EvalJob;
        setJob(jobData);

        const isDify = jobData.agent?.agentType === 'dify_chat' || jobData.agent?.agentType === 'dify_workflow';

        if (!isDify) {
          // Fetch benchmark results for model agents
          const data = await evalService.getJobResults(parseInt(jobId, 10)) as JobResultData;
          setResult(data);
        }
      } catch {
        // Handled by interceptor
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [jobId]);

  const handleGenerateReport = async () => {
    if (!jobId) return;
    setGenerating(true);
    try {
      const report = await reportService.generate({ jobId: parseInt(jobId, 10) });
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

  // Dify agent results page
  if (isDifyAgent && job) {
    return (
      <div>
        <div className="page-header">
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/eval')}>返回</Button>
            <Title level={4} style={{ margin: 0 }}>智能体测试结果</Title>
            <Tag color="blue">
              {job.agent?.agentType === 'dify_chat' ? 'Dify 对话' : 'Dify 工作流'}
            </Tag>
          </Space>
        </div>
        <AgentTestResults job={job} />
      </div>
    );
  }

  // Model benchmark results page (existing)
  if (!result) {
    return <Empty description="暂无评估结果" />;
  }

  const modelId = result.job?.modelId;

  const tabItems = [
    {
      key: 'full-report',
      label: <span><BarChartOutlined /> 全面报告</span>,
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
      label: <span><SearchOutlined /> 单项基准</span>,
      children: <SingleBenchmarkView result={result} initialTaskId={drillTaskId} initialTaskName={drillTaskName} />,
    },
    {
      key: 'high-risk',
      label: <span><AlertOutlined /> 高危案例</span>,
      children: <HighRiskView result={result} initialTaskId={drillTaskId} />,
    },
    {
      key: 'dataset',
      label: <span><DatabaseOutlined /> 数据集</span>,
      children: <DatasetExamplesView result={result} />,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/eval')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>评估结果</Title>
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
