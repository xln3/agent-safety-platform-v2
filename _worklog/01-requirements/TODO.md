# 智能体安全测评平台 — 待修复清单

> 基于原始重构需求 + 2026-04-21 全面审计结果整理
> 状态标记: [ ] 待修复 / [x] 已完成

---

## 一、原始需求对照

### 1. 智能体基本信息增删改查

- [x] Agent CRUD API（`/api/agents`，RESTful）
- [x] 前端 AgentListPage + AgentDetailPage + AgentFormModal
- [x] 数据模型 Agent（name, apiBase, apiKey, modelId, systemPrompt, toolsEnabled, ragEnabled 等）
- [x] **Agent API Key 不应在 GET 响应中返回明文** — `attributes: { exclude: ['apiKey'] }`
- [x] **Agent name 唯一约束** — `unique: true`

### 2. 智能体评估

- [x] 评估任务创建 / 列表 / 详情 / 删除（`/api/eval/jobs`）
- [x] 评估进度实时展示（EvalProgressPage 轮询）
- [x] 四大优先分类已接入: 工具调用(5)、RAG/记忆安全(2)、任务规划(5)、商业安全(4) = 16 个核心基准
- [x] 纯 TS 编排（Python 编排层已删除）
- [x] per-benchmark Python venv 隔离
- [x] 数据集离线缓存机制（datasetService + prepare-datasets 脚本）
- [x] HuggingFace 离线模式（HF_DATASETS_OFFLINE=1 等环境变量）
- [x] 磁盘检测 fallback（checkDiskForDataset，本次修复）
- [x] **基准数量对齐** — catalogService.ts 文档化分类策略，DELIVERY.md 说明 16 核心 + 扩展
- [x] **并发评估竞态修复** — completedCount 改为 DB 查询，findLatestEvalFile 精确匹配
- [x] **子进程 stdout/stderr 10MB 大小限制**
- [x] **venv setup 30 分钟超时**
- [x] **评估任务输入校验** — benchmark 名称、limit 范围、judgeModel 格式校验

### 3. 评估报告

- [x] 报告自动生成（evaluateJob 完成后调用 reportService）
- [x] 报告列表 / 详情页（ReportListPage + ReportDetailPage）
- [x] 按类别展示分数 + 风险等级 + 中文解读
- [x] HTML 报告内容生成（reportService.buildReportHtml）
- [x] XSS 防护（escapeHtml 函数）

**后续优化:**

- [ ] **报告 HTML 拼接易遗漏转义** — 低优先级，当前覆盖完整，后续可考虑模板引擎

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

| 状态 | 优先级 | 问题 | 修复 |
|------|--------|------|------|
| [x] | 高 | API 无认证鉴权 | Bearer Token 中间件（API_TOKEN 环境变量） |
| [x] | 高 | Agent apiKey 明文返回 | GET 响应 exclude apiKey |
| [ ] | 高 | Agent apiKey 数据库明文 | 加密存储（AES），使用时解密 |
| [x] | 中 | 无安全 HTTP 头 | helmet.js 已集成 |
| [ ] | 中 | CORS 生产配置 | 部署时配置 CORS_ORIGINS |
| [ ] | 低 | 日志可能泄露 API Key | debug 日志过滤敏感环境变量 |

---

## 四、工程质量

| 状态 | 优先级 | 问题 | 修复 |
|------|--------|------|------|
| [x] | 高 | 零单元测试 | vitest + 86 个测试（scoreMapper/datasetService/reportService） |
| [x] | 高 | 无 CI/CD | GitHub Actions: tsc + test + build |
| [x] | 高 | 无 Dockerfile | Dockerfile + docker-compose.yml（server + mysql） |
| [ ] | 中 | 无 ESLint/Prettier | 添加统一格式化配置 |
| [ ] | 中 | 无数据库迁移 | 引入 sequelize-cli，替代 sync({ alter: true }) |
| [x] | 中 | 无 404 兜底路由 | NotFoundPage + `<Route path="*">` |
| [x] | 中 | 外键无级联删除 | onDelete: 'CASCADE' |
| [x] | 中 | 外键列无索引 | indexes 定义 |
| [ ] | 低 | 前端 bundle 2.3MB | 按路由做 code splitting（React.lazy） |
| [ ] | 低 | 日志无结构化 | 替换为 pino/winston，输出 JSON 格式 |

---

## 五、文档与交付

| 状态 | 优先级 | 问题 | 修复 |
|------|--------|------|------|
| [x] | 高 | DELIVERY.md 缺离线运行说明 | 新增"离线运行保障"章节 |
| [x] | 高 | DELIVERY.md 未说明基准数量 | 新增"基准测试覆盖范围"章节 |
| [x] | 中 | DELIVERY.md 未提 HF_TOKEN | 已补充 |
| [x] | 中 | DELIVERY.md 未提 venv 耗时 | 已补充 |
| [x] | 中 | 3 个未提交的改动 | 已提交（commit 496af16） |
| [x] | 低 | 分析目录未清理 | *-analysis/ 已加入 .gitignore |

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
- [x] 安全加固（auth 中间件、helmet、apiKey 脱敏、模型索引/级联）
- [x] 评估引擎健壮性（竞态修复、stdout 限制、venv 超时、输入校验）
- [x] 测试基础设施（vitest + 86 个单元测试）
- [x] Docker + CI/CD（Dockerfile、docker-compose、GitHub Actions）
- [x] 文档补全（DELIVERY.md 离线/基准/Docker 章节、404 页面）
