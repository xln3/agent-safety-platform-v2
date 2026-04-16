# 智能体安全评估平台 v2 — 交付说明

## 一、环境要求

| 软件 | 版本要求 |
|------|---------|
| Node.js | >= 18 |
| MySQL | >= 8.0 |
| Python | >= 3.10 |
| npm | >= 8 |

## 二、首次部署（按顺序执行）

### 第 1 步：创建数据库

```bash
mysql -u root -p
```

```sql
CREATE DATABASE agent_safety_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 第 2 步：修改配置

编辑 `server/.env`，把数据库密码改成你自己的：

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的MySQL密码
DB_NAME=agent_safety_platform
```

### 第 3 步：安装依赖 + 建表

```bash
# 前端依赖
npm install

# 后端依赖 + 建表
cd server
npm install
npm run db:sync
```

看到 `Database sync completed successfully` 就说明成功了。

> 评估引擎的 Python 虚拟环境不需要手动初始化 —— 后端在首次运行某个 benchmark 时会自动为其创建 venv 并安装依赖（通过 `venvService`），首次运行会较慢，之后复用。

### 第 4 步：启动

打开**两个终端**：

```bash
# 终端1：启动后端（端口 3002）
cd server
npm run dev

# 终端2：启动前端（端口 5173）
npm run dev
```

浏览器打开 **http://localhost:5173**

## 三、使用流程

```
第1步 → 智能体管理 → 新建智能体（填 API 地址、Key、模型名）
第2步 → 安全评估 → 新建评估 → 选择智能体 → 选择要测的 benchmark → 开始评估
第3步 → 等评估跑完（页面自动刷新进度）
第4步 → 查看结果（安全分 0-100、风险等级、雷达图、每条样本详情）
第5步 → 点"生成报告" → 在报告列表查看
```

## 四、四个评估模块

| 模块 | 说明 | 包含的 benchmark |
|------|------|-----------------|
| 工具调用安全 | 测试智能体是否会被诱导执行危险工具操作 | agentdojo, bfcl, b3, agentharm, open_agent_safety |
| RAG/记忆安全 | 测试知识库投毒、信息泄露防护能力 | saferag, clash_eval |
| 任务规划安全 | 测试多步骤规划中的安全风险识别能力 | safeagentbench, gaia, mind2web, mind2web_sc, assistant_bench |
| 业务场景安全 | 测试金融合规、隐私合规等业务场景 | raccoon, healthbench, truthfulqa, gdpval |

每个模块下的 benchmark 可以**单独勾选、单独跑、单独看结果**。

## 五、新建智能体时需要填什么

| 字段 | 必填 | 说明 | 示例 |
|------|------|------|------|
| 名称 | 是 | 随便起 | 测试GPT-4o |
| API 地址 | 是 | 大模型的接口地址 | https://api.openai.com/v1 |
| API Key | 是 | 接口密钥 | sk-xxxx |
| 模型 ID | 是 | 模型名称 | gpt-4o |
| 描述 | 否 | 备注 | — |

## 六、常见问题

**Q: 评估全部失败？**
A: 检查智能体的 API 地址和 Key 是否正确，确认网络能访问到该 API。

**Q: 启动后端报数据库连接错误？**
A: 检查 `server/.env` 里的数据库密码是否正确，MySQL 是否在运行。

**Q: 前端页面空白？**
A: 确认后端已启动，前端开发服务器会自动将 `/api` 请求代理到后端。

**Q: 首次运行某个 benchmark 特别慢？**
A: 正常现象。后端会在首次运行时为该 benchmark 创建 Python 虚拟环境并下载依赖，后续运行会复用缓存。

**Q: 快速验证能不能跑？**
A: 新建评估时设置"样本数限制"为 3，选一个轻量 benchmark（如 truthfulqa），几分钟就能跑完。

## 七、目录结构速查

```
agent-safety-platform-refractor/
├── src/                      # 前端代码
│   ├── pages/                #   页面
│   ├── components/           #   组件
│   ├── services/             #   API 请求
│   └── style/                #   样式
├── server/                   # 后端代码
│   ├── src/
│   │   ├── routes/           #   路由
│   │   ├── controllers/      #   控制器
│   │   ├── services/         #   业务逻辑
│   │   ├── models/           #   数据模型
│   │   └── constants/        #   常量定义
│   ├── eval-engine/          # 评估引擎
│   │   ├── benchmarks/       #   benchmark 注册表 + 本地 benchmark 代码
│   │   ├── .venvs/           #   Python 虚拟环境（首次运行自动生成）
│   │   └── results/          #   评估结果文件（.eval）
│   └── .env                  # 配置文件
└── DELIVERY.md               # 本文档
```
