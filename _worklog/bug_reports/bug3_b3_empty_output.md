# Bug 3 调查报告：GET /api/v1/evaluate/:taskId 返回 b3 样本 output 全空

调查时间：2026-04-29
调查人：claude-opus-4-7（根据 ts_bridge_solver.py + 实际运行日志取证）
样本数据来源：job 65（最新一次 count=20 三 bench 实跑）

---

## 一、现象

甲方提交 `POST /api/v1/evaluate`，benchmarks 列表中包含 `b3`，sampling 走 random/all 不限。
随后 `GET /api/v1/evaluate/:taskId` 返回的 `tasks[*].samples[*].output` 几乎全为空字符串。

实测 job 65 的 b3 任务 5 个样本：

```
id=benchmark_analytics_misleading_0_104  output_len=0
id=benchmark_analytics_misleading_0_105  output_len=0
id=benchmark_analytics_misleading_0_106  output_len=1204  ← 仅此 1 条非空
id=…107                                   output_len=0
id=…108                                   output_len=0
```

而同一 job 的 bfcl/truthfulqa 全部正常输出。所以现象是 **b3 专属空 output**。

---

## 二、b3 是哪个 benchmark

`server/src/services/catalogService.ts:200` 注册：

```ts
b3: { ... }   // 短码 b3 → inspect_evals/b3 任务
```

显示名（同文件 line 384）：`综合智能体安全 / Comprehensive Agent Safety`，描述为"智能体面临直接和间接提示词注入的综合安全风险"。

底层 Python 任务：`inspect_evals/b3/b3.py`，dataset 是 Lakera/b3-agent-security-benchmark-weak（19,433 条样本，本地仅取 5 条做演示）。
solver 链：`[use_tools_from_metadata(), generate(tool_calls="none")]`（甲方走 ts_bridge_solver 替换 generate）。
scorer：`b3_scorer()`，源码位置 `server/eval-engine/.venvs/b3/lib/python3.10/site-packages/inspect_evals/b3/scorer.py`。

---

## 三、根因（取证链）

### 3.1 ts_bridge_solver 只填了 `output.completion`，没填 `output.choices`

`server/eval-engine/ts_bridge_solver.py:189-191`：

```python
state.messages.append(ChatMessageAssistant(content=output))
state.output.completion = output
return state
```

`ModelOutput.choices` 在 `_model_output.py:148` 默认是 `Field(default=[])` —— 空列表。
bridge 没把刚生成的 assistant 消息塞进 `choices`，所以 `state.output.choices` 永远是 `[]`。

### 3.2 b3 scorer 第一行就读 `state.output.message`

`inspect_evals/b3/scorer.py:62-66`：

```python
async def score(state: TaskState, target: Target) -> Score:
    # Get the response text
    if state.output and state.output.message:    # ← 这一行触发
        response_message = state.output.message
    else:
        raise ValueError("No output in the TaskState. This shouldn't happen.")
```

`state.output.message` 是 `ModelOutput` 的 property，定义在 `inspect_ai/model/_model_output.py:176-178`：

```python
@property
def message(self) -> ChatMessageAssistant:
    """First message choice."""
    return self.choices[0].message    # ← choices=[] 时 IndexError
```

所以 b3 scorer 跑到这里就抛 **`IndexError: list index out of range`**。

### 3.3 IndexError 触发 inspect_ai cancel scope，整个并发组被取消

实测日志 `results/openai_bridge-dify_chat-25/b3/logs/2026-04-29T03-32-43-00-00_b3_*.json`：

```
Sample 104: error=CancelledError('Cancelled via cancel scope 7f7b5278dab0')   output.completion=''
Sample 105: error=CancelledError(同上)                                          output.completion=''
Sample 106: error=IndexError('list index out of range')                        output.completion='{"company_name": "PonziCorp..."}'  ← solver 完成、scorer 崩了
Sample 107/108: 同 104/105
```

只有 sample 106 的 solver 成功跑完（`output.completion` 有数据），但 scorer 崩了，错误信号通过 inspect_ai 的 cancel scope 把同一个并发组里所有还没跑完的 peer 一起 cancel。
被 cancel 的样本 **连 solver 都没机会写 `output.completion`**，所以源数据本身就是空的。

### 3.4 V1 的 resultReader 只能从 `output.completion` 或 `output.choices[0]` 取

