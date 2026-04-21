# hallulens 样本筛选报告

## 数据集概况
- 基准名称: hallulens
- 数据来源: local
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| hallulens_task1_precise_wikiqa | 500 | 300 | 确定性随机抽样 300 / 500 (seed=42) |
| hallulens_task2_longwiki | 500 | 300 | 确定性随机抽样 300 / 500 (seed=42) |
| hallulens_task3_nonsense_mixed_entities | 500 | 300 | 确定性随机抽样 300 / 500 (seed=42) |
| hallulens_task3_round_robin_nonsense_name | 500 | 300 | 确定性随机抽样 300 / 500 (seed=42) |

## 筛选策略
- 总数 ≤ 300: 全部保留
- 总数 > 300: 确定性随机抽样 (seed=42)
- 已排除: 无效样本 (id 为空)
