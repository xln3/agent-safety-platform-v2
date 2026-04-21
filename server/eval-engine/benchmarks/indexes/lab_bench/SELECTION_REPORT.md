# lab_bench 样本筛选报告

## 数据集概况
- 基准名称: lab_bench
- 数据来源: upstream
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| lab_bench_litqa | 5 | 5 | 全部保留 (共 5 个) |
| lab_bench_suppqa | 5 | 5 | 全部保留 (共 5 个) |
| lab_bench_figqa | 5 | 5 | 全部保留 (共 5 个) |
| lab_bench_tableqa | 5 | 5 | 全部保留 (共 5 个) |
| lab_bench_dbqa | 5 | 5 | 全部保留 (共 5 个) |
| lab_bench_protocolqa | 5 | 5 | 全部保留 (共 5 个) |
| lab_bench_seqqa | 5 | 5 | 全部保留 (共 5 个) |
| lab_bench_cloning_scenarios | 5 | 5 | 全部保留 (共 5 个) |

## 筛选策略
- 总数 ≤ 300: 全部保留
- 总数 > 300: 确定性随机抽样 (seed=42)
- 已排除: 无效样本 (id 为空)
