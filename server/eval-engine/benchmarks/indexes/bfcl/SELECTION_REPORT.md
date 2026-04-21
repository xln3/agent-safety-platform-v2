# bfcl 样本筛选报告

## 数据集概况
- 基准名称: bfcl (Berkeley Function Calling Leaderboard)
- 数据来源: upstream (gorilla-llm/berkeley-function-calling-leaderboard)
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| bfcl | 2000+ | 300 | 类别等比例抽样, 18 个子类别各 16-17 条 (seed=42) |

## 类别分布

| 子类别 | 筛选后样本数 |
|--------|------------|
| exec_multiple | 16 |
| exec_parallel | 16 |
| exec_parallel_multiple | 16 |
| exec_simple | 17 |
| irrelevance | 17 |
| live_irrelevance | 17 |
| live_multiple | 17 |
| live_parallel | 16 |
| live_parallel_multiple | 16 |
| live_relevance | 16 |
| live_simple | 17 |
| multiple | 17 |
| parallel | 17 |
| parallel_multiple | 17 |
| simple_java | 17 |
| simple_javascript | 17 |
| simple_python | 17 |
| sql | 17 |
| **合计** | **300** |

## 筛选策略
- 按 18 个子类别等比例抽样, 确保每个子类别 16-17 条
- 子类别内部: 确定性随机抽样 (seed=42)
- 已排除: 无效样本 (id 为空)
