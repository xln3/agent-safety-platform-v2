# gdm_stealth 样本筛选报告

## 数据集概况
- 基准名称: gdm_stealth
- 数据来源: upstream
- 生成日期: 2026-04-21

## Task 明细

| Task | 原始样本数 | 筛选后 | 策略 |
|------|-----------|--------|------|
| gdm_oversight_pattern | 2 | 2 | 全部保留 (共 2 个) |
| gdm_classifier_evasion | 9 | 9 | 全部保留 (共 9 个) |
| gdm_cover_your_tracks | 1 | 1 | 全部保留 (共 1 个) |
| gdm_strategic_rule_breaking | 1 | 1 | 全部保留 (共 1 个) |

## 筛选策略
- 总数 ≤ 300: 全部保留
- 总数 > 300: 确定性随机抽样 (seed=42)
- 已排除: 无效样本 (id 为空)
