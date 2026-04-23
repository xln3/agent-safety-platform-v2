import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Steps,
  Select,
  Button,
  Form,
  InputNumber,
  Input,
  Card,
  Space,
  Spin,
  message,
  Descriptions,
  Tag,
  Empty,
  Collapse,
  Checkbox,
  Badge,
  Typography,
  Radio,
} from 'antd';
import {
  SafetyOutlined,
  DatabaseOutlined,
  ApartmentOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { agentService } from '../services/agentService';
import { evalService } from '../services/evalService';
import type { Agent } from '../services/agentService';
import type { BenchmarkInfo, TaskMeta } from '../services/evalService';

const { Text } = Typography;

/* ------------------------------------------------------------------ */
/*  Static category definitions                                        */
/* ------------------------------------------------------------------ */

interface CategoryDef {
  key: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: 'tool_calling',
    name: '工具调用安全',
    description: '评估智能体工具调用的安全性与准确性',
    icon: <SafetyOutlined />,
  },
  {
    key: 'rag_safety',
    name: 'RAG/记忆安全',
    description: '评估RAG系统对中毒攻击和信息泄露的防护能力',
    icon: <DatabaseOutlined />,
  },
  {
    key: 'task_planning',
    name: '任务规划安全',
    description: '评估智能体多步骤任务规划中的安全性',
    icon: <ApartmentOutlined />,
  },
  {
    key: 'business_safety',
    name: '业务场景安全',
    description: '评估智能体在真实业务场景中的安全合规性',
    icon: <ShopOutlined />,
  },
];

