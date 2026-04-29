# Bug 2: GET /api/v1/evaluate/:taskId 无法流式返回样本进度

## 现象 (Phenomenon)

甲方调用 `GET /api/v1/evaluate/:taskId` 希望获得"完成一条明细返回一条明细"的流式体验，即：
- 可以实时看到正在运行的样本数（类似网页UI中的进度条）
- 当样本完成时立即收到事件，而非等到整个任务完成

**实际行为**：GET 只返回一次静态 JSON 快照，包含：
- 已落盘的样本（来自 `.eval` 文件）
- 任务的聚合计数（completedSamples, failedSamples）
- 但 **没有任何流式事件**，每次调用仍需轮询

**期望**：
- 开放 SSE 端点（如 `GET /api/v1/evaluate/:taskId/stream`）
- 或提供 `since=<timestamp>` 参数支持增量查询
- 或让 GET 返回时间戳，使客户端能检测新完成的样本

---

## 现有能力 (Existing Infrastructure)

### SSE 服务完全就位，但只有网页UI使用

**sseService.ts** (行 12-19，48-59)
```typescript
export type SseEventName =
  | 'job.start'         // 任务启动
  | 'job.finish'        // 任务完成
  | 'task.start'        // 单个benchmark/task启动
  | 'task.finish'       // 单个task完成
  | 'sample.start'      // 单个样本开始处理
  | 'sample.finish'     // 单个样本完成（成功或失败）
  | 'heartbeat';        // 心跳（防连接断）
```

**emit() 方法**：
- 实时广播到所有订阅者（Response 列表）
- 格式：`event: <name>\ndata: <JSON>\n\n`

### 样本完成事件由 internalAgentRunnerController 触发

**internalAgentRunnerController.ts** (行 217-230，268-278)
```typescript
// 样本成功时
sseService.emit(jobId, 'sample.finish', {
  jobId,
  taskId: active!.taskId,
  benchmark: active!.benchmark,
  taskName: active!.taskName,
  sampleId: input.sampleId,
  itemId: item.id,
  status: 'success',
  latencyMs: result.latencyMs,
  outputPreview: '...',  // 前240字符
  finishedAt: new Date().toISOString(),
});

// 样本失败时：相同结构但 status='failed'
```

### 网页 UI 使用的SSE端点

**evalStreamController.ts** (行 22-83)
- `GET /api/eval/jobs/:id/stream` ← **这是网页UI用的 SSE**
- 路由：`evalRoutes.ts` 行 12
- 返回初始快照 + 订阅 sseService，持续接收 job.start/task.start/task.finish/sample.start/sample.finish/heartbeat

**这个端点就是 V1 API 需要的模式！**

---

## 为什么 GET 拿不到 (Why GET Can't See Progress)

### 问题层次（从低到高）

**1. GET 是一次性快照，不支持流式**
   - `v1Controller.ts` 行 782-808
   - 调用 `buildStatusPayload(taskId, samplesPerTask)` 返回静态 JSON
   - 不订阅 sseService

**2. buildStatusPayload 只读 .eval 文件中已写入的样本**
   - `v1Controller.ts` 行 416-424
   - 对每个 task 调用 `readEvalSamples(task.evalFile, 0, samplesPerTask)`
   - **依赖 inspect_ai 的 .eval 文件包含完整样本**

**3. inspect_ai 在整个评估 END 才写入 .eval 文件**
   - `evalRunner.ts` 行 518-532（评估成功后）：`await task.update({ evalFile })`
   - 之前：evalFile 为 null → readEvalSamples 跳过（行 416 的 if 条件）
   - 结果：评估运行中，样本已完成但 GET 返回 samples=[]

**4. 样本的实时进度只存在内存中**
   - EvalItem 表有 completedSamples / failedSamples（DB 中）
   - 但 sample 级明细（input/output/score）需要等 .eval 文件写入
   - SSE 中的 sample.finish 有 outputPreview，但 GET 无法订阅历史事件

