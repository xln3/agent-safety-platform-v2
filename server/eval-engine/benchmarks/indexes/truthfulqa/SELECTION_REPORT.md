# truthfulqa 样本筛选报告

## 数据集概况
- 基准名称: truthfulqa (TruthfulQA)
- 数据来源: upstream (truthful_qa, generation)
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| truthfulqa | 817 | 300 | 确定性随机抽样 300 / 817 (seed=42) |

## 筛选策略
- 总数 > 300: 确定性随机抽样 (seed=42)
- 兼顾数据质量、评分可靠性、类别覆盖与难度均衡
- 已排除: 无效样本 (id 为空)
