# Bug Report: sampling count分配不均 (count=20 with 3 benchmarks → 19)

> **生产实测取证 (2026-04-29 由主代理补)**
> 
> Job 65（最新一次甲方实跑）：`benchmarks=["bfcl","b3","truthfulqa"]`, `sampling.mode=random`, `count=20`
> - DB 记录：`limit=7`, `total_tasks=3`, `total_samples=21`（按 ceil(20/3)=7 算 3 task 应得 21）
> - 实际三个 task：bfcl=7、**b3=5（被数据集容量上限截断）**、truthfulqa=7
> - 总 = 7+5+7 = **19** ✅ 与甲方观察完全吻合
> 
> 即"问题3 / 情景3"的具体落地：b3 本地数据集只放了 5 条，inspect_ai `--limit 7` 被夹到 5。
> 修复必须同时解决 (a) ceil 不精确分配、(b) 数据集容量上限截断后的余量补偿。
> 详见本报告"修复方案"部分及第八节追加。

## 现象 (Phenomenon)

甲方调用 `POST /api/v1/evaluate` 并传入以下参数：
```json
{
  "benchmarks": ["bench_a", "bench_b", "bench_c"],
  "sampling": {
    "mode": "random",
    "count": 20
  }
}
```

**预期行为 (Expected)**:
- 总样本数 (totalSamples) = 20
- 在每个任务中均匀分配：每个任务约 6-7 个样本

**实际行为 (Actual)**:
- 总样本数完成 = 19 (or potentially 21-28 depending on benchmark expansion)
- 样本分配不符合预期

---

## 根因 (Root Cause)

三个连锁问题导致样本计数错误：

### 问题1: 基于 benchmarks 数而非 tasks 数分配

**文件**: `server/src/controllers/v1Controller.ts`

**代码位置**: 第619行
```typescript
const perBenchLimit =
  payload.sampling.mode === 'random'
    ? Math.max(1, Math.ceil(totalCount / payload.benchmarks.length))
    : null;
```

此处按 `payload.benchmarks.length` 计算，但这是**错误的分母**：
- 输入: `benchmarks = ["bench_a", "bench_b", "bench_c"]` → length = 3
- 计算: `ceil(20 / 3) = 7` → `perBenchLimit = 7`
- **问题**: 计算基于 *benchmark 选择数* 而非 *实际生成的 task 数*

### 问题2: 某些 benchmark 扩展为多个内部任务

**文件**: `server/src/controllers/v1Controller.ts`

**代码位置**: 第629-636行
```typescript
if (bmInfo.tasks.length > 0) {
  // 若 benchmark 配置中有 sub-tasks，则为每个创建一个 EvalTask
  for (const task of bmInfo.tasks) {
    tasksToCreate.push({ benchmark: bmName, taskName: task.name });
  }
} else {
  // 否则用 benchmark 名称本身作为 task
  tasksToCreate.push({ benchmark: bmName, taskName: bmName });
}
```

**实例**:
假设 `bench_a` 配置中定义了 2 个子任务（如 `b3_threat_snapshot_1`, `b3_threat_snapshot_2`），则：
- `payload.benchmarks.length` = 3
- `tasksToCreate.length` = **4** (不再是 3！)
- 但 `perBenchLimit` 仍然基于 3 计算

### 问题3: 未更正的分配到每个任务

**文件**: `server/src/controllers/v1Controller.ts`

**代码位置**: 第712行（EvalTask 创建循环中）
```typescript
for (const taskDef of tasksToCreate) {
  await EvalTask.create({
    jobId: job.id,
    agentId: agentRecord.id,
    benchmark: taskDef.benchmark,
    taskName: taskDef.taskName,
    samplesTotal: perTaskTotal,  // ← 错误：使用了未更正的 perBenchLimit
    totalSamples: perTaskTotal,
    // ...
  });
}
```

每个 task 都被分配相同数量 (perTaskTotal = perBenchLimit)，但没有考虑到 tasksToCreate 的实际大小。

### 计数错误的三种情况

设 `count = 20`, `benchmarks.length = 3`:
- `perBenchLimit = ceil(20/3) = 7`
- `perTaskTotal = 7`

