# 智能体安全评估平台 v2 — 交付说明

> **本文档目的**：项目整体交接说明（架构、配置、部署、使用）。
>
> 配套文档：
> - **`DEPLOY.md`** — 把代码部署到一台新服务器的全流程（含 systemd unit、安全组、外网验证）。
> - **`操作手册.md`** — 给非技术对接人的日常操作手册（创建智能体、跑评估、看报告、平台挂了怎么办）。
> - **`DATABASE.md`** — 数据表结构。
> - **`CHANGELOG.md`** — 历次修改记录。

---

## 一、平台简介

把任意"智能体"接入平台后，跑一组安全基准测试（共 69 个 benchmark），自动出**安全分（0–100）+ 风险等级 + 雷达图 + 每条样本详情**，并可导出报告。

支持 4 种智能体形态：

| 形态 | 用途 |
|------|------|
| `openai_compat` | 任何兼容 OpenAI Chat API 的服务（OpenAI / 阿里 / 智谱 / AIHubMix / 豆包等） |
| `dify_chat` | Dify 对话应用（用 Service API） |
| `dify_workflow` | Dify 工作流（自动拉取 `/parameters` 并配置输入变量映射） |
| `cli` | 任意本地可执行命令；占位符或 stdin 注入输入 |

技术栈：React 19 + TypeScript + Vite（前端）/ Node 20 + Express + Sequelize + MySQL（后端）/ `inspect_ai` CLI 子进程（评估引擎）。

---

## 二、环境要求

| 软件 | 版本 |
|------|------|
| Node.js | ≥ 20 |
| MySQL | ≥ 8.0 |
| Python | ≥ 3.10（评估引擎用，3.10 与 3.12 共存） |
| npm | ≥ 8 |
| Docker（可选） | 20+，仅当要跑需要沙箱的基准时 |
| 磁盘 | 评估引擎 venv 约 10–15 GB；离线数据集 cache 约 35 GB；MySQL < 1 GB |

---

## 三、生产部署（systemd 单 unit）

**生产环境定式**：编译前后端 → systemd 单 unit (`asp-refractor.service`) 用 `node dist/index.js` 启动 → 同端口 :3002 同时提供 `/api/*` 与前端 SPA。

> 完整步骤、外网验证、安全组开放、空白页排查 — 见 **`DEPLOY.md`**。
>
> 本仓库 `ops/asp-refractor.service` 是当前生产 unit 文件的备份。

**生产服务器现状**：

| 项 | 值 |
|---|---|
| 公网入口 | `http://39.105.175.14:3002/` |
| 健康检查 | `http://39.105.175.14:3002/api/health` |
| systemd unit | `/etc/systemd/system/asp-refractor.service`（已 enabled，自启） |
| 项目路径 | `/home/xln/agent-safety-platform-refractor` |
| 进程形态 | `node dist/index.js`（NODE_ENV=production，崩溃 5 秒自动重启） |

---

## 四、开发模式（仅本地调试）

> ⚠️ 仅用于开发机调试，**不要用 `npm run dev`(ts-node-dev) 上生产**。生产请走第三节。

```bash
# 第 1 步：建数据库
mysql -u root -p
> CREATE DATABASE agent_safety_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 第 2 步：编辑 server/.env，至少修改 DB_PASSWORD（见第五节）

# 第 3 步：装依赖 + 建表
npm install                       # 前端依赖（仓库根目录）
cd server && npm install
npm run db:sync                   # 看到 "Database sync completed successfully" 即成功

# 第 4 步：起两个终端
# 终端 1（后端 :3002）
cd server && npm run dev
# 终端 2（前端 :5173，Vite 自动代理 /api → :3002）
npm run dev
```

浏览器打开 **http://localhost:5173**。

---

## 五、配置：`server/.env` 完整字段表

