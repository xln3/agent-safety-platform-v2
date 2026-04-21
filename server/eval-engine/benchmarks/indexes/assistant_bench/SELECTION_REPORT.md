# assistant_bench 样本筛选报告

## 数据集概况
- 基准名称: assistant_bench
- 数据来源: upstream
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| assistant_bench_closed_book | 33 | 33 | 全部保留 (共 33 个) |
| assistant_bench_web_browser | 6 | 6 | 全部保留 (共 6 个) |

## 筛选策略
- 总数 ≤ 300: 全部保留
- 总数 > 300: 确定性随机抽样 (seed=42)
- 已排除: 无效样本 (id 为空)
