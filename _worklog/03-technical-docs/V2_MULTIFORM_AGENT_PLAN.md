# V2 多形态 Agent 评估架构改造计划

> 锁定日：2026-04-28
> 状态：执行中
> 替代：commit `4a815dd` 引入的 Dify SSE 路径 + 工作区里的 OpenAI 协议代理转发方案（已否决）

## 0. 背景：为什么这次改造

甲方原始重构需求（`_worklog/01-requirements/REFACTORING_REQUIREMENTS.md`）：
- 整个平台 TS，**评估基准统一集成至 TS 后端编排调度**
- HuggingFace 数据集**完全离线**
- 智能体 CRUD + 评估 + 报告

之前路径走偏：
- 加了一条独立 Dify-only 评估路径（`agentEvalRunner` + `testDataService` + 4 个 YAML 假数据集）——假数据集没学术权威性
- 工作区未提交的"统一"方案错误地把 Dify 翻译成 OpenAI chat-completions 协议让 inspect_ai 当 model 调——**协议抽象层级错了**（Dify/LangChain/CLI 是 Agent 不是 LLM）

## 1. 锁定的架构（A 方案 ts-bridge solver）

```
React SPA (5173)
   │ /api  +  SSE /api/eval/jobs/:id/stream
   ▼
Express :3002
   │ evalRunner: 串行 spawn `inspect eval ... --solver ts_bridge -S agent_id=N`
   │ POST /api/internal/agent-runner/invoke   ← solver 反向回调
   │   按 agentType 分发到：openaiRunner / difyChatRunner / difyWorkflowRunner / cliRunner
   │   每条样本完成 → 写 EvalItem + 推 SSE
   ▼
inspect_ai (per-benchmark venv)
   ts_bridge_solver.py (~50 行)：HTTP 回调 TS 拿 output 注入 state
   inspect_ai 原装：dataset / scorer (用 JudgeModel) / tools / sandbox / .eval 日志
   ▼
被测智能体（OpenAI / Dify chat / Dify workflow / CLI）
```

**核心原则**：inspect_ai 整套（dataset/scorer/tools/sandbox/log）原装保留，TS 通过 solver 扩展点反向接管"如何处理 sample"。各 agent 形态的协议适配 100% 在 TS。

## 2. 数据库 schema

### 2.1 新增 `JudgeModel`
```
id PK, name UNIQUE, apiBase, apiKey, modelId, description, createdAt, updatedAt
```

### 2.2 重建 `EvalItem`（per-sample 粒度）
```
id PK
jobId FK→EvalJob (CASCADE)
taskId FK→EvalTask (CASCADE)
benchmark, sampleId
inputJson(JSON), outputText, score(DECIMAL 6,4), scoreLabel
judgeRationale, judgeMetadata(JSON)
status ENUM(pending|running|success|failed)
errorMessage, retryCount, latencyMs, startedAt, finishedAt
createdAt, updatedAt
indexes: (jobId,taskId), (jobId,status), (taskId,sampleId UNIQUE)
```

### 2.3 `Agent` 重构
```
id, name UNIQUE, description
agentType ENUM(openai_compat|dify_chat|dify_workflow|cli)
config JSON  ← 按 agentType 装不同字段
createdAt, updatedAt
```
config 各形态：
- openai_compat: { apiBase, apiKey, modelId, systemPrompt? }
- dify_chat:     { apiBase, apiKey, systemPrompt? }
- dify_workflow: { apiBase, apiKey, inputVariableMapping }
- cli:           { commandTemplate, inputMode: placeholder|stdin, timeoutSec, env? }

### 2.4 `EvalJob` 扩展
+ judgeModelId FK
+ concurrency INT default 5
+ samplingMode ENUM(all|random)
+ totalSamples

### 2.5 `EvalTask` 扩展
+ totalSamples / completedSamples / failedSamples

## 3. 模块拆分

### 新增 Python
- `server/eval-engine/ts_bridge_solver.py`

### 新增 TS Backend
```
server/src/models/JudgeModel.ts
server/src/models/EvalItem.ts (重建)
server/src/controllers/judgeModelController.ts
server/src/controllers/evalItemController.ts (重写)
server/src/routes/judgeModelRoutes.ts
server/src/routes/internalAgentRunnerRoutes.ts
server/src/routes/sseRoutes.ts
server/src/services/agentRunner/{index,types,openaiRunner,difyChatRunner,difyWorkflowRunner,cliRunner}.ts
server/src/services/sseService.ts
server/src/services/difyParametersService.ts
server/src/services/judgeModelService.ts
server/src/services/evalLogParser.ts
```

### 新增 TS Frontend
```
src/services/judgeModelService.ts
src/services/sseService.ts
src/page/JudgeModelListPage.tsx
src/page/JudgeModelFormPage.tsx
src/components/AgentForm/{OpenAIAgentForm,DifyChatAgentForm,DifyWorkflowAgentForm,CliAgentForm}.tsx
src/components/EvalProgressLive.tsx
src/components/SampleDetailDrawer.tsx
```

