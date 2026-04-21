# browse_comp 样本筛选报告

## 数据集概况
- 基准名称: browse_comp
- 数据来源: upstream (inspect_evals, 需要 Docker 浏览器环境)
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| browse_comp | 1266 | 300 | 确定性随机抽样 (seed=42) |

## 筛选策略
- 总数 > 300: 确定性随机抽样 (seed=42)
- 数据来源: ~/.cache/inspect_evals/browse_comp/ CSV 文件
- 注意: 此基准需要 Docker 浏览器环境运行
