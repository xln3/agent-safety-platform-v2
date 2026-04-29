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
} from 'antd';
import {
  SafetyOutlined,
  DatabaseOutlined,
  ApartmentOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { agentService, AGENT_TYPE_LABELS } from '../services/agentService';
import { evalService } from '../services/evalService';
import { judgeModelService } from '../services/judgeModelService';
import type { Agent } from '../services/agentService';
import type { BenchmarkInfo, TaskMeta } from '../services/evalService';
import type { JudgeModel } from '../services/judgeModelService';

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
  const [judgeModels, setJudgeModels] = useState<JudgeModel[]>([]);
  const [loading, setLoading] = useState(false);

  /* ---- form state ---- */
  const [selectedAgentId, setSelectedAgentId] = useState<number | undefined>(
    preselectedAgentId ? parseInt(preselectedAgentId, 10) : undefined,
  );
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState<number | null>(null);
  const [judgeModelId, setJudgeModelId] = useState<number | undefined>(undefined);
  const [systemPrompt, setSystemPrompt] = useState('');
  /**
   * 仅采样模式：勾选后跳过裁判模型，只产出样本数据。
   * 与「裁判模型」字段互斥 —— 勾选时 judgeModelId 强制清空、判定 judgeRequired
   * 也整体绕过（甲方明确要求快速跑样本）。
   */
  const [skipJudge, setSkipJudge] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* ---- derived ---- */
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const isDifyAgent = selectedAgent?.agentType === 'dify_chat' || selectedAgent?.agentType === 'dify_workflow';

  /**
   * Whether any selected benchmark advertises a `judgeModel` in the catalog —
   * mirrors the backend evalController gate. When true the judge field becomes
   * required (red asterisk) and submit is blocked until a JudgeModel is
   * picked. Source of truth is the catalog field; the frontend simply surfaces
   * the same constraint visually so the user does not run into a 400.
   */
  const benchmarksNeedingJudge = useMemo(() => {
    const flat: BenchmarkInfo[] = Object.values(benchmarksByCategory).flat();
    return flat.filter((b) => selectedBenchmarks.has(b.name) && b.judgeModel);
  }, [benchmarksByCategory, selectedBenchmarks]);
  const judgeRequired = benchmarksNeedingJudge.length > 0;

  /* ---- fetch data on mount ---- */
  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentData, benchmarks, meta, judges] = await Promise.all([
        agentService.list({ page: 1, pageSize: 100 }),
        evalService.getBenchmarks(),
        evalService.getTaskMeta(),
        judgeModelService.list({ page: 1, pageSize: 100 }),
      ]);

      setAgents(agentData.list || []);
      setTaskMeta(meta || {});
      setJudgeModels(judges.list || []);

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

  /* ---- benchmark helpers ---- */
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

  /* ---- Collapse items for benchmark hierarchy ---- */
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
        return selectedBenchmarks.size > 0;
      case 2:
        return true;
      default:
        return false;
    }
  };

  /* ---- submit ---- */
  const handleSubmit = async () => {
    if (!selectedAgentId || selectedBenchmarks.size === 0) {
      message.warning('请选择智能体和基准测试');
      return;
    }
    // 仅采样模式不调用裁判 → 跳过裁判必填校验
    if (!skipJudge && judgeRequired && !judgeModelId) {
      message.warning(
        `以下 benchmark 需要裁判模型：${benchmarksNeedingJudge.map((b) => b.name).join(', ')}`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const job = await evalService.createJob({
        agentId: selectedAgentId,
        benchmarks: Array.from(selectedBenchmarks),
        ...(limit ? { limit } : {}),
        ...(skipJudge ? { skipJudge: true } : (judgeModelId ? { judgeModelId } : {})),
        ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
      });
      message.success('评估任务已创建');
      navigate(`/eval/progress/${job.id}`);
    } catch {
      // Handled by interceptor
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- steps ---- */
  const steps = [
    { title: '选择智能体' },
    { title: '选择基准测试' },
    { title: '可选配置' },
  ];

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
                    setSelectedBenchmarks(new Set());
                  }}
                  options={agents.map((a) => {
                    const typeLabel = AGENT_TYPE_LABELS[a.agentType] || a.agentType;
                    const cfg = (a.config || {}) as { modelId?: string };
                    const modelHint = cfg.modelId || a.modelId;
                    return {
                      label: `${a.name} (${typeLabel})${modelHint ? ` - ${modelHint}` : ''}`,
                      value: a.id,
                    };
                  })}
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
                        {AGENT_TYPE_LABELS[(selectedAgent.agentType as 'openai_compat' | 'dify_chat' | 'dify_workflow' | 'cli')]}
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

        {/* ============ Step 2: Select Benchmarks ============ */}
        {currentStep === 1 && (
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

        {/* ============ Step 3: Optional Config ============ */}
        {currentStep === 2 && (
          <div>
            <Form layout="vertical" style={{ maxWidth: 560 }}>
              <Form.Item label="样本数限制" help="限制每个任务的样本数量（留空表示不限制），适合快速测试">
                <InputNumber
                  min={1} max={10000} placeholder="不限制"
                  value={limit} onChange={(v) => setLimit(v)}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item
                label="仅采样模式"
                help="勾选后跳过裁判模型，只产出 prompt / 标准答案 / 模型输出，节省 token；结果不会有评分 / 风险等级 / 维度评估。"
              >
                <Checkbox
                  checked={skipJudge}
                  onChange={(e) => {
                    setSkipJudge(e.target.checked);
                    if (e.target.checked) setJudgeModelId(undefined);
                  }}
                >
                  仅采样（不调用裁判模型）
                </Checkbox>
              </Form.Item>
              {!skipJudge && (
                <Form.Item
                  label="裁判模型"
                  required={judgeRequired}
                  validateStatus={judgeRequired && !judgeModelId ? 'error' : undefined}
                  help={
                    judgeRequired ? (
                      <span style={{ color: '#b91c1c' }}>
                        已选 benchmark 需要裁判模型：{benchmarksNeedingJudge.map((b) => b.name).join(', ')}
                      </span>
                    ) : (
                      '用于打分的裁判模型（部分 benchmark 必填，未选时不依赖裁判可留空）'
                    )
                  }
                >
                  <Select
                    placeholder={judgeRequired ? '请选择裁判模型（必填）' : '请选择裁判模型（可选）'}
                    value={judgeModelId}
                    onChange={(v) => setJudgeModelId(v as number | undefined)}
                    allowClear
                    options={judgeModels.map((j) => ({
                      value: j.id,
                      label: `${j.name} (${j.modelId})`,
                    }))}
                  />
                </Form.Item>
              )}
              <Form.Item label="系统提示词" help="可选，会覆盖智能体的默认系统提示词">
                <Input.TextArea rows={4} placeholder="输入自定义系统提示词..." value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
              </Form.Item>
            </Form>

            <Card size="small" title="提交摘要" style={{ marginTop: 16, maxWidth: 560 }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="智能体">
                  {selectedAgent?.name || '-'}
                  <Tag color={isDifyAgent ? 'blue' : 'default'} style={{ marginLeft: 8 }}>
                    {AGENT_TYPE_LABELS[(selectedAgent?.agentType as 'openai_compat' | 'dify_chat' | 'dify_workflow' | 'cli') || 'openai_compat']}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="基准测试">
                  <Space wrap>
                    {Array.from(selectedBenchmarks).map((name) => (
                      <Tag key={name}>{benchmarkLabel(name)}</Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
                {limit && <Descriptions.Item label="样本数限制">{limit}</Descriptions.Item>}
                {skipJudge ? (
                  <Descriptions.Item label="模式">
                    <Tag>仅采样</Tag>
                  </Descriptions.Item>
                ) : (
                  judgeModelId && (
                    <Descriptions.Item label="裁判模型">
                      {judgeModels.find((j) => j.id === judgeModelId)?.name || `#${judgeModelId}`}
                    </Descriptions.Item>
                  )
                )}
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
              selectedBenchmarks.size === 0 ||
              (!skipJudge && judgeRequired && !judgeModelId)
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