### 修改
- `server/src/services/evalRunner.ts`         加 --solver ts_bridge
- `server/src/services/environmentBuilder.ts` 移除 dify-proxy 路径
- `server/src/services/commandBuilder.ts`     加 solver/concurrency 参数
- `server/src/models/Agent.ts`                config: JSON
- `server/src/models/EvalJob.ts`              judgeModelId/concurrency/samplingMode
- `server/src/models/EvalTask.ts`             totalSamples/completedSamples/failedSamples
- `server/src/models/index.ts`                注册新 model + 关联
- `server/src/controllers/evalController.ts`  单一 createJob 路径
- `server/src/controllers/agentController.ts` 按 agentType 校验 config
- `server/src/routes/evalRoutes.ts`           SSE + per-item 列表
- `server/src/app.ts`                         挂载新路由（删 dify-proxy）
- `src/page/EvalNewPage.tsx`                  judgeModel/concurrency/samplingMode
- `src/page/EvalProgressPage.tsx`             集成 SSE
- `src/page/EvalResultsPage.tsx`              per-sample 列表 + 详情
- `src/page/AgentFormPage.tsx`                按 agentType 分发表单
- `src/services/evalService.ts`               streamProgress/listItems/getItem

### 删除（保留 staged delete）
- `server/eval-engine/test-data/*.yaml` (4 个)
- `server/src/controllers/evalItemController.ts` (待重写)
- `server/src/models/EvalItem.ts` (待重建)
- `server/src/services/agentEvalRunner.ts`
- `server/src/services/difyClient.ts`
- `server/src/services/testDataService.ts`
- `src/components/AgentEvalProgress.tsx`

### 回滚（WIP 错误改动）
- `server/src/routes/difyProxyRoutes.ts` (新增文件，直接删)
- `server/src/services/environmentBuilder.ts` 里 isDify 改 OPENAI_BASE_URL 的逻辑
- `server/src/services/evalRunner.ts` 里 isDify 改 model 名的逻辑
- `server/src/app.ts` 里 `app.use('/api/dify-proxy', ...)` 那两行

## 4. ts-bridge solver 伪代码

```python
# server/eval-engine/ts_bridge_solver.py
import os, httpx
from inspect_ai.solver import Solver, TaskState, Generate, solver
from inspect_ai.model import ChatMessageAssistant

@solver
def ts_bridge(agent_id: int) -> Solver:
    base_url = os.environ.get("TS_BRIDGE_CALLBACK_URL", "http://localhost:3002")
    auth_token = os.environ.get("TS_BRIDGE_AUTH_TOKEN", "")
    timeout = float(os.environ.get("TS_BRIDGE_TIMEOUT_SEC", "180"))

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        payload = {
            "agentId": int(agent_id),
            "sampleId": str(state.sample_id),
            "input": state.input_text,
            "messages": [{"role": m.role, "content": m.text} for m in state.messages],
            "metadata": dict(state.metadata or {}),
            "target": state.target.target if state.target else None,
        }
        headers = {"Content-Type": "application/json"}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{base_url}/api/internal/agent-runner/invoke",
                                  json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
        output = data.get("output", "")
        state.messages.append(ChatMessageAssistant(content=output))
        state.output.completion = output
        return state
    return solve
```

调用：
```bash
inspect eval <task-spec> \
  --solver /abs/path/to/ts_bridge_solver.py:ts_bridge \
  -S agent_id=42 \
  --model openai/gpt-4o-mini  # placeholder（不被实际调用）
  -S judge_model=openai/gpt-4o  # 真裁判模型
  --max-samples 5
```

## 5. v1 端到端验收

三个 Dify 示例：
1. 智能搜索助手（chat）：app-fkTedNpuwjnInoEDZGkyVPwP — 必接入
2. 多源搜索聚合（chat）：app-8prlgqAhCl5hbxxEf6ma6QT7 — 必接入
3. 深度研究 workflow — v1 不接入（用户未提供 Service API key）

验收路径：
```
注册 JudgeModel → 注册 Agent → 创建 Job → SSE 实时观察 → 查看 per-sample 详情 → 浏览器 Playwright
```

## 6. 实施 PR 顺序

1. WIP 清理（§0 表）
2. 数据模型（§2 全部 schema）
3. JudgeModel CRUD（后端 + 前端页）
4. Agent 多形态表单（前端 4 子表单 + 后端 config 校验）
5. ts-bridge solver + 4 runner + internal route
6. evalRunner 改造（--solver flag + 串行 benchmark + 并发控制）
7. SSE 实时进度
8. per-sample 结果展示
9. Dify workflow 输入映射（/parameters）
10. 三个 Dify 示例端到端验收

## 7. 已知风险

1. inspect_ai solver 加载方式（PR-5 实测确认 file path 加载是否走通；备选 `pip install -e` 进每个 venv）
2. inspect_ai `--model` 是否必填（如必填则填 placeholder，scorer 走 -S judge_model）
3. 工具型 benchmark（agentdojo/agentharm/safeagentbench）对非工具 agent 不可比——v1 不阻塞用户选，但报告里要标注

## 8. 已锁定的设计决定

- A 方案 ts-bridge solver（不是 OpenAI 协议代理）
- benchmark 串行 + 单 benchmark 内 sample 并发（默认 5，1–10）
- 失败 1 次自动重试 → 仍失败 status=failed 不计分 → 继续下一条
- 每完成一条 sample 推 SSE，**v1 必做**
- 裁判模型实体化（独立表 + CRUD）
- per-sample 输入/输出/judge rationale 持久化 + UI 展示
- v1 形态：OpenAI / Dify chat / Dify workflow / CLI；LangChain 推后到 v1.1
- Dify workflow 输入映射：B2 方案（调 /parameters 自动渲染表单）
- 每 sample 新对话（Dify chat 不传 conversation_id）
- 数据集仍用学术 benchmark；4 个 YAML 假数据集永久删除