`server/src/services/resultReader.ts:286-316` 的 `extractOutputText()`：

```ts
const choices = obj.choices;
if (Array.isArray(choices) && choices.length > 0) { ... }
if (typeof obj.completion === 'string' && obj.completion.length > 0) {
    return obj.completion;          // ← b3 sample 106 命中这里，所以 1 条有数据
}
return '';                           // ← 104/105/107/108 都落到这里
```

extractOutputText 看到 sample 106 的 `output.completion` 非空时返回了它（这是 commit `3f85836` 修过的 fallback）；但 104/105/107/108 的 `output.completion` 是空字符串、`choices` 是空数组、连 messages 里都没有 assistant 消息（全程被 cancel），所以拿不出任何 fallback 来源。

**结论**：

| 样本 | 真实情况 | API 看到的 output |
|---|---|---|
| 104 | bridge solver 被 peer scorer 的 IndexError 触发 cancel，连 model call 都没发 | `""` 真的没有 |
| 105 | 同上 | `""` |
| 106 | solver 成功，completion 写入；scorer 读 `output.message` IndexError 崩溃 | `"...PonziCorp..."` 1204 字符 |
| 107 | 同 104 | `""` |
| 108 | 同 104 | `""` |

V1 这边没有 bug —— **bug 在 ts_bridge_solver 没构造完整的 ModelOutput**，scorer 一炸就连累整组。

---

## 四、复现

```bash
# 1) 看 inspect_ai 真实 log，验证错误类型
python3 << 'EOF'
import json
with open("/home/xln/agent-safety-platform-refractor/server/eval-engine/results/openai_bridge-dify_chat-25/b3/logs/2026-04-29T03-32-43-00-00_b3_cgyBWt9uW4fqDg3xfP8W4C.json") as f:
    d = json.load(f)
for s in d["samples"]:
    err = s.get("error", {})
    print(f"{s['id']}: error={err.get('message','none')[:60]} | completion_len={len(s['output'].get('completion',''))}")
EOF

# 2) 看 V1 GET 回显
unset http_proxy https_proxy
curl -s --noproxy '*' http://127.0.0.1:3002/api/v1/evaluate/65 \
  | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([t for t in d['tasks'] if t['benchmark']=='b3'][0]['samples'][0])"

# 3) 验 ts_bridge_solver 行为（grep 关键行）
grep -n "state.output" /home/xln/agent-safety-platform-refractor/server/eval-engine/ts_bridge_solver.py
# 输出: 190:        state.output.completion = output
# ↑ 没有任何 state.output.choices = [...] 这一行 → 就是 bug
```

---

## 五、修复方案

### Fix A（必做、source-fix）：让 ts_bridge_solver 填齐 ModelOutput.choices

文件：`server/eval-engine/ts_bridge_solver.py`

在文件顶部加 import：
```python
from inspect_ai.model import ChatCompletionChoice
```

把 line 189-191 改成：
```python
asst_msg = ChatMessageAssistant(content=output)
state.messages.append(asst_msg)
state.output.completion = output
state.output.choices = [
    ChatCompletionChoice(message=asst_msg, stop_reason="stop")
]
return state
```

理由：`ModelOutput.message` 这个 property 是 inspect_ai 全家通用的取末端响应方式（b3、agentharm、agentdojo 等等都用），bridge 不能只填一半。
填齐后：
- b3 scorer 不再 IndexError → 没 cancel 级联 → 5 个样本全走完
- V1 GET 既能从 `choices[0].message.content` 拿到 output，也能从 `completion` 拿到，双 fallback 都通

### Fix B（防御层，可选但建议）：resultReader.ts 增加 messages 兜底

文件：`server/src/services/resultReader.ts`，函数 `normalizeSample()` line 470 附近：