| 情景 | tasksToCreate.length | 实际总数 | 错误 |
|------|------------------|---------|------|
| 无扩展，3个任务 | 3 | 3 * 7 = **21** | +1 (ceil 舍入) |
| bench_a 扩展为 2 任务 | 4 | 4 * 7 = **28** | +8 |
| 某任务因数据集不足被截断 | 3 | 3 * 7, 但某任务实际只返回 6 | **19** ← 观察到的情况 |

第三种情况最可能：
- EvalJob 计划总数 = 21
- 但执行时，其中一个 task 的数据集不足 7 条
- inspect_ai `--limit 7` 被应用到数据集，但数据集只有 6 条
- 最终统计: 7 + 7 + **6** = **20** (或其他组合 = 19)

---

## 复现方法 (Repro)

### 环境准备
1. 确保 `server/src/config/catalog.yaml` 中存在这些 benchmark：
   - `b3` 或其他有多个子任务的 benchmark（见 `tasks:` 字段）
   - 一个或两个简单 benchmark（无子任务）

2. 查询 catalog，确认任务扩展：
```bash
grep -A 5 'tasks:' benchmarks/catalog.yaml | grep -E '(b3|saferag|personalized_safety)'
```

### 复现步骤

**请求 1（简单情况）**:
```bash
curl -X POST http://localhost:3000/api/v1/evaluate \
  -H 'Content-Type: application/json' \
  -d '{
    "taskName": "test_20_samples",
    "agent": {
      "name": "test_agent",
      "agentType": "openai_compat",
      "url": "https://api.openai.com/v1",
      "key": "sk-...",
      "modelId": "gpt-4o"
    },
    "benchmarks": ["truthfulqa", "bbq", "bold"],
    "sampling": {
      "mode": "random",
      "count": 20
    },
    "judgeModelId": 1
  }'
```

**请求 2（触发多任务扩展）**:
```bash
curl -X POST http://localhost:3000/api/v1/evaluate \
  -H 'Content-Type: application/json' \
  -d '{
    "taskName": "test_20_samples_b3",
    "agent": { ... },
    "benchmarks": ["b3", "truthfulqa", "bbq"],
    "sampling": { "mode": "random", "count": 20 },
    "judgeModelId": 1
  }'
```

### 观察结果

完成后，调用：
```bash
curl http://localhost:3000/api/v1/evaluate/<taskId>
```

检查响应中的 `totalSamples` 和 `tasks[].samplesTotal` 之和：
```json
{
  "taskId": 123,
  "totalSamples": 20,  // 应该等于
  "tasks": [
    { "benchmark": "b3", "samplesTotal": 7 },
    { "benchmark": "b3", "samplesTotal": 7 },        // ← 如果 b3 展开为多任务
    { "benchmark": "truthfulqa", "samplesTotal": 7 },
    { "benchmark": "bbq", "samplesTotal": 7 }
  ]
}
// 求和 = 28 而非 20！
```

---

## 修复方案 (Fix Proposal)

### 核心修复: 基于 tasks 而非 benchmarks 分配

**文件**: `server/src/controllers/v1Controller.ts`

**修改范围**: 第615-712行（采样分配和任务创建）

### 修复方案详细步骤

#### Step 1: 先展开任务，再计算分配

将第622-640行的任务展开逻辑**前置**到第615行之前（或重新组织）：

```typescript
// 第615行前插入：先展开任务列表
const allBenchmarks = catalogService.getAllBenchmarks();
const benchmarkMap = new Map(allBenchmarks.map((b) => [b.name, b]));
const tasksToCreate: { benchmark: string; taskName: string }[] = [];

for (const bmName of payload.benchmarks) {
  const bmInfo = benchmarkMap.get(bmName);
  if (!bmInfo) continue;
  if (bmInfo.tasks.length > 0) {
    for (const task of bmInfo.tasks) {
      tasksToCreate.push({ benchmark: bmName, taskName: task.name });
    }
  } else {
    tasksToCreate.push({ benchmark: bmName, taskName: bmName });
  }
}

if (tasksToCreate.length === 0) {
  res.status(400).json(errorResponse('No valid tasks resolved from benchmarks'));
  return;
}

// 现在计算 per-task 分配，而非 per-benchmark
const totalCount = payload.sampling.mode === 'random' ? Number(payload.sampling.count) : 0;

// ← 修复：使用 tasksToCreate.length 而非 payload.benchmarks.length
const perTaskBase = payload.sampling.mode === 'random'
  ? Math.floor(totalCount / Math.max(1, tasksToCreate.length))
  : 0;

// 计算余数，分配给前几个任务
const remainder = totalCount % Math.max(1, tasksToCreate.length);

// 建立 task index → per-task count 的映射
const perTaskCount = tasksToCreate.map((_, i) => 
  i < remainder ? perTaskBase + 1 : perTaskBase
);
```

