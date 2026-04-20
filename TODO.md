# 智能体安全测评平台 — 待修复清单

> 基于原始重构需求 + 2026-04-21 全面审计结果整理
> 状态标记: [ ] 待修复 / [x] 已完成

---

## 一、原始需求对照

### 1. 智能体基本信息增删改查

- [x] Agent CRUD API（`/api/agents`，RESTful）
- [x] 前端 AgentListPage + AgentDetailPage + AgentFormModal
- [x] 数据模型 Agent（name, apiBase, apiKey, modelId, systemPrompt, toolsEnabled, ragEnabled 等）
- [ ] **Agent API Key 不应在 GET 响应中返回明文**
  - 文件: `server/src/controllers/agentController.ts`
  - 问题: `GET /api/agents` 和 `GET /api/agents/:id` 返回完整 Agent 对象含 apiKey
  - 修复: 使用 Sequelize `attributes: { exclude: ['apiKey'] }` 或响应时脱敏（仅显示后 4 位）
- [ ] **Agent name 无唯一约束**
  - 文件: `server/src/models/Agent.ts`
  - 问题: 可创建同名智能体，UI 无法区分
  - 修复: 加 `unique: true`

### 2. 智能体评估

- [x] 评估任务创建 / 列表 / 详情 / 删除（`/api/eval/jobs`）
- [x] 评估进度实时展示（EvalProgressPage 轮询）
- [x] 四大优先分类已接入: 工具调用(5)、RAG/记忆安全(2)、任务规划(5)、商业安全(4) = 16 个核心基准
- [x] 纯 TS 编排（Python 编排层已删除）
- [x] per-benchmark Python venv 隔离
- [x] 数据集离线缓存机制（datasetService + prepare-datasets 脚本）
- [x] HuggingFace 离线模式（HF_DATASETS_OFFLINE=1 等环境变量）
- [x] 磁盘检测 fallback（checkDiskForDataset，本次修复）

**待修复:**

- [ ] **基准数量对齐: catalog 64 个 vs UI 仅展示 16 个**
  - 文件: `server/src/services/catalogService.ts`、`src/page/EvalNewPage.tsx`
  - 问题: catalog.yaml 定义 64 个基准，但 CATEGORY_BENCHMARK_MAP 只映射 16 个到 4 大类，其余 48 个归入 "other" 类别。前端可以选但用户不知道它们属于什么
  - 修复方案: (A) 将 48 个基准归入合理子类别并在 UI 展示；或 (B) 文档明确说明"16 个核心 + 48 个扩展"
- [ ] **并发评估竞态条件**
  - 文件: `server/src/services/evalRunner.ts`
  - 问题 1: `completedCount++` 非原子操作（多 Promise 并发修改）
  - 问题 2: `findLatestEvalFile()` 用子串匹配模型名，并发跑同模型可能匹配到错误的 .eval 文件
  - 修复: completedCount 改为 Sequelize 计数查询；findLatestEvalFile 加任务 ID 精确匹配
- [ ] **子进程 stdout/stderr 无大小限制**
  - 文件: `server/src/services/evalRunner.ts`（约 line 376-400）
  - 问题: 变量持续拼接输出，长时间评估可能 OOM
  - 修复: 限制最大缓冲（如 10MB），超出后只保留尾部
- [ ] **venv setup 无超时**
  - 文件: `server/src/services/venvService.ts`
  - 问题: pip install 挂住时无超时机制，会无限阻塞任务
  - 修复: 加 30 分钟超时
- [ ] **评估任务输入校验不足**
  - 文件: `server/src/controllers/evalController.ts`（line 17-28）
  - 问题: benchmark 名称不验证合法性，limit 可为负数，无效 benchmark 被静默跳过而非返回 400
  - 修复: 用 zod 或手动校验，未知 benchmark 返回错误

### 3. 评估报告

- [x] 报告自动生成（evaluateJob 完成后调用 reportService）
- [x] 报告列表 / 详情页（ReportListPage + ReportDetailPage）
- [x] 按类别展示分数 + 风险等级 + 中文解读
- [x] HTML 报告内容生成（reportService.buildReportHtml）
- [x] XSS 防护（escapeHtml 函数）

**待修复:**

- [ ] **报告 HTML 拼接易遗漏转义**
  - 文件: `server/src/services/reportService.ts`
  - 问题: 手动调用 `escapeHtml()`，新增字段容易忘记
  - 建议: 低优先级，当前覆盖完整，后续可考虑模板引擎

---

## 二、代码规范合规

### 命名规范
- [x] 变量/函数: 小驼峰（taskStatus, handleSubmit）
- [x] 类/类型/组件: 大驼峰（AgentListPage, DatasetSpec, EvalJob）
- [x] 常量: 全大写下划线（MAX_COUNT, EVAL_STATUS, DATASET_CACHE_DIR）
- [x] 文件目录结构: 前端 src/{page,components,services,style}，后端 server/src/{routes,controllers,services,models,utils,config,constants}