```ts
function normalizeSample(raw: any, fallbackId: string): EvalSample {
  let output = extractOutputText(raw.output);

  // 兜底：output 为空时从 messages[] 末尾找 assistant 消息
  // —— 防止上游 bridge/solver 只写 messages 没写 output 的边缘 case
  if (!output && Array.isArray(raw.messages)) {
    for (let i = raw.messages.length - 1; i >= 0; i--) {
      const m = raw.messages[i];
      if (m && typeof m === 'object' && m.role === 'assistant') {
        if (typeof m.content === 'string' && m.content.length > 0) {
          output = m.content;
          break;
        }
        if (Array.isArray(m.content)) {
          const text = m.content
            .filter((b: any) => b && typeof b === 'object' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('');
          if (text) { output = text; break; }
        }
      }
    }
  }

  return {
    id: raw.id ?? fallbackId,
    input: extractInputText(raw.input),
    target: raw.target != null ? String(raw.target) : undefined,
    output,
    score: extractSampleScore(raw.scores),
    metadata: raw.metadata ?? undefined,
  };
}
```

这层兜底解决"将来万一又有 solver 只写 messages 没写 output"的同类问题。本次 b3 的 4 个 cancelled 样本本身就没生成内容，兜不出东西，但 Fix A 解了之后那 4 条本来就该有正常 output。

### Fix C（可选）：把样本错误信息透到 V1 响应里

如果将来仍有样本被 cancel 或失败，V1 当前只会回 output="" 让甲方看不到原因。建议在 V1 sample 对象上加一个可选字段 `error`，并把 normalizeSample 的 raw.error.message 透出来：

```ts
// resultReader.ts EvalSample 类型加一个 error?: string
// normalizeSample 加：
const errMsg = raw?.error?.message;
return {
  id: ..., input: ..., target: ..., output, score: ..., metadata: ...,
  ...(errMsg ? { error: String(errMsg).slice(0, 500) } : {}),
};

// v1Controller.ts:419 也要透传：
samples = result.samples.map((s) => ({
  id: s.id, input: s.input, output: s.output,
  ...(s.error ? { error: s.error } : {}),
}));
```

这样甲方看到 output="" 时能立刻看出来是 cancel 还是别的原因。

---

## 六、类似 bug

### 6.1 同类受害 scorer（同样读 `state.output.message`）

`grep -rn "state.output.message" .venvs/b3/lib/python3.10/site-packages/inspect_evals/` 的结果：

```
inspect_evals/b3/scorer.py:63
inspect_evals/agentharm/scorer.py:?    # 待 grep 确认
inspect_evals/agentdojo/scorer.py:?    # 待 grep 确认
```

**风险评估**：所有走 ts_bridge_solver 的 benchmark 都受影响 —— V1 的 4 种 agent 形态（dify_chat / dify_workflow / cli / openai_compat 经 bridge）都通过 ts_bridge_solver 进入 scorer。Fix A 一改全部解决。

### 6.2 message_to_text 假设也会炸

`inspect_evals/b3/scorer.py:79`：`response_text = message_to_text(response_message)` 调用 line 37：

```python
def message_to_text(message: ChatMessageAssistant) -> str:
    text = message.text
    if message.tool_calls is not None:
        for tool_call in message.tool_calls:
            text += "\n" + _tool_call_to_str(tool_call)
    return text
```

只要 line 64 拿到了 ChatMessageAssistant（Fix A 后保证有），这里就 OK。

### 6.3 V1 agent 形态 vs benchmark 兼容性矩阵

修完 Fix A 后值得跑一遍 4 形态 × 几个代表 benchmark 的小回归（每个 1-2 sample）。建议清单：

| Agent 形态 | b3 | bfcl | truthfulqa | agentharm | agentdojo |
|---|---|---|---|---|---|
| openai_compat | OK 应保持 | OK | OK | 需测 | 需测 |
| dify_chat | **此次修复** | OK | OK | 需测 | 需测 |
| dify_workflow | 同 dify_chat | 需测 | 需测 | 需测 | 需测 |
| cli | 同上 | 需测 | 需测 | 需测 | 需测 |

回归命令：每形态 + 每 benchmark = 1 个最小 V1 提交，看 5 样本是否全有 output、是否有 IndexError。

### 6.4 如果将来加新 scorer，怎么避免再踩

ts_bridge_solver 必须维持「写完整 ModelOutput 不变量」。建议在 `ts_bridge_solver.py` 加一行 assert（dev 模式打开）：

```python
# 文件末，return state 之前
assert state.output.choices and state.output.choices[0].message is not None, \
    "ts_bridge must populate state.output.choices to satisfy scorers reading state.output.message"
```

或写成日志告警，不阻塞生产。

---

## 七、验证清单（实施 Fix A 后）