#### Step 2: 使用映射的分配值创建 EvalTask

修改第706-713行的任务创建循环：

**原代码** (第706-713行):
```typescript
for (const taskDef of tasksToCreate) {
  await EvalTask.create({
    jobId: job.id,
    agentId: agentRecord.id,
    benchmark: taskDef.benchmark,
    taskName: taskDef.taskName,
    samplesTotal: perTaskTotal,  // ← 错误：所有任务相同
    totalSamples: perTaskTotal,
    // ...
  });
}
```

**修复后代码**:
```typescript
for (let i = 0; i < tasksToCreate.length; i++) {
  const taskDef = tasksToCreate[i];
  const taskLimit = perTaskCount[i] ?? perTaskBase;  // 使用索引对应的值
  
  await EvalTask.create({
    jobId: job.id,
    agentId: agentRecord.id,
    benchmark: taskDef.benchmark,
    taskName: taskDef.taskName,
    samplesTotal: taskLimit,      // ← 修复：按索引取值
    totalSamples: taskLimit,
    // ... 其他字段
  });
}
```

#### Step 3: 修正 EvalJob.totalSamples 和 limit 字段

修改第666-704行中的 EvalJob 创建：

**原代码** (第666-667, 677, 702行):
```typescript
const perTaskTotal = perBenchLimit || 0;
const jobTotalSamples = perTaskTotal * tasksToCreate.length;  // ← 错误倍增

const job = await EvalJob.create({
  // ...
  limit: perBenchLimit,                // ← 这个字段的含义模糊
  // ...
  totalSamples: jobTotalSamples,       // ← 已经错误了
});
```

**修复后代码**:
```typescript
// totalSamples 现在是精确的总和
const jobTotalSamples = totalCount;  // 对于 mode='random' 就是 payload.sampling.count

const job = await EvalJob.create({
  // ...
  // limit 字段改为 null（因为不再是统一的 per-task limit）
  // 或存储一个 JSON 结构便于后续查询
  limit: null,
  // ...
  totalSamples: jobTotalSamples,       // ← 正确值：20
  totalItems: jobTotalSamples,
});
```

#### Step 4: 更新 evalRunner 中 inspect_ai 命令的构建

**文件**: `server/src/services/evalRunner.ts`

**代码位置**: 第394-415行 (buildInspectCommand 调用)

修改参数传递方式。目前第399行：
```typescript
limit: job.limit || undefined,
```

需要改为从 EvalTask 本身读取：
```typescript
// 在 spawnTaskProcess 中，task 对象已有 samplesTotal
limit: task.samplesTotal || undefined,
```

已检验：evalRunner 的 spawnTaskProcess 函数确实接收 EvalTask 对象（第300行参数），且该对象在此时应已包含正确的 samplesTotal。

---

## 完整修复代码 (伪代码框架)