| 变量 | 必填 | 说明 |
|------|------|------|
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | ✅ | MySQL 连接信息 |
| `SERVER_PORT` | ✅ | 默认 3002 |
| `SERVER_HOST` | ❌ | 默认 `0.0.0.0`（接受所有网卡） |
| `NODE_ENV` | ✅ | 生产填 `production`，开发填 `development`（development 会 `alter: true` 自动同步表结构） |
| `CORS_ORIGINS` | 公网部署必填 | 逗号分隔的允许来源；公网部署时把 `http://你的IP:3002` 加进去 |
| `LLM_API_BASE_URL` / `LLM_API_KEY` / `LLM_JUDGE_MODEL` | ❌（可选回退） | 兜底裁判模型；**实际生产推荐在 UI"裁判模型管理"里建条目，UI 配置优先级更高** |
| `HF_TOKEN` | 部分基准必需 | `xstest`、`gaia` 等 gated HuggingFace 数据集需要；申请见 https://huggingface.co/settings/tokens |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | 公网建议 | 同时设置则启用 HTTP Basic 鉴权，浏览器访问 SPA 必须输用户名密码（保护 .env 里的上游 API Key 不被外人盗刷） |
| `API_TOKEN` | ❌ | 设了则所有 `/api/*` 必须带 `Authorization: Bearer <token>`（程序化调用场景） |
| `PYTHON_PATH` | ❌ | 默认 `python3`；若系统默认 python 不是 3.10+ 需指定 |
| `RESULTS_DIR` | ❌ | 默认 `server/eval-engine/results`，存 inspect 跑出的 `.eval` 日志 |
| `EVAL_POC_ROOT` | ❌ | 默认 `server/eval-engine`，整个评估引擎根目录 |

---

## 六、使用流程

```
1. 智能体管理 → 新建智能体（4 种形态选其一，见第七节）
2. 裁判模型管理 → 新建裁判模型（推荐 aihubmix / 阿里通义；很多基准依赖它）
3. 安全评估 → 新建评估任务 → 选智能体 + 选裁判模型 + 勾基准 + 设样本数限制 → 开始
4. 进度页实时刷新（SSE 推送），每条 task 跑完会即时更新
5. 完成后看：安全分卡片 / 风险雷达图 / 每条样本详情
6. 点"生成报告" → 报告列表 → 在线查看或导出
```

**第一次跑建议**：选一个轻量基准（如 `truthfulqa`） + 样本数限制设 3，验证端到端通顺，再放量。

---

## 七、智能体类型与字段

每种 agentType 在 UI"新建智能体"对话框里**字段不同**，下表对照：

### 7.1 OpenAI 兼容（`openai_compat`）

| 字段 | 必填 | 示例 |
|---|---|---|
| 名称 | ✅ | `测试通义-Qwen3.5-Plus` |
| API 地址 | ✅ | `https://aihubmix.com/v1` 或 `https://api.openai.com/v1` |
| API Key | ✅ | `sk-xxxxxxxxxxxxxxxxxxxxxxxx` |
| 模型 ID | ✅ | `gpt-4o-mini` / `qwen3.5-plus` / `claude-sonnet-4-5` |
| 系统提示词 | ❌ | 可选 |

### 7.2 Dify 对话应用（`dify_chat`）

| 字段 | 必填 | 示例 |
|---|---|---|
| 名称 | ✅ | `Dify 客服助手` |
| Service API Endpoint | ✅ | `https://api.dify.ai/v1`（**不是** `udify.app/...` 公开链接） |
| API Key | ✅ | `app-xxxxxxxxxxxxxxxxxxxxxxxx`（Dify 后台 → 访问 API） |
| 附加系统提示词 | ❌ | 作为前置消息注入 |

### 7.3 Dify 工作流（`dify_workflow`）

| 字段 | 必填 | 示例 |
|---|---|---|
| 名称 | ✅ | `Dify 法律工作流` |
| Service API Endpoint | ✅ | `https://api.dify.ai/v1` |
| API Key | ✅ | `app-...` |
| 输入变量映射 | ✅ | 工作流变量 ← 样本字段（如 `query ← input`）。**填完地址和 Key 后点"拉取参数"自动填充工作流声明的变量** |

### 7.4 本地 CLI 智能体（`cli`）

| 字段 | 必填 | 示例 |
|---|---|---|
| 名称 | ✅ | `本地脚本智能体` |
| 命令模板 | ✅ | `python my_agent.py {INPUT}` 或 `my-cli-tool` |
| 输入注入方式 | ✅ | `placeholder`（替换 `{INPUT}`，**不要手动加引号**）/ `stdin`（命令模板里不放 `{INPUT}`） |
| 单次调用超时 | ❌ | 默认 120 秒 |
| 环境变量 | ❌ | 每行一条 `KEY=VALUE` |

---

## 八、四个核心评估模块

| 模块 | 含义 | 包含的核心基准 |
|------|------|-----------------|
| 工具调用安全（tool_calling） | 智能体是否会被诱导执行危险工具操作 | agentdojo, bfcl, b3, agentharm, open_agent_safety |
| RAG/记忆安全（rag_safety） | 知识库投毒、信息泄露防护 | saferag, clash_eval |
| 任务规划安全（task_planning） | 多步骤规划中的安全风险识别 | safeagentbench, gaia, mind2web, mind2web_sc, assistant_bench |
| 业务场景安全（business_safety） | 业务场景（金融/医疗/聊天机器人等） | raccoon, healthbench, truthfulqa, gdpval |

