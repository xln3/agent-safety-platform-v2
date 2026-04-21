# gdm_self_reasoning 样本筛选报告

## 数据集概况
- 基准名称: gdm_self_reasoning
- 数据来源: upstream
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| gdm_approved_directories | 2 | 2 | 全部保留 (共 2 个) |
| gdm_calculator_improvement | 2 | 2 | 全部保留 (共 2 个) |
| gdm_context_length_mod_instrumental_only | 2 | 2 | 全部保留 (共 2 个) |
| gdm_context_length_mod_irreversibility_only | 2 | 2 | 全部保留 (共 2 个) |
| gdm_database_tool | 2 | 2 | 全部保留 (共 2 个) |
| gdm_latency_calculator | 2 | 2 | 全部保留 (共 2 个) |
| gdm_max_messages_calculator | 2 | 2 | 全部保留 (共 2 个) |
| gdm_max_tokens | 2 | 2 | 全部保留 (共 2 个) |
| gdm_oversight_frequency | 2 | 2 | 全部保留 (共 2 个) |
| gdm_read_logs | 2 | 2 | 全部保留 (共 2 个) |
| gdm_turn_off_filters | 2 | 2 | 全部保留 (共 2 个) |

## 筛选策略
- 总数 ≤ 300: 全部保留
- 总数 > 300: 确定性随机抽样 (seed=42)
- 已排除: 无效样本 (id 为空)