```typescript
// === server/src/controllers/v1Controller.ts, submit() function ===

// [在第615行之前] 前置任务展开
const allBenchmarks = catalogService.getAllBenchmarks();
const benchmarkMap = new Map(allBenchmarks.map((b) => [b.name, b]));
const tasksToCreate: { benchmark: string; taskName: string }[] = [];

for (const bmName of payload.benchmarks) {
  const bmInfo = benchmarkMap.get(bmName);
  if (!bmInfo) continue;
  if (bmInfo.tasks.length > 0) {
    for (const task of bmInfo.tasks) {
      tasksToCreate.push({ benchmark: bmName, taskName: task.name });
    }
  } else {
    tasksToCreate.push({ benchmark: bmName, taskName: bmName });
  }
}

if (tasksToCreate.length === 0) {
  res.status(400).json(errorResponse('No valid tasks resolved from benchmarks'));
  return;
}

// [修改第615-620行] 计算分配
const totalCount = payload.sampling.mode === 'random' ? Number(payload.sampling.count) : 0;

// 使用 floor + remainder 分配，保证 Σ = totalCount
const numTasks = tasksToCreate.length;
const perTaskBase = Math.floor(totalCount / numTasks);
const remainder = totalCount % numTasks;

const perTaskLimits = Array.from({ length: numTasks }, (_, i) => 
  i < remainder ? perTaskBase + 1 : perTaskBase
);

// [第666-667行] 修正 totalSamples
const jobTotalSamples = totalCount;  // 精确值

// [第671-704行] EvalJob 创建，limit 改为 null
const job = await EvalJob.create({
  agentId: agentRecord.id,
  judgeModelId: resolvedJudgeId,
  name: jobName,
  benchmarks: payload.benchmarks,
  modelId,
  limit: null,  // ← 改为 null：不再用统一的 per-task limit
  judgeModel: resolvedJudgeName,
  systemPrompt: payload.systemPrompt ?? null,
  config: { /* ... */ },
  concurrency: payload.concurrency ?? 5,
  samplingMode: payload.sampling.mode,
  totalTasks: tasksToCreate.length,
  completedTasks: 0,
  totalSamples: jobTotalSamples,  // ← 改为精确值
  totalItems: jobTotalSamples,
});

// [第706-712行] EvalTask 创建，按索引使用不同的 limit
for (let i = 0; i < tasksToCreate.length; i++) {
  const taskDef = tasksToCreate[i];
  const taskLimit = perTaskLimits[i];
  
  await EvalTask.create({
    jobId: job.id,
    agentId: agentRecord.id,
    benchmark: taskDef.benchmark,
    taskName: taskDef.taskName,
    samplesTotal: taskLimit,  // ← 使用 perTaskLimits[i]
    totalSamples: taskLimit,
    status: TASK_STATUS.PENDING,
    limit: taskLimit,  // 可选：存储在 EvalTask 以便 evalRunner 读取
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
```

### 性能和兼容性考虑

1. **向后兼容性**: 现有 EvalJob.limit 字段改为 null，需检查所有读取它的地方：
   - evalRunner.ts line 399 → 改为从 EvalTask.limit 或 EvalTask.samplesTotal 读取 ✓
   - 其他查询暂未发现依赖

2. **DB 字段**: EvalTask 已有 `samplesTotal` 和 `totalSamples` 字段，可复用。若需 EvalTask.limit，需加 migration。

3. **性能**: 此修复**改进**而非降低性能（减少了不必要的重复 limit 字段）。

---

## 类似 Bug (Similar Patterns)

### 1. 其他使用 Math.ceil 作为分配器的地方

搜索 codebase 中类似的舍入式分配：
```bash
grep -rn "Math.ceil.*\*.*length" server/src/ --include="*.ts"
```

已发现:
- **v1Controller.ts line 619**: 本 bug 的原点 ✓
- **v1Controller.ts line 667**: `perTaskTotal * tasksToCreate.length` 潜在溢出 ✓

### 2. EvalJob.totalSamples 计算

**文件**: server/src/controllers/v1Controller.ts, line 702

当前:
```typescript
totalSamples: jobTotalSamples,  // = perTaskTotal * tasksToCreate.length
```

如果 perTaskTotal 和 tasksToCreate.length 不匹配（benchmark 数 vs task 数），会导致：
- 预期 20，实际 21 或 28
- 不符合 API 契约

**修复后**: jobTotalSamples = totalCount（精确）

### 3. resultReader 和 scoreService 中的样本计数

**文件**: server/src/services/resultReader.ts

Line 408-409 (EvalHeader):
```typescript
samplesTotal: results.total_samples ?? 0,
samplesCompleted: results.completed_samples ?? 0,
```

**文件**: server/src/services/scoreService.ts

Line 272, 294, 308, 368 等：设置 `samplesTotal: header.samplesTotal`

**状态**: 这些字段**从 inspect_ai 结果读取**，不受此 bug 影响。但若 inspect_ai 本身因 limit 错误而返回不一致的样本数，会被逐一记录。

### 4. 采样模式 = 'all'

**文件**: v1Controller.ts, line 699

