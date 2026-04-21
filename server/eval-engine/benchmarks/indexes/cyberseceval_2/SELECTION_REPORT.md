# cyberseceval_2 样本筛选报告

## 数据集概况
- 基准名称: cyberseceval_2
- 数据来源: upstream
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| cyse2_interpreter_abuse | 489 | 300 | 确定性随机抽样 300 / 489 (seed=42) |
| cyse2_prompt_injection | 250 | 250 | 全部保留 (共 250 个) |
| cyse2_vulnerability_exploit | 124 | 124 | 全部保留 (共 124 个) |

## 筛选策略
- 总数 ≤ 300: 全部保留
- 总数 > 300: 确定性随机抽样 (seed=42)
- 已排除: 无效样本 (id 为空)
