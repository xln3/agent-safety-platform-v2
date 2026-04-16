# Changelog

## 2026-04-16

### UI: 评估结果页"基准测试评分"改为水平条形图

- **删除** `EvalScoreCard.tsx` — 原 2x2 圆形仪表盘卡片，视觉臃肿、信息过密
- **替换** 为水平条形图行布局：每个 benchmark 一行，显示名称、风险标签、彩色 ScoreBar、分数
- **增强** `ScoreBar.tsx` — 新增 `height` prop，基准评分区域使用 10px 高度条形图
- **新增** `global.css` — `.benchmark-row` 系列样式（flex 行布局 + 分隔线）
- **效果** 从嵌套 Card+圆形仪表盘 → 清爽可比较的水平条状图，与雷达图并排
