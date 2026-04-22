# 重构要求

> 提取自项目 README.md，为甲方原始重构需求。

## 代码规范

- **前端**：React
- **后端**：Node.js + Express + TypeScript
- **数据库**：MySQL，时间格式使用 datetime，字段名多个单词使用下划线
- **命名规范**：
  - 变量与函数使用小驼峰命名（`taskStatus`）
  - 类、类型和组件使用大驼峰（`LoginForm`）
  - 常量使用全大写加下划线（`MAX_COUNT`）
- **文件目录**：
  - 前端放在 `src/` 目录下：页面级模块（`page/`），通用组件模块（`components/`），接口请求组件（`services/`），CSS 资源（`style/`）
  - 后端放在 `server/` 目录下：路由定义（`routes/`），控制器（`controllers/`），业务逻辑（`services/`），数据模型（`models/`），工具函数（`utils/`），常量（`constants/`），配置文件（`config/`）
- **接口规范**：所有接口统一使用 `/api` 前缀；接口优先遵循 RESTful 风格；时间字段统一使用 `createdAt`、`updatedAt`

## 基本要求

1. 智能体基本信息的增删改查
2. 智能体评估（优先工具调用、RAG/记忆安全、任务规划、业务场景安全四个分类，其余评估任务依次接入），要求评估过程中需要的资源离线化
3. 智能体评估报告

## 离线化与集成要求

- 平台整体使用 TypeScript 技术栈，各评估基准需统一集成至 TS 后端进行编排调度
- 评估所依赖的 HuggingFace 数据集等外部资源须支持完全离线运行，不允许运行时再去远端下载或解析
- 所有数据集应预先缓存到本地，用户点击"开始评估"即可直接执行，无需等待下载和解析流程

## 关于 Python 保留的说明

评估引擎底层依赖 [inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) 框架及各基准测试库（如 `inspect_evals`、`agentdojo`、`safeagentbench` 等），这些库本身是 Python 生态的学术实现，涉及大量 NLP 工具链（tokenizer、scorer、dataset loader），不具备改写为 TypeScript 的可行性，也无必要——它们作为**评估执行层**被 TypeScript 后端以子进程方式调用（`inspect eval` CLI），与后端的运行互不耦合：

- TypeScript 后端负责：任务编排、并发控制、环境构建、结果解析、评分计算、数据库存储、API 服务
- Python 子进程负责：执行单个 benchmark 的具体评测逻辑，输出标准化的 `.eval` 结果文件

两者通过 CLI + 文件系统交互，Python 部分对 TS 后端而言是一个黑盒可执行单元，不影响后端的类型安全性和运行稳定性。