当 `sampling.mode = 'all'` 时：
- totalCount = 0（line 616）
- perBenchLimit 保持 null（line 620）
- perTaskTotal = 0（line 666）
- EvalTask.samplesTotal = 0（line 712）
- 导致 inspect_ai 接收 limit=undefined，运行所有样本 ✓

**状态**: 正确，无 bug。

### 5. 其他分配模式的潜在扩展

当来自其他地方（如 Web UI）的请求也使用类似逻辑时，需同步修复：

搜索 EvalJob/EvalTask 的其他创建点：
```bash
grep -rn "await EvalJob.create\|await EvalTask.create" server/src/controllers/ --include="*.ts"
```

**发现**:
- controllers/evalController.ts (旧评估接口) - 可能有类似逻辑，需检查
- controllers/v1Controller.ts - 本 bug

---

## 验证清单

修复完成后，需验证以下场景：

| 场景 | 输入 | 预期 totalSamples | 预期 Σ samplesTotal |
|------|------|------------------|-------------------|
| 3 简单 benchmark, count=20 | ["a", "b", "c"], 20 | 20 | 20 (7+7+6) |
| 1 展开为 2 任务, count=20 | ["b3", "c", "d"], 20 | 20 | 20 (5+5+5+5) |
| 4 benchmark, count=25 | ["a", "b", "c", "d"], 25 | 25 | 25 (7+6+6+6) |
| mode='all' | ["a", "b"], null | ∞ | ∞ (所有数据集) |

---

## 附录: 受影响的数据结构

### EvalJob 表
```typescript
interface EvalJob {
  id: number;
  totalTasks: number;       // 任务数
  totalSamples: number;     // ← 需修复：应等于 ∑ task.samplesTotal
  completedSamples: number; // 已完成样本数（聚合值）
  limit: number | null;     // ← 需修复：改为 null（per-task 改为存在 EvalTask）
  samplingMode: 'all' | 'random';
  // ...
}
```

### EvalTask 表
```typescript
interface EvalTask {
  id: number;
  jobId: number;
  samplesTotal: number;      // ← 需修复：正确的 per-task 样本数
  completedSamples: number;  // 该任务已完成的样本数
  failedSamples: number;
  limit?: number;            // 可选：冗余存储以便 evalRunner 快速访问
  // ...
}
```

---

## 总结

**三层问题**:
1. 分母错误: 基于 `benchmarks.length` 而非 `tasksToCreate.length`
2. 未处理扩展: 某些 benchmark 会展开为多个任务
3. 不均衡分配: 未使用 base + remainder 技术确保 Σ = count

**单一修复方向**: 采用 floor + remainder 分配法，先展开任务再计算，保证数学严密性。

**影响范围**: 仅 v1Controller.ts submit 函数，修改 < 50 行代码。

**验证方法**: 断言 ∑ EvalTask.samplesTotal == EvalJob.totalSamples == payload.sampling.count。

---

## 八、补充：数据集容量截断处理（主代理追加）

### 8.1 真正的"19"是怎么算出来的

子智能体的报告把 (a) ceil 不精确 + (b) 多任务展开 + (c) 数据集截断 三种情景列了，
但漏说了**实测情况下三者会同时发生**：

```
job 65: benchmarks=["bfcl","b3","truthfulqa"], count=20
  ceil(20/3)=7 → 三 task 各发 limit=7
  bfcl 数据集 ≥ 7      → 取 7
  b3   数据集 = 5 (仅) → 取 5（被夹）
  truthfulqa 数据集≥7  → 取 7
  Σ = 7+5+7 = 19 ❌
```

子智能体的 floor+remainder 分配后变成：

```
floor(20/3)=6, remainder=2 → [7,7,6]
  bfcl       → 7
  b3 (cap 5) → 5（仍被夹）
  truthfulqa → 6
  Σ = 7+5+6 = 18 ❌（更糟，因为没补偿）
```

仅靠"分母对齐 + base+remainder"还不够。

### 8.2 三个方案的取舍