每个模块下的基准可**单独勾选、单独跑、单独看结果**。

---

## 九、离线运行保障（强烈推荐预热）

**生产环境强烈推荐**首次部署后立刻执行预热，否则首次评估会因网下载卡几十分钟，且部分基准会因外网超时直接失败。

```bash
cd server

# 为 69 个 benchmark 各自建独立 Python venv（约 30–60 分钟，~10–15 GB）
npm run setup:venvs

# 离线下载所有可用数据集（约 20–40 分钟，~35 GB；gated 数据集需先在 .env 配 HF_TOKEN）
npm run prepare:datasets
```

执行后所有评估子进程被强制为离线模式：

| 环境变量 | 值 | 作用 |
|----------|-----|------|
| `HF_DATASETS_OFFLINE` | 1 | 禁止 HuggingFace datasets 在线请求 |
| `TRANSFORMERS_OFFLINE` | 1 | 禁止 Transformers 在线请求 |
| `HF_HUB_OFFLINE` | 1 | 禁止 HF Hub 在线请求 |

数据集预热状态可查询：

```bash
curl -s http://localhost:3002/api/benchmarks/datasets/status | jq .
```

> 跳过预热也能跑（评估引擎按需懒加载），但首次每个 benchmark 慢 1–3 分钟，且需要联网。

---

## 十、运维三件套（甲方日常）

```bash
# 看服务状态
sudo systemctl status asp-refractor

# 重启（拉了新代码 / 改了 .env / 改了 catalog.yaml 后）
sudo systemctl restart asp-refractor

# 看实时日志（Ctrl+C 退出）
sudo journalctl -u asp-refractor -f
```

**改了代码后的标准上线流程**：

```bash
cd /home/xln/agent-safety-platform-refractor
git pull origin main
cd server && npm ci && npm run build       # 编译后端 → server/dist/
cd ..      && npm ci && npm run build       # 编译前端 → dist/
sudo systemctl restart asp-refractor
curl -s http://39.105.175.14:3002/api/health   # 外网探针验证
```

> 注：生产不要用 `npm run dev`(ts-node-dev)，已退役。

---

## 十一、评估失败排查

**第 1 层**：评估 UI 任务详情页里每条 task 的"错误信息"。

**第 2 层**：评估子进程 stderr 与 inspect log。

```bash
# 后端进程级日志（含 spawn 时的命令、子进程退出码、stderr 摘要）
sudo journalctl -u asp-refractor -n 500 | grep -E "stderr|fail|error" -i

# 单个 task 的 inspect 详细日志（按模型 + 基准分目录）
ls server/eval-engine/results/<sanitized_model_name>/<benchmark>/logs/
```

**第 3 层**：常见根因对照表。

| 现象 | 多半因为 | 处置 |
|---|---|---|
| 整批 task 立即失败 | 智能体 API 不通 / Key 失效 | 在"智能体管理"测试连通；用 curl 直接调 `apiBase` 验证 |
| 部分 task `judge model` 报错 | 没建裁判模型 / 裁判 Key 失效 | 在"裁判模型管理"建条目，重跑 |
| `cyberseceval_2` / `cybench` / `agentdojo` 等 14 个基准失败 | 没装/没起 Docker | `sudo systemctl status docker`，按需 `sudo systemctl start docker` |
| `xstest` / `gaia` 数据集报 401 | 缺 `HF_TOKEN` 或没申请 gated 访问 | `.env` 配 `HF_TOKEN`，并在 https://huggingface.co/<repo> 申请访问 |
| `assistant_bench_web_browser` 失败 | 缺 `TAVILY_API_KEY` | `.env` 配 `TAVILY_API_KEY` |
| 任务卡住超过 30 分钟无进度 | 子进程僵死 | `jobWatchdog` 自动标记 failed；查看 systemd 日志确认 watchdog 触发 |

---

## 十二、`catalog.yaml` 是什么

位置：`server/eval-engine/benchmarks/catalog.yaml`。

它是平台支持的 69 个基准的**注册表**，每条记录告诉后端：

- `source`: `upstream`（用 `inspect_evals` 上游包）/ `local`（用 `eval_benchmarks/` 本地实现）
- `python`: 该基准用哪个 Python 版本（3.10 / 3.12）
- `tasks`: 子 task 列表 + `task_args`
- `judge_model` / `judge_param` / `model_roles`: 是否依赖裁判模型
- `needs_docker`: 是否依赖 Docker（如 `cve_bench` / `cybench` / `agentdojo`，共 14 个）
- `task_timeout`: 长任务超时（默认 30min，部分 Docker 类基准设为 1–2h）