---

## 修复方案 (Fix Proposal)

**选择：添加 `GET /api/v1/evaluate/:taskId/stream` SSE 端点**

原因：
- 最符合 SSE 标准设计
- 甲方要求"完成一条返回一条"，SSE 是天然匹配的
- 复用 sseService 的现有基础设施
- 避免长轮询或大量 GET 请求

### 实现步骤

#### Step 1: 新增 evalStreamHandler for V1 in v1Controller.ts

```typescript
/**
 * GET /api/v1/evaluate/:taskId/stream
 * 
 * Per-sample SSE stream for V1 API.
 * Follows the same pattern as evalStreamHandler (for web UI)
 * but emits V1-schema events.
 */
async function v1EvalStreamHandler(req: Request, res: Response): Promise<void> {
  const taskId = parseInt(req.params.taskId as string, 10);
  if (Number.isNaN(taskId)) {
    res.status(400).json(errorResponse('Invalid taskId'));
    return;
  }

  const job = await EvalJob.findByPk(taskId);
  if (!job) {
    res.status(404).json(errorResponse('Evaluation task not found'));
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Send initial status snapshot
  const payload = await buildStatusPayload(taskId, DEFAULT_SAMPLES_PER_TASK);
  if (payload) {
    res.write(`event: status\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  // Subscribe to job events
  sseService.subscribe(taskId, res);

  // Heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch (err: any) {
      logger.warn(`SSE heartbeat failed for v1 job=${taskId}: ${err.message}`);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseService.unsubscribe(taskId, res);
    logger.debug(`V1 SSE client disconnected taskId=${taskId}`);
  });
}
```

**在 v1Controller 底部export：**
```typescript
export const v1Controller = {
  // ...existing...
  async getStream(req: Request, res: Response): Promise<void> {
    return v1EvalStreamHandler(req, res);
  },
};
```

#### Step 2: 更新 v1Routes.ts

```typescript
router.get('/evaluate/:taskId/stream', v1Controller.getStream);  // 新增
router.get('/evaluate/:taskId', v1Controller.getStatus);         // 保留
```

#### Step 3: 事件格式约定

V1 SSE 事件（复用现有 sseService）：

**status** - 初始快照（同 GET 返回体）
```json
{
  "event": "status",
  "data": {taskId, status, completedSamples, completedTasks, tasks[], ...}
}
```

**sample.finish** - 每个样本完成（已由 internalAgentRunnerController 触发）
```json
{
  "event": "sample.finish",
  "data": {
    "jobId": 123,
    "taskId": 456,
    "benchmark": "benchmark_name",
    "taskName": "task_name",
    "sampleId": "sample_001",
    "itemId": 789,
    "status": "success" | "failed",
    "latencyMs": 1234,
    "outputPreview": "前240字符...",
    "finishedAt": "2026-04-29T10:00:00Z",
    "errorMessage": "仅失败时出现"
  }
}
```

**task.finish** - 单个 benchmark/task 完成
```json
{
  "event": "task.finish",
  "data": {
    "jobId": 123,
    "taskId": 456,
    "benchmark": "...",
    "taskName": "...",
    "status": "success" | "failed",
    "safetyScore": 0.85,
    "riskLevel": "medium",
    "finishedAt": "2026-04-29T10:00:00Z"
  }
}
```

**job.finish** - 整个评估完成
```json
{
  "event": "job.finish",
  "data": {
    "jobId": 123,
    "status": "completed" | "failed",
    "completedTasks": 5,
    "totalTasks": 5,
    "finishedAt": "2026-04-29T10:00:00Z"
  }
}
```

**heartbeat** - 心跳（防中间件断连）
```json
{"event": "heartbeat", "data": {"ts": 1234567890}}
```

#### Step 4: 客户端使用示例

```typescript
// TypeScript 客户端
const eventSource = new EventSource('/api/v1/evaluate/123/stream');

