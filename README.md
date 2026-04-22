# 智能体安全测评平台 v2

基于 [agent-safety-platform](https://github.com/xln3/agent-safety-platform) 重构的全栈智能体安全评估系统，对接 16 个安全基准测试，覆盖工具调用、RAG/记忆、任务规划、业务场景四大安全维度。

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
├── _worklog/                     # 工作记录区（非交付内容）
│   ├── 01-requirements/          #   甲方重构需求文档
│   ├── 02-analysis/              #   基准数据分析中间文件
│   ├── 03-technical-docs/        #   开发过程技术文档
│   ├── 04-screenshots/           #   界面截图与截图脚本
│   └── 05-test-artifacts/        #   测试运行产物
├── DELIVERY.md                   # 交付/部署文档
├── DATABASE.md                   # 数据库文档
├── CHANGELOG.md                  # 变更记录
└── docker-compose.yml            # Docker 部署配置
```

## License

Private repository.