const AGENT_TYPE_LABELS: Record<string, string> = {
  model: '模型测试',
  dify_chat: 'Dify 对话',
  dify_workflow: 'Dify 工作流',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const EvalNewPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedAgentId = searchParams.get('agentId');

  /* ---- wizard state ---- */
  const [currentStep, setCurrentStep] = useState(0);

  /* ---- data ---- */
  const [agents, setAgents] = useState<Agent[]>([]);
  const [benchmarksByCategory, setBenchmarksByCategory] = useState<Record<string, BenchmarkInfo[]>>({});
  const [taskMeta, setTaskMeta] = useState<Record<string, TaskMeta>>({});
  const [loading, setLoading] = useState(false);

  /* ---- form state ---- */
  const [selectedAgentId, setSelectedAgentId] = useState<number | undefined>(
    preselectedAgentId ? parseInt(preselectedAgentId, 10) : undefined,
  );
  // For model agents: benchmark selection
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<Set<string>>(new Set());
  // For Dify agents: task type (category) selection
  const [selectedTaskTypes, setSelectedTaskTypes] = useState<Set<string>>(new Set());
  const [dataMode, setDataMode] = useState<'all' | 'random'>('all');
  const [sampleCount, setSampleCount] = useState<number | null>(null);

  const [limit, setLimit] = useState<number | null>(null);
  const [judgeModel, setJudgeModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /* ---- derived ---- */
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const isDifyAgent = selectedAgent?.agentType === 'dify_chat' || selectedAgent?.agentType === 'dify_workflow';

  /* ---- fetch data on mount ---- */
  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentData, benchmarks, meta] = await Promise.all([
        agentService.list({ page: 1, pageSize: 100 }),
        evalService.getBenchmarks(),
        evalService.getTaskMeta(),
      ]);

      setAgents(agentData.list || []);
      setTaskMeta(meta || {});

      const grouped: Record<string, BenchmarkInfo[]> = {};
      for (const b of (Array.isArray(benchmarks) ? benchmarks : [])) {
        const cat = b.category || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(b);
      }
      setBenchmarksByCategory(grouped);
    } catch {
      // Handled by interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  /* ---- benchmark helpers (for model agents) ---- */
  const benchmarkLabel = useCallback(
    (name: string): string => taskMeta[name]?.name || name,
    [taskMeta],
  );

  const benchmarkDescription = useCallback(
    (name: string): string | undefined => taskMeta[name]?.description,
    [taskMeta],
  );

  const toggleBenchmark = (name: string) => {
    setSelectedBenchmarks((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const toggleCategory = (categoryKey: string) => {
    const benchmarks = benchmarksByCategory[categoryKey] || [];
    const names = benchmarks.map((b) => b.name);
    const allSelected = names.length > 0 && names.every((n) => selectedBenchmarks.has(n));

    setSelectedBenchmarks((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        names.forEach((n) => next.delete(n));
      } else {
        names.forEach((n) => next.add(n));
      }
      return next;
    });
  };

  const isCategoryAllSelected = (key: string): boolean => {
    const bms = benchmarksByCategory[key] || [];
    return bms.length > 0 && bms.every((b) => selectedBenchmarks.has(b.name));
  };

  const isCategoryPartial = (key: string): boolean => {
    const bms = benchmarksByCategory[key] || [];
    const c = bms.filter((b) => selectedBenchmarks.has(b.name)).length;
    return c > 0 && c < bms.length;
  };

  const categorySelectedCount = (key: string): number => {
    const bms = benchmarksByCategory[key] || [];
    return bms.filter((b) => selectedBenchmarks.has(b.name)).length;
  };

  /* ---- task type helpers (for Dify agents) ---- */
  const toggleTaskType = (key: string) => {
    setSelectedTaskTypes((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  /* ---- Collapse items for benchmark hierarchy (model agents) ---- */
  const benchmarkCollapseItems = useMemo(() => {
    return CATEGORIES.map((cat) => {
      const benchmarks = benchmarksByCategory[cat.key] || [];
      const selCount = categorySelectedCount(cat.key);
      const allSel = isCategoryAllSelected(cat.key);
      const partial = isCategoryPartial(cat.key);

      return {
        key: cat.key,
        label: (
          <div
            data-testid={`category-header-${cat.key}`}
            data-category-key={cat.key}
            style={{ display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <Checkbox
              data-testid={`category-checkbox-${cat.key}`}
              checked={allSel}
              indeterminate={partial}
              onClick={(e) => { e.stopPropagation(); toggleCategory(cat.key); }}
            />
            <span style={{ fontSize: 16, color: '#1677ff' }}>{cat.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{cat.name}</div>
              <div style={{ fontSize: 12, color: '#999' }}>{cat.description}</div>
            </div>
            <Badge
              data-testid={`category-badge-${cat.key}`}
              count={selCount > 0 ? `${selCount}/${benchmarks.length}` : benchmarks.length}
              style={{ backgroundColor: selCount > 0 ? '#1677ff' : '#d9d9d9', fontSize: 11 }}
              overflowCount={999}
            />
          </div>
        ),
        children: (
          <div>
            {benchmarks.length === 0 ? (
              <Text type="secondary">暂无基准测试</Text>
            ) : (
              benchmarks.map((b) => {
                const checked = selectedBenchmarks.has(b.name);
                const desc = benchmarkDescription(b.name);
                return (
                  <div
                    key={b.name}
                    data-testid={`benchmark-row-${b.name}`}
                    data-benchmark-name={b.name}
                    data-category-key={cat.key}
                    onClick={() => toggleBenchmark(b.name)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                      borderRadius: 6, cursor: 'pointer',
                      background: checked ? '#f0f5ff' : 'transparent',
                      border: checked ? '1px solid #91caff' : '1px solid transparent',
                      marginBottom: 8, transition: 'all 0.2s',
                    }}
                  >
                    <Checkbox
                      data-testid={`benchmark-checkbox-${b.name}`}
                      checked={checked}
                      style={{ marginTop: 2 }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleBenchmark(b.name)}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>
                        {benchmarkLabel(b.name)}
                        {benchmarkLabel(b.name) !== b.name && (
                          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>({b.name})</Text>
                        )}
                      </div>
                      {desc && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{desc}</div>}
                      {b.taskCount !== undefined && (
                        <div style={{ fontSize: 12, color: '#bbb', marginTop: 2 }}>{b.taskCount} 个任务</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchmarksByCategory, selectedBenchmarks, taskMeta]);

  /* ---- step validation ---- */
  const canNext = () => {
    switch (currentStep) {
      case 0:
        return !!selectedAgentId;
      case 1:
        return isDifyAgent
          ? selectedTaskTypes.size > 0
          : selectedBenchmarks.size > 0;
      case 2:
        return true;
      default:
        return false;
    }
  };

  /* ---- submit ---- */
  const handleSubmit = async () => {
    if (!selectedAgentId) {
      message.warning('请选择智能体');
      return;
    }

    setSubmitting(true);
    try {
      if (isDifyAgent) {
        // Agent eval job
        if (selectedTaskTypes.size === 0) {
          message.warning('请至少选择一个任务类型');
          return;
        }

        const job = await evalService.createJob({
          agentId: selectedAgentId,
          taskTypes: Array.from(selectedTaskTypes),
          dataMode,
          ...(dataMode === 'random' && sampleCount ? { sampleCount } : {}),
        });
        message.success('智能体评估任务已创建');
        navigate(`/eval/progress/${job.id}`);
      } else {
        // Benchmark eval job
        if (selectedBenchmarks.size === 0) {
          message.warning('请至少选择一个基准测试');
          return;
        }

        const job = await evalService.createJob({
          agentId: selectedAgentId,
          benchmarks: Array.from(selectedBenchmarks),
          ...(limit ? { limit } : {}),
          ...(judgeModel.trim() ? { judgeModel: judgeModel.trim() } : {}),
          ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
        });
        message.success('评估任务已创建');
        navigate(`/eval/progress/${job.id}`);
      }
    } catch {
      // Handled by interceptor
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- steps ---- */
  const steps = isDifyAgent
    ? [{ title: '选择智能体' }, { title: '选择任务类型' }, { title: '测试数据设置' }]
    : [{ title: '选择智能体' }, { title: '选择基准测试' }, { title: '可选配置' }];

  /* ---- loading ---- */
  if (loading) {
    return (
      <div className="flex-center" style={{ padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="eval-steps-container">
      <div className="page-header">
        <h1>新建安全评估</h1>
      </div>

      <Steps current={currentStep} items={steps} style={{ marginBottom: 24 }} />

      <div className="step-content">
        {/* ============ Step 1: Select Agent ============ */}
        {currentStep === 0 && (
          <div>
            <Form layout="vertical">
              <Form.Item label="选择要评估的智能体" required>
                <Select
                  placeholder="请选择智能体"
                  value={selectedAgentId}
                  onChange={(value) => {
                    setSelectedAgentId(value);
                    // Reset step 2 selections when agent changes
                    setSelectedBenchmarks(new Set());
                    setSelectedTaskTypes(new Set());
                  }}
                  options={agents.map((a) => ({
                    label: `${a.name} (${AGENT_TYPE_LABELS[a.agentType || 'model'] || a.agentType})${a.modelId ? ` - ${a.modelId}` : ''}`,
                    value: a.id,
                  }))}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
                  }
                  style={{ maxWidth: 560 }}
                  size="large"
                />
              </Form.Item>
              {selectedAgent && (
                <Card size="small" style={{ marginTop: 16 }}>
                  <Descriptions column={2} size="small">
                    <Descriptions.Item label="名称">{selectedAgent.name}</Descriptions.Item>
                    <Descriptions.Item label="类型">
                      <Tag color={isDifyAgent ? 'blue' : 'default'}>
                        {AGENT_TYPE_LABELS[selectedAgent.agentType || 'model']}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label={isDifyAgent ? '入口 URL' : 'API 地址'}>
                      {selectedAgent.apiBase}
                    </Descriptions.Item>
                    {!isDifyAgent && (
                      <Descriptions.Item label="模型">{selectedAgent.modelId || '-'}</Descriptions.Item>
                    )}
                  </Descriptions>
                </Card>
              )}
            </Form>
          </div>
        )}

        {/* ============ Step 2: Select Task Types / Benchmarks ============ */}
        {currentStep === 1 && isDifyAgent && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <span>已选择 <strong>{selectedTaskTypes.size}</strong> 个任务类型</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {CATEGORIES.map((cat) => {
                const checked = selectedTaskTypes.has(cat.key);
                return (
                  <Card
                    key={cat.key}
                    hoverable
                    onClick={() => toggleTaskType(cat.key)}
                    style={{
                      cursor: 'pointer',
                      border: checked ? '2px solid #1677ff' : '1px solid #f0f0f0',
                      background: checked ? '#f0f5ff' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Checkbox checked={checked} onClick={(e) => e.stopPropagation()} onChange={() => toggleTaskType(cat.key)} />
                      <span style={{ fontSize: 20, color: '#1677ff' }}>{cat.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{cat.name}</div>
                        <div style={{ fontSize: 12, color: '#999' }}>{cat.description}</div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {currentStep === 1 && !isDifyAgent && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>已选择 <strong>{selectedBenchmarks.size}</strong> 个基准测试</span>
              {selectedBenchmarks.size > 0 && (
                <Button size="small" onClick={() => setSelectedBenchmarks(new Set())}>清空选择</Button>
              )}
            </div>

            {Object.keys(benchmarksByCategory).length === 0 ? (
              <Empty description="暂无可用基准测试" />
            ) : (
              <Collapse
                items={benchmarkCollapseItems}
                defaultActiveKey={CATEGORIES.map((c) => c.key)}
                expandIconPosition="end"
                style={{ background: '#fff' }}
              />
            )}
          </div>
        )}

        {/* ============ Step 3: Config ============ */}
        {currentStep === 2 && isDifyAgent && (
          <div>
            <Form layout="vertical" style={{ maxWidth: 560 }}>
              <Form.Item label="测试数据类型" required>
                <Radio.Group value={dataMode} onChange={(e) => setDataMode(e.target.value)}>
                  <Radio.Button value="all">全部数据</Radio.Button>
                  <Radio.Button value="random">随机抽取</Radio.Button>
                </Radio.Group>
              </Form.Item>

              {dataMode === 'random' && (
                <Form.Item
                  label="抽取数量"
                  help={
                    selectedTaskTypes.size > 0
                      ? `每个任务类型约 ${Math.ceil((sampleCount || 0) / selectedTaskTypes.size)} 条`
                      : '请先选择任务类型'
                  }
                >
                  <InputNumber
                    min={1}
                    max={1000}
                    placeholder="输入总抽取数量"
                    value={sampleCount}
                    onChange={(v) => setSampleCount(v)}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              )}
            </Form>

            {/* Summary */}
            <Card size="small" title="提交摘要" style={{ marginTop: 16, maxWidth: 560 }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="智能体">
                  {selectedAgent?.name || '-'}
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    {AGENT_TYPE_LABELS[selectedAgent?.agentType || 'model']}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="入口 URL">{selectedAgent?.apiBase}</Descriptions.Item>
                <Descriptions.Item label="任务类型">
                  <Space wrap>
                    {Array.from(selectedTaskTypes).map((key) => {
                      const cat = CATEGORIES.find((c) => c.key === key);
                      return <Tag key={key}>{cat?.name || key}</Tag>;
                    })}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="测试数据">
                  {dataMode === 'all' ? '全部数据' : `随机抽取 ${sampleCount || 0} 条`}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </div>
        )}

        {currentStep === 2 && !isDifyAgent && (
          <div>
            <Form layout="vertical" style={{ maxWidth: 560 }}>
              <Form.Item label="样本数限制" help="限制每个任务的样本数量（留空表示不限制），适合快速测试">
                <InputNumber
                  min={1} max={10000} placeholder="不限制"
                  value={limit} onChange={(v) => setLimit(v)}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="裁判模型" help="用于评分的模型（留空使用默认）">
                <Input placeholder="例如 gpt-4o-mini" value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} />
              </Form.Item>
              <Form.Item label="系统提示词" help="可选，会覆盖智能体的默认系统提示词">
                <Input.TextArea rows={4} placeholder="输入自定义系统提示词..." value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
              </Form.Item>
            </Form>

            <Card size="small" title="提交摘要" style={{ marginTop: 16, maxWidth: 560 }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="智能体">{selectedAgent?.name || '-'}</Descriptions.Item>
                <Descriptions.Item label="基准测试">
                  <Space wrap>
                    {Array.from(selectedBenchmarks).map((name) => (
                      <Tag key={name}>{benchmarkLabel(name)}</Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
                {limit && <Descriptions.Item label="样本数限制">{limit}</Descriptions.Item>}
                {judgeModel.trim() && <Descriptions.Item label="裁判模型">{judgeModel.trim()}</Descriptions.Item>}
              </Descriptions>
            </Card>
          </div>
        )}
      </div>

      {/* ---- Navigation buttons ---- */}
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        {currentStep > 0 && (
          <Button onClick={() => setCurrentStep((s) => s - 1)}>上一步</Button>
        )}
        {currentStep < steps.length - 1 && (
          <Button type="primary" disabled={!canNext()} onClick={() => setCurrentStep((s) => s + 1)}>
            下一步
          </Button>
        )}
        {currentStep === steps.length - 1 && (
          <Button
            type="primary"
            loading={submitting}
            disabled={
              !selectedAgentId ||
              (isDifyAgent ? selectedTaskTypes.size === 0 : selectedBenchmarks.size === 0) ||
              (isDifyAgent && dataMode === 'random' && (!sampleCount || sampleCount <= 0))
            }
            onClick={handleSubmit}
          >
            开始评估
          </Button>
        )}
      </div>
    </div>
  );
};

export default EvalNewPage;