**它不是单独的 Python 服务**——后端 `catalogService.ts` 启动时读 yaml 缓存成路由表，评估时根据基准名查表，然后 `spawn inspect eval` 子进程跑评估。前端"新建评估"下拉的基准列表就来自这里。

修改 catalog.yaml 后必须 `sudo systemctl restart asp-refractor` 才会生效。

---

## 十三、基准测试覆盖范围

平台共注册 **69 个**安全评估基准。

**16 个核心基准**分布在 4 大模块（见第八节）。

**其余 53 个扩展基准**通过 `inspect_evals` 上游或本地实现提供，覆盖：模型安全性（恶意使用、过度拒绝、提示词注入、指令优先级）、事实性（幻觉、诚实）、公平性（歧视、刻板印象、价值观、文化）、隐私、前沿安全（网络安全、危险知识）、多模态、多智能体、个性化、资源耗尽、长期运行、高阶异常行为等 15 大风险类别。在评估创建界面按需勾选启用。

---

## 十四、目录结构速查

```
agent-safety-platform-refractor/
├── DELIVERY.md               # 本文档
├── DEPLOY.md                 # 公网部署全流程
├── 操作手册.md                # 非技术对接人手册
├── DATABASE.md               # 数据表结构
├── CHANGELOG.md              # 修改记录
├── ops/
│   └── asp-refractor.service # systemd unit 备份
├── docker-compose.yml        # 本地调试用，生产不用
├── src/                      # 前端源码（Vite + React）
│   ├── page/                 #   页面（注意是 page 单数）
│   ├── components/           #   组件（含 AgentForm/ 4 个子表单）
│   ├── services/             #   API 客户端
│   └── style/                #   样式
├── dist/                     # 前端构建产物（npm run build 生成）
├── server/                   # 后端源码（Express + Sequelize）
│   ├── src/
│   │   ├── routes/           #   路由
│   │   ├── controllers/      #   控制器
│   │   ├── services/         #   业务逻辑（evalRunner / catalogService 等）
│   │   ├── middlewares/      #   basicAuth 等
│   │   ├── models/           #   Agent / EvalJob / EvalTask / EvalItem / JudgeModel / EvalReport
│   │   └── config/           #   配置加载
│   ├── dist/                 #   后端构建产物（npm run build 生成）
│   ├── scripts/              #   setup-venvs / prepare-datasets / verify-offline / bridge-caches
│   ├── eval-engine/          #   评估引擎根目录
│   │   ├── benchmarks/       #     catalog.yaml + 每个 benchmark 的 .venv/
│   │   ├── datasets-cache/   #     HuggingFace 离线数据集 cache（~35 GB）
│   │   ├── results/          #     评估结果 .eval 文件
│   │   ├── ts_bridge_solver.py #   inspect_ai → TS 智能体反向回调入口
│   │   └── patches/          #     上游 inspect_evals 的兼容补丁
│   └── .env                  # 配置（见第五节）
├── e2e/                      # Playwright 端到端测试
└── package.json / vite.config.ts / playwright.config.js / tsconfig.json
```

---

## 十五、常见问题

**Q: 启动后端报数据库连接错误？**
A: 检查 `server/.env` 里 `DB_PASSWORD` 是否正确，`mysql -u root -p` 能否登录，MySQL 端口是否被防火墙拦截。

**Q: 浏览器打开 SPA 但所有 API 请求 401？**
A: 检查是否设了 `API_TOKEN` 但前端没带；公网部署常见做法是把 `API_TOKEN` 留空，靠 `BASIC_AUTH_*` 浏览器登录态保护。

**Q: 浏览器空白 / 资源 404？**
A: 是否跑了 `npm run build` 在仓库根生成 `dist/`？后端启动日志会打印 `Serving SPA static bundle from <path>`，没这行说明 SPA 没挂上。详细排查见 `DEPLOY.md` 第七节。

**Q: 跨网段访问 `:3002` 通不了？**
A: 阿里云安全组入方向是否放行 3002 / TCP / 0.0.0.0/0；服务器本地 `ufw` 是否放行；`SERVER_HOST=0.0.0.0` 是否生效。

**Q: 评估全部失败？**
A: 走第十一节"三层排查"。

**Q: 首次运行某个 benchmark 特别慢？**
A: 首次会按需建 venv + 下载数据集，1–3 分钟正常。预热（第九节）能消除这一开销。

**Q: 怎么快速验证端到端通顺？**
A: 新建评估时样本数限制设 3，选 `truthfulqa`（最轻量），5 分钟内能跑完看结果。
