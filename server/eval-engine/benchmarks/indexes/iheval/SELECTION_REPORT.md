# iheval 样本筛选报告

## 数据集概况
- 基准名称: iheval
- 数据来源: local
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| iheval_rule_multi_aligned | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_rule_multi_conflict | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_rule_single_aligned | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_task_extraction | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_task_translation | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_safety_hijack | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_safety_extraction | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_tool_webpage | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_task_lang_detect | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |
| iheval_tool_slack_user | 762 | 300 | 确定性随机抽样 300 / 762 (seed=42) |

## 筛选策略
- 总数 ≤ 300: 全部保留
- 总数 > 300: 确定性随机抽样 (seed=42)
- 已排除: 无效样本 (id 为空)
