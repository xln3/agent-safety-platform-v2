# 智能体安全测评平台 v2

基于 [agent-safety-platform](https://github.com/xln3/agent-safety-platform) 重构的全栈智能体安全评估系统，对接 16 个安全基准测试，覆盖工具调用、RAG/记忆、任务规划、业务场景四大安全维度。

## 重构要求

### 代码规范

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

### 基本要求

1. 智能体基本信息的增删改查
2. 智能体评估（优先工具调用、RAG/记忆安全、任务规划、业务场景安全四个分类，其余评估任务依次接入），要求评估过程中需要的资源离线化
3. 智能体评估报告

### 离线化要求

> "因为我们现在的平台整个是 TS 的，我们要把这些测试项整个集成起来，所以这些可能要用 TS 重写一下"

> "有些他不是还依赖于 HF 上的数据，这些数据要可以离线的"

> "因为我之前运行的时候发现他有些时候会再去 HF 上下载，就算本地有他也会先执行解析的一个操作，速度很慢。所以能不能直接把本地文件都弄好，直接点就是评测了，而不用再去下再去解析啥的"

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + Ant Design 6 + ECharts + Vite 8 + TypeScript |
| 后端 | Node.js + Express 5 + Sequelize + MySQL |
| 评估引擎 | Python 3.10 + inspect_ai（TypeScript 编排，Python 仅作 CLI 执行边界） |
| 测试 | Vitest（单元）+ Playwright（E2E） |
| 部署 | Docker Compose（可选）/ 直接运行 |

## 架构

```
┌────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  React SPA     │────▶│  Express API (:3002)  │────▶│  Python subprocess  │
│  Vite (:5173)  │◀────│  Sequelize + MySQL    │◀────│  inspect eval CLI   │
└────────────────┘     └──────────────────────┘     └─────────────────────┘
                              │                            │
                              ▼                            ▼
                        ┌──────────┐              ┌──────────────┐
                        │  MySQL   │              │  per-benchmark│
                        │  :3306   │              │  .venvs/      │
                        └──────────┘              └──────────────┘
```

**核心流程**：前端创建评测任务 → 后端为每个 benchmark 启动子进程 → `inspect eval` CLI 在独立 venv 中运行 → 解析 `.eval` 结果文件 → 计算安全评分 → 存库 → 前端轮询展示

## 快速开始

```bash
# 1. 创建数据库
mysql -u root -p -e "CREATE DATABASE agent_safety_platform CHARACTER SET utf8mb4;"

# 2. 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env 填入数据库密码和 LLM API 信息

# 3. 安装依赖 + 建表
npm install
cd server && npm install && npm run db:sync && cd ..

# 4. 启动（两个终端）
cd server && npm run dev    # 后端 :3002
npm run dev                 # 前端 :5173
```

浏览器打开 http://localhost:5173

> 详细部署说明、Docker 部署、离线预缓存等请参阅 [DELIVERY.md](./DELIVERY.md)

## 评估模块

| 模块 | 说明 | 基准测试 |
|------|------|----------|
| 工具调用安全 | 测试智能体是否会被诱导执行危险工具操作 | agentdojo, bfcl, b3, agentharm, open_agent_safety |
| RAG/记忆安全 | 测试知识库投毒、信息泄露防护能力 | saferag, clash_eval |
| 任务规划安全 | 测试多步骤规划中的安全风险识别能力 | safeagentbench, gaia, mind2web, mind2web_sc, assistant_bench |
| 业务场景安全 | 测试金融合规、隐私合规等业务场景 | raccoon, healthbench, truthfulqa, gdpval |

## 目录结构

```
agent-safety-platform-refractor/
├── src/                          # 前端
│   ├── page/                     #   页面组件
│   ├── components/               #   通用组件
│   ├── services/                 #   API 请求
│   └── style/                    #   样式
├── server/                       # 后端
│   ├── src/
│   │   ├── routes/               #   路由定义
│   │   ├── controllers/          #   控制器
│   │   ├── services/             #   业务逻辑（含 evalRunner 编排核心）
│   │   ├── models/               #   Sequelize 数据模型
│   │   ├── constants/            #   常量与枚举
│   │   ├── config/               #   配置加载
│   │   └── utils/                #   工具函数
│   └── eval-engine/              # 评估引擎
│       ├── benchmarks/
│       │   ├── catalog.yaml      #   基准注册表（69 个基准定义）
│       │   ├── eval_benchmarks/  #   本地 benchmark Python 实现
│       │   ├── data/             #   离线数据集
│       │   ├── indexes/          #   样本 ID 索引
│       │   └── patches/          #   框架兼容性补丁
│       ├── .venvs/               #   Python 虚拟环境（自动生成）
│       ├── datasets-cache/       #   HF/HTTP 数据集缓存
│       └── results/              #   评估结果（.eval 文件）
├── e2e/                          # Playwright E2E 测试
├── DELIVERY.md                   # 交付/部署文档
├── DATABASE.md                   # 数据库文档
└── docker-compose.yml            # Docker 部署配置
```

## License

Private repository.
