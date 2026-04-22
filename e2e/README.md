# E2E 测试用例

基于 Playwright 的端到端验收测试，覆盖平台全部核心功能。

## 运行方式

```bash
# 前提：前端 (:5173) 和后端 (:3002) 均已启动
npx playwright test e2e/<spec-file>
```

## 测试用例

| 文件 | 说明 | 覆盖范围 |
|------|------|----------|
| `acceptance.spec.cjs` | 甲方验收测试（主测试） | 页面加载与导航、智能体 CRUD、评估任务创建与执行、报告查看 |
| `four-categories.spec.js` | 四大评估分类闭环验收 | 工具调用 / RAG记忆 / 任务规划 / 业务场景的创建→结果→报告全链路 |
| `smoke-test.spec.js` | 冒烟测试 | 所有页面可加载、数据正常渲染、无 console 报错 |
| `eval-flow.spec.js` | 评估流程验证 | 评估列表、进度展示、结果页面、数据集样本页 |
| `report-verify.spec.js` | 报告页面验证 | 报告列表与详情页渲染、summary schema 正确性 |
| `export-verify.spec.js` | HTML 导出验证 | 下载报告 HTML、独立渲染、结构完整性检查 |

## 辅助资源

- `report/` — 报告渲染相关的测试数据和模板
