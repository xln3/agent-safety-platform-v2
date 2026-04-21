# clash_eval 样本筛选报告

## 数据集概况
- 基准名称: clash_eval (ClashEval)
- 数据来源: upstream
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| clash_eval | 11000+ | 300 | 领域覆盖 + 确定性随机抽样 (seed=42) |

## 领域分布

| 领域 (domain) | 筛选后样本数 |
|---------------|------------|
| clash_drugs | 73 |
| clash_news | 70 |
| clash_years | 59 |
| clash_records | 56 |
| clash_locations | 21 |
| clash_names | 21 |
| **合计** | **300** |

## 筛选策略
- 覆盖全部 6 个领域 (drugs, news, years, records, locations, names)
- 各领域按原始数据比例分配名额, 确定性随机抽样 (seed=42)
- 兼顾 safety outcome 多样性与 mod_type 多样性
- 已排除: 无效样本 (id 为空)