| 方案 | 描述 | 优 | 劣 |
|---|---|---|---|
| A. 接受缺口 | 公平分配，碰到数据集上限就止；返回体加 `samplingNotes` 字段说明实际 < 请求 | 实现简单、行为可预测 | 甲方首次看到时会再次困惑 |
| B. 预探 + 再分配 | 提交前用 catalog 容量上限信息，按 min(allocation, capacity) 分，把多余样本均摊给有 headroom 的 task | 总数贴合 count | 需要 catalog 提供每 benchmark 的容量；多任务展开时探测复杂 |
| C. 跑完再补 | 第一轮结束如果 Σ<count，对未饱和 task 再开一次 inspect | 最贴合 count | 调度复杂、双倍 LLM 成本 |

**主代理建议：方案 A+B 混合**

- catalogService 已经每个 benchmark 存了 `tasks: []` 数组（line 200+），加一个 `maxSamples` 字段（取自 inspect_ai 数据集大小或人工填写）
- 提交时先做"约束分配"：base = floor(count/N)，给每个 task 分 min(base+extra, maxSamples)
- 如果分完仍 < count，把缺口轮流摊给 maxSamples 还有 headroom 的 task
- 算法到不动点；如果所有 task 都饱和仍 <count，返回体加 `samplingNotes: "数据集容量上限"`
- 返回体新增字段：`requestedCount: 20`, `actualTotalSamples: 18`, `samplingNotes`

### 8.3 catalog 增补

`server/src/services/catalogService.ts` line 200 附近的每个 benchmark 加：

```ts
b3: {
  // 原字段...
  maxSamples: 5,         // 本地数据集容量上限（演示版）
}
```

来源选 1：人工写死（最快），选 2：跑一次 `inspect eval --limit 999999` 探测后写入。

### 8.4 修订后的修复算法（伪代码）

```typescript
// 1. 展开 tasksToCreate（保留子智能体方案的 step）
// 2. 查 each task 的 maxSamples（默认 Infinity 兜底）
const caps = tasksToCreate.map(t => benchmarkMap.get(t.benchmark)?.maxSamples ?? Infinity);

// 3. 公平分配：base+remainder
const N = tasksToCreate.length;
let alloc = Array.from({length:N}, (_,i) => Math.floor(totalCount/N) + (i < totalCount%N ? 1 : 0));

// 4. 约束 + 再分配（最多 N 轮即收敛）
for (let round = 0; round < N; round++) {
  let deficit = 0;
  for (let i = 0; i < N; i++) {
    if (alloc[i] > caps[i]) {
      deficit += alloc[i] - caps[i];
      alloc[i] = caps[i];
    }
  }
  if (deficit === 0) break;
  // 把 deficit 均摊给还有 headroom 的 task
  const headroom = alloc.map((a,i) => caps[i] - a);
  const totalHeadroom = headroom.reduce((s,h)=>s+h, 0);
  if (totalHeadroom === 0) break;  // 所有都饱和，无法再补
  // 按 headroom 比例摊
  for (let i = 0; i < N && deficit > 0; i++) {
    if (headroom[i] === 0) continue;
    const give = Math.min(headroom[i], Math.ceil(deficit * headroom[i] / totalHeadroom));
    alloc[i] += give;
    deficit -= give;
  }
}

const actualTotal = alloc.reduce((s,a)=>s+a, 0);
const samplingNotes = actualTotal < totalCount
  ? `请求 ${totalCount} 但部分 benchmark 数据集容量不足，实际分配 ${actualTotal}`
  : null;
```

### 8.5 验收

修复后跑一遍同样的 job：

```
benchmarks=["bfcl","b3","truthfulqa"], count=20
  caps = [Inf, 5, Inf]
  初分配 [7,7,6]
  b3 超 → 缩到 5，deficit=2
  剩余 headroom: bfcl Inf, truthfulqa Inf
  按比例摊给 bfcl（先到先摊）→ [8,5,7] 或 [7,5,8]
  Σ = 20 ✅
```

返回体：
```json
{
  "totalSamples": 20,
  "tasks": [
    {"benchmark":"bfcl","samplesTotal":8,"completedSamples":8},
    {"benchmark":"b3","samplesTotal":5,"completedSamples":5},
    {"benchmark":"truthfulqa","samplesTotal":7,"completedSamples":7}
  ]
}
```

如果数据集真的全饱和了：
```json
{
  "totalSamples": 18,
  "samplingNotes": "请求 20 但部分 benchmark 数据集容量不足，实际分配 18",
  ...
}
```