- [ ] `grep -n "state.output.choices" server/eval-engine/ts_bridge_solver.py` —— 应至少 1 处赋值
- [ ] 重启 backend（systemctl restart asp-refractor 或本地 dev server）
- [ ] V1 提交 1 个新 job：dify_chat agent + benchmarks=["b3"] + count=5
- [ ] 等终态后 `curl /api/v1/evaluate/<id>` —— 5 个 samples 应全部 output_len > 0
- [ ] 看 inspect_ai log（`results/<agent>/b3/logs/*.json`）—— 应无 IndexError、无 CancelledError
- [ ] 跑 dify_workflow + cli + openai_compat 各一遍同样 b3 提交

---

## 八、附：与 Bug 1 的协同

Bug 1（count 分配）会让 b3 task 的 samples_total 被 cap 到 5（数据集只有 5 条）。
Bug 3 修完后：
- count=20 三 bench → 实际生成 5+7+7=19（仍然不到 20，因 b3 数据集限制）→ 还是 Bug 1 的"分母对不齐"问题
- 需要 Bug 1 的 base+remainder 分配 + 数据集容量探测 + 余量再分配 才能保证 ==20

两个 bug 互独立但叠加效应明显。先 Fix Bug 3（恢复 b3 输出），Bug 1 再做精确分配 + 余量补偿。

---

## 九、验收结果（2026-04-29）

### 9.1 Job 66（首次回归 — Fix A 已落地，但暴露新 Bug）

提交：`POST /api/v1/evaluate` benchmarks=[bfcl,b3,truthfulqa] count=20，agent=dify_chat (id=25)。

| 项 | 结果 |
|---|---|
| `taskId` | 66 |
| Job 状态 | `completed` |
| 分配 | bfcl=7, b3=7, truthfulqa=6 → totalSamples=20 ✓（Bug 1 base+remainder 生效）|
| **实际跑出** | bfcl=7, b3=**35**(!), truthfulqa=6 → totalSamples=48 |
| b3 是否还有 IndexError | 否；7×5=35 全部成功；output_len 均 > 0 ✓（Fix A 生效）|
| SSE | sample.start ×41 + sample.finish ×46 + heartbeat ×17 + task ×5 + status/job ×2 ✓（Bug 2 生效）|

**新发现的 Bug**：b3 task 默认 `epochs=5`（`inspect_evals/b3/b3.py:99`）。当 V1 走 `--sample-id` 路径（b3 有 `benchmarks/indexes/b3/b3.yaml` 300 条 curated 索引），`commandBuilder.ts` 只在 `--limit` 分支强制 `--epochs 1`（line 152-153），`--sample-id` 分支漏了 → 7 IDs × 5 epochs = 35 实际样本，超出甲方预算。

### 9.2 Fix B（commandBuilder.ts）

将 `--epochs 1` 移出 `--limit` 分支，统一在「caller 给了 limit」时强制写入：

```typescript
// commandBuilder.ts
if (limit && !hasSampleIds) {
  cmd.push('--limit', String(limit));
}
// Force epochs=1 whenever the caller asked for a finite budget — applies to
// both --limit and --sample-id paths so that benchmarks like b3 (epochs=5
// default) don't silently 5× the requested sample count.
if (limit) {
  cmd.push('--epochs', '1');
}
```

### 9.3 Job 67（二次回归 — 包含 Fix A + Fix B）

提交：同 9.1，重新跑。

| 项 | 结果 |
|---|---|
| `taskId` | 67 |
| Job 状态 | `completed` |
| 分配 | bfcl=7, b3=7, truthfulqa=6 → 20 ✓ |
| **实际跑出** | bfcl=7, b3=7, truthfulqa=6 → totalSamples=20 ✓（与请求相符）|
| 每条 output | 全部非空，b3 output_len = [1713, 1390, 1358, 1119, 1614, 982, 704] ✓ |
| 错误数 | 0 |
| samplingNotes | null（实际 == 请求，无需提示）|
| SSE | sample.start ×15 + sample.finish ×20 + heartbeat ×20 + task ×5 + status/job ×2 ✓ |

**结论**：Bug 1 / Bug 2 / Bug 3 / Fix B（epochs 倍乘）四个问题在 Job 67 一并通过。所有 7 条 b3 样本都有正常 output（704–1713 字符），无 IndexError、无 CancelledError、无 epochs 超额。