eventSource.addEventListener('status', (e) => {
  const status = JSON.parse(e.data);
  console.log(`Job status: ${status.status}, completed: ${status.completedSamples}/${status.totalSamples}`);
});

eventSource.addEventListener('sample.finish', (e) => {
  const sample = JSON.parse(e.data);
  console.log(`Sample ${sample.sampleId} completed: ${sample.status}`);
  // 实时显示进度
});

eventSource.addEventListener('task.finish', (e) => {
  const task = JSON.parse(e.data);
  console.log(`Task ${task.taskName} finished: score=${task.safetyScore}`);
});

eventSource.addEventListener('job.finish', (e) => {
  const job = JSON.parse(e.data);
  console.log(`Evaluation complete: ${job.status}`);
  eventSource.close();
});

eventSource.addEventListener('error', () => {
  eventSource.close();
});
```

---

## 类似问题 (Similar Patterns)

### 1. POST /api/v1/evaluate (submit) 也有流式需求

**现状**：异步返回 taskId，客户端必须轮询 GET 或使用同步 wait=true

**修复机制**：
- 已有：同步模式 `?wait=true` 会阻塞到 job.finish（v1Controller.ts 725-752）
- 但这用的是轮询，不是 SSE
- **建议**：文档化 `?wait=true` 同时支持 SSE 订阅的混合方案
  - 立即返回 taskId
  - 客户端可立即开 `GET /stream` 看实时事件
  - 或用 `?wait=true` 纯阻塞直到完成

### 2. /api/eval/jobs/:id/stream (网页UI) 与 /api/v1/evaluate/:id/stream (V1) 重复

**优化机会**：
- 两个端点事件结构一致（都用 sseService）
- 可共享同一个 SSE 广播
- 差异仅在初始快照的 schema（web vs v1）
- **建议**：evalStreamController 参数化，支持两种快照格式

### 3. readEvalSamples() 等待 .eval 文件，阻塞了进度透明度

**根本问题**：inspect_ai 只在评估 END 才写 .eval，运行中无法看样本明细

**长期方案**：
- inspect_ai 改支持增量日志或 ndjson 流
- 或 ts_bridge_solver 在 sample.finish 事件中同时发送输出文本
- 这样 GET 即使没 .eval，也能从 EvalItem 表读全样本明细

**当前短期方案**：
- SSE 流式返回足以满足客户端实时需求
- GET 保留原样式（向后兼容）
- 鼓励客户端优先用 SSE 而非轮询 GET

### 4. 进度计数不一致

**已知问题**（见 Bug 1）：
- completedSamples 与 samples[] 长度不匹配
- .eval 文件不完整时 samples=[] 但 completedSamples>0
- **SSE 改进**：sample.finish 事件包含完整输出（outputPreview）
- 不依赖 .eval 文件，客户端可自己聚合完整 samples 列表

---

## 验收标准

- [ ] 新增 `GET /api/v1/evaluate/:taskId/stream` 端点
- [ ] 路由注册到 v1Routes.ts
- [ ] SSE 发送初始 status 快照 + 实时事件
- [ ] 客户端可开 EventSource 监听 sample.finish
- [ ] Heartbeat 保持连接活跃
- [ ] 400+ 错误处理（无效 taskId，job 不存在等）
- [ ] 文档化事件格式和客户端使用
- [ ] 向后兼容：GET /api/v1/evaluate/:taskId 保留原行为

---

## 文件修改清单

1. **server/src/controllers/v1Controller.ts**
   - 新增 `v1EvalStreamHandler()` 函数（~60 行）
   - 导出 `v1Controller.getStream()`

2. **server/src/routes/v1Routes.ts**
   - 新增 `router.get('/evaluate/:taskId/stream', v1Controller.getStream)`

3. **server/src/services/sseService.ts**
   - 无需改动（已支持）

4. **文档** (可选)
   - CLAUDE.md 或 API 文档：V1 SSE 使用说明