### API 规范
- [x] 统一 /api 前缀（app.ts:28 `app.use('/api', routes)`）
- [x] RESTful 风格（GET/POST/PUT/DELETE）
- [x] 统一响应格式 `{ code, message, data }`

### 数据库规范
- [x] MySQL + Sequelize
- [x] 时间字段: createdAt / updatedAt（Sequelize timestamps: true）
- [x] DB 列名下划线（Sequelize `underscored: true` 自动转换 camelCase → snake_case）
- [x] 时间类型: DataTypes.DATE (对应 MySQL datetime)

### TypeScript
- [x] 前端 strict 模式编译通过
- [x] 后端编译通过（零错误）

---

## 三、安全问题

| 优先级 | 问题 | 文件 | 修复方案 |
|--------|------|------|----------|
| [ ] 高 | API 无认证鉴权 | `server/src/app.ts` | 加 JWT 或固定 Token 中间件，至少保护写操作 |
| [ ] 高 | Agent apiKey 明文返回 | `server/src/controllers/agentController.ts` | GET 响应排除 apiKey 字段 |
| [ ] 高 | Agent apiKey 数据库明文 | `server/src/models/Agent.ts` | 加密存储（AES），使用时解密 |
| [ ] 中 | 无安全 HTTP 头 | `server/src/app.ts` | 集成 helmet.js |
| [ ] 中 | CORS 生产配置 | `server/src/app.ts` | 确保 CORS_ORIGINS 在生产环境配置正确域名 |
| [ ] 中 | 子进程环境变量暴露 apiKey | `server/src/services/evalRunner.ts` | 进程环境变量不可避免，但应确保日志不打印 |
| [ ] 低 | 日志可能泄露 API Key | `server/src/services/evalRunner.ts` | debug 日志 spawn 命令前过滤敏感环境变量 |

---

## 四、工程质量

| 优先级 | 问题 | 修复方案 |
|--------|------|----------|
| [ ] 高 | 零单元测试 | 配置 vitest；优先覆盖 scoreMapper, evalRunner, reportService |
| [ ] 高 | 无 CI/CD | 添加 GitHub Actions: tsc + vitest + lint |
| [ ] 高 | 无 Dockerfile | 编写 Dockerfile + docker-compose.yml（app + mysql） |
| [ ] 中 | 无 ESLint/Prettier | 添加统一格式化配置 |
| [ ] 中 | 无数据库迁移 | 引入 sequelize-cli，替代 sync({ alter: true }) |
| [ ] 中 | 无 404 兜底路由 | `src/App.tsx` 加 `<Route path="*" />` |
| [ ] 中 | 外键无级联删除 | models 加 `onDelete: 'CASCADE'` |
| [ ] 中 | 外键列无索引 | models 加 `indexes` 定义 |
| [ ] 低 | 前端 bundle 2.3MB | 按路由做 code splitting（React.lazy） |
| [ ] 低 | 日志无结构化 | 替换为 pino/winston，输出 JSON 格式 |

---

## 五、文档与交付

| 优先级 | 问题 | 修复方案 |
|--------|------|----------|
| [ ] 高 | DELIVERY.md 缺离线运行说明 | 补充: 运行 setup:venvs + prepare:datasets → 全程离线 |
| [ ] 高 | DELIVERY.md 未说明基准数量 | 补充: 16 核心基准(4 类) + 48 扩展基准 = 64 总计 |
| [ ] 中 | DELIVERY.md 未提 HF_TOKEN | 补充: xstest/gaia 需要 HF_TOKEN，其余不需要 |
| [ ] 中 | DELIVERY.md 未提 venv 耗时 | 补充: 首次 setup:venvs 约 30-60 分钟 |
| [ ] 中 | 3 个未提交的改动 | 提交 datasetService / environmentBuilder / venvService |
| [ ] 低 | 分析目录未清理 | 将 *-analysis/ 加入 .gitignore |

---

## 六、已完成的重构工作（留档）

- [x] Python 编排层迁移到 TypeScript（删除 run-eval.py / score_mapper.py / preflight.py）
- [x] 纯 TS 服务: evalRunner, scoreMapper, commandBuilder, environmentBuilder, preflightService, venvService, dockerService, indexService, datasetService
- [x] 前端报告页重构（ReportDetailPage + ReportCategoryDetail + ReportSummaryCards）
- [x] SafeRAG 数据自包含（nctd.json 内置）
- [x] BFCL 数据内置（benchmarks/data/bfcl/）
- [x] 数据集状态磁盘检测 + manifest 自动修复
- [x] E2E test-id 标注
- [x] 旧文件清理（截图、e2e 脚本、Python 文件）
- [x] Ant Design deprecated API 修复（valueStyle → styles.content）
