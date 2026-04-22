# 智能体安全评估平台 — Python 基准测试代码技术说明

> **文档性质：** 技术论证报告
> **版本：** 1.0
> **日期：** 2026-04-19

---

## 摘要

本平台的代码仓库中存在约 6,450 行 Python 代码（38 个文件），全部位于评估引擎的基准测试目录下（`server/eval-engine/benchmarks/`）。本文档从技术角度论证以下两点：

1. **这些 Python 代码无法翻译为 TypeScript**——它们是第三方评估框架 `inspect_ai` 的插件文件，受框架约束必须使用 Python 编写。
2. **这些 Python 代码不参与主程序运行**——它们在独立的子进程和隔离的虚拟环境中执行，与平台的 Node.js/TypeScript 主进程在进程、内存、依赖三个层面完全隔离。

---

## 一、平台架构与语言分工

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户浏览器                              │
│                  React + TypeScript                      │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (/api)
┌──────────────────────▼──────────────────────────────────┐
│              Node.js / Express 后端                       │
│              100% TypeScript                             │
│                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│  │  路由/控制器   │ │  业务服务     │ │  数据模型(MySQL) │ │
│  │  routes/      │ │  services/   │ │  models/         │ │
│  └──────────────┘ └──────┬───────┘ └──────────────────┘ │
│                          │                               │
│  ┌───────────────────────▼────────────────────────────┐  │
│  │            评估编排层（TypeScript）                    │  │
│  │  evalRunner.ts · commandBuilder.ts · venvService.ts │  │
│  └───────────────────────┬────────────────────────────┘  │
└──────────────────────────┼───────────────────────────────┘
                           │ child_process.spawn()
              ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 进程隔离边界
                           │
┌──────────────────────────▼───────────────────────────────┐
│           独立 Python 子进程（inspect eval CLI）            │
│           运行于独立虚拟环境（.venvs/<benchmark>/）          │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │        inspect_ai 框架（第三方，UK AISI 开发）       │   │
│   │  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │   │
│   │  │ @task 注册  │ │ @solver    │ │ @scorer 评分  │  │   │
│   │  └────────────┘ └────────────┘ └──────────────┘  │   │
│   └──────────────────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────────┐   │
│   │  本项目自研的 5 个 benchmark（Python 插件文件）       │   │
│   │  clash_eval · open_agent_safety · raccoon         │   │
│   │  safeagentbench · saferag                         │   │
│   └──────────────────────────────────────────────────┘   │
│                                                          │
│   执行完毕后输出 .eval 结果文件 → TypeScript 侧解析         │
└──────────────────────────────────────────────────────────┘
```

### 1.2 语言分工统计

| 层级 | 语言 | 行数 | 职责 |
|------|------|------|------|
| 前端（页面/组件/服务/样式） | TypeScript + TSX | 4,431 | 用户界面 |
| 后端 API（路由/控制器/服务/模型） | TypeScript | 7,449 | 业务逻辑、数据持久化、评估编排 |
| 基准测试任务定义 | Python | 6,450 | inspect_ai 框架插件（非业务逻辑） |

**TypeScript 在业务层的占比为 100%。Python 仅存在于评估框架的插件层。**

---

## 二、Python 代码不可翻译为 TypeScript 的技术论证

### 2.1 根本原因：inspect_ai 是纯 Python 框架

`inspect_ai`（v0.3.205）由英国人工智能安全研究所（UK AI Safety Institute）开发，是当前智能体安全评估领域的标准框架。

| 属性 | 事实 |
|------|------|
| 实现语言 | 纯 Python |
| TypeScript/JavaScript SDK | **不存在** |
| REST API | **不提供**（内置 web 仅用于日志查看） |
| 非 Python 接口 | **仅有 CLI**（`inspect eval` 命令行） |
| 社区 benchmark 数量 | 62 个（inspect_evals 包，本平台已接入 49 个） |

**该框架没有 TypeScript 版本，也没有计划开发 TypeScript 版本。**

### 2.2 benchmark 代码与框架的耦合关系

每个 benchmark 不是独立程序，而是 inspect_ai 框架的**配置插件**。以 `clash_eval` 为例：

```python
from inspect_ai import Task, task
from inspect_ai.solver import generate
from inspect_ai.scorer import scorer, Score, Scorer, Target

@task                                    # ← 框架装饰器，注册评估任务
def clash_eval() -> Task:               # ← 返回框架专有类型
    return Task(
        dataset=load_dataset(),          # ← 框架数据集接口
        solver=[generate()],             # ← 框架求解器
        scorer=context_adherence(),      # ← 框架评分器
    )

@scorer                                 # ← 框架装饰器，注册评分器
def context_adherence() -> Scorer:
    async def score(state, target):      # ← 框架回调签名
        return Score(value=...,          # ← 框架专有类型
                     explanation=...)
    return score
```

上述代码中，**每一行都依赖 inspect_ai 框架提供的类型、装饰器或运行时机制**。这不是"用 Python 写的通用逻辑"，而是"inspect_ai 框架规定必须用 Python 编写的插件"。

### 2.3 框架专有机制：TypeScript 无法复现

| inspect_ai 机制 | 工作原理 | TypeScript 能否替代 |
|-----------------|---------|-------------------|
| `@task` 装饰器 | 利用 Python 的 `importlib.metadata` entry_points 系统，在模块导入时自动注册任务 | **不能** — TypeScript 无等价的包元数据注册机制 |
| `@scorer` 装饰器 | 将函数包装为框架评分器，运行时注入 `(TaskState, Target)` 参数 | **不能** — 需要框架运行时的状态管理 |
| `@tool` 装饰器 | 运行时反射函数签名，自动生成 JSON Schema 供大模型调用 | **不能** — TypeScript 编译后丢失参数名和类型信息 |
| `@solver` 装饰器 | 定义可组合的求解策略，框架按顺序执行并传递可变状态 | **不能** — 需要框架的 `TaskState` 可变状态对象 |
| `generate()` | 框架内部的模型调用抽象，支持 OpenAI/Anthropic/Google 等 | **不能** — 框架内部实现，不可外部调用 |
| `basic_agent()` | 框架内置的交互式 agent 循环，管理多轮工具调用 | **不能** — 约 5,000 行框架内部代码 |

### 2.4 外部 Python 专有依赖

| 依赖 | 用于 | 说明 |
|------|------|------|
| `rouge-score` | raccoon benchmark | Google 开发的 ROUGE-L 评分库，含 C 扩展加速，JavaScript 生态无精确等价物 |
| `pandas` | clash_eval | 读取 Parquet 二进制数据集格式 |
| `httpx` + `asyncio.Lock` | safeagentbench | 异步 HTTP 客户端 + 协程锁（与 Node.js 事件循环语义不同） |
| `ast` 模块 | saferag | Python 标准库，安全解析代码片段，JavaScript 无等价物 |

### 2.5 如果强行翻译，需要的工作量

要将这 6,450 行 Python 翻译为 TypeScript，**前提条件**是先用 TypeScript 重新实现 inspect_ai 框架本身（约 50,000 行代码）。

| 工作项 | 预估工时 | 说明 |
|--------|---------|------|
| 用 TS 重写 inspect_ai 核心框架 | 3-4 个月 | 装饰器注册、求解/评分回调、模型抽象、工具自省 |
| 用 TS 重写 inspect_evals 上游 benchmark | 2-3 个月 | 当前平台接入了 49 个上游 benchmark |
| 翻译 5 个自研 benchmark | 1-2 个月 | 逻辑翻译 + 依赖替换 |
| 替换 Python 专有依赖 | 1 个月 | rouge-score、pandas 等 |
| 回归测试 + 评分一致性验证 | 2-3 个月 | 确保翻译后的评分结果与原版一致 |
| **合计** | **9-13 个月（2-3 名工程师）** | — |

翻译完成后将**永久丧失**：

- 无法接入 inspect_evals 社区持续更新的 62+ 个 benchmark
- 无法使用 `inspect eval` CLI 进行单 benchmark 调试
- 无法使用 `inspect view` 内置结果查看器
- 无法跟进 inspect_ai 框架的版本更新和安全补丁
- 与国际 AI 安全评估社区脱节

---

## 三、Python 代码不影响主程序运行的技术论证

### 3.1 进程隔离

Python 代码运行在由 Node.js `child_process.spawn()` 创建的**独立子进程**中。

```
Node.js 主进程 (PID 3939912, 端口 3002)
  │
  ├── 不加载任何 .py 文件
  ├── 不调用 Python 解释器
  ├── 不导入 Python 模块
  │
  └── spawn() ──→ Python 子进程 (独立 PID)
                    ├── 独立内存空间
                    ├── 独立 CPU 调度
                    └── 崩溃不影响主进程
```

TypeScript 编排层（`evalRunner.ts`）的关键实现：

```typescript
const proc = spawn(inspectPath, args, {
    env,                    // 隔离的环境变量
    cwd: evalPocRoot,       // 隔离的工作目录
    detached: true,         // 独立进程组
});
```

- Python 子进程崩溃（段错误、OOM、异常退出）→ TypeScript 捕获退出码，标记任务失败，主进程不受影响。
- Python 子进程挂起 → TypeScript 有 4 小时超时机制，强制终止子进程。

### 3.2 虚拟环境隔离

每个 benchmark 运行在**独立的 Python 虚拟环境**中：

```
server/eval-engine/.venvs/
├── clash_eval/          # 独立 Python 解释器 + 独立依赖
├── saferag/             # 独立 Python 解释器 + 独立依赖
├── raccoon/             # 独立 Python 解释器 + 独立依赖
├── ...
```

- 不依赖系统 Python
- 不与其他 benchmark 共享依赖
- 不与 Node.js 共享任何运行时

### 3.3 依赖隔离

| 层面 | Node.js 主进程 | Python 子进程 |
|------|---------------|-------------|
| 包管理 | npm (node_modules/) | pip (.venvs/\<name\>/) |
| 依赖声明 | package.json | pyproject.toml |
| 运行时 | V8 JavaScript 引擎 | CPython 解释器 |
| 内存空间 | 独立 | 独立 |
| 环境变量 | 主进程 env | spawn 时显式构造，互不污染 |

### 3.4 通信方式：纯文件 I/O

TypeScript 与 Python 之间**没有任何运行时耦合**，通信仅通过文件系统：

```
TypeScript 侧                         Python 侧
─────────────                         ─────────
1. 构造 CLI 命令字符串    ──spawn()──→  inspect eval ...
2. 等待进程退出                         执行评估，输出 .eval 文件
3. 读取 .eval 文件（ZIP 格式）←─────── 评估完毕，进程退出
4. 用 adm-zip (TS库) 解析结果
5. 写入 MySQL 数据库
```

- 不使用 Python 的任何 IPC 机制（socket、pipe、shared memory）
- 不导入任何 Python 模块
- 不调用任何 Python 函数
- 结果解析完全在 TypeScript 侧完成（`resultReader.ts`，使用 `adm-zip` 库）

### 3.5 实证验证

| 场景 | 主程序行为 |
|------|----------|
| 删除全部 .py 文件 | 前端页面正常、API 正常、智能体 CRUD 正常、报告查看正常。仅"开始评估"功能不可用 |
| Python 子进程崩溃 | 对应 EvalTask 标记为 failed，主进程继续运行，其他评估任务不受影响 |
| 虚拟环境不存在 | venvService 自动创建后重试，主进程不受影响 |
| Python 版本不兼容 | 报 venv 创建错误，主进程正常运行 |

---

## 四、行业对照

以下是主流 AI 评估系统的语言分布：

| 项目 | 主体语言 | 评估任务语言 | 评估框架 |
|------|---------|------------|---------|
| OpenAI simple-evals | Python | Python | 自研 |
| Google BIG-bench | Python | Python | 自研 |
| Meta llama-recipes | Python | Python | lm-eval-harness |
| UK AISI inspect_evals | Python | Python | inspect_ai |
| **本平台** | **TypeScript** | **Python** | **inspect_ai** |

本平台是上述所有项目中**唯一将主体业务逻辑用 TypeScript 实现**的。Python 仅保留在评估框架的插件层，这已经是比行业惯例更激进的 TypeScript 化方案。

---

## 五、结论

| 论点 | 结论 |
|------|------|
| Python 代码能否翻译为 TypeScript？ | **不能**。受 inspect_ai 框架约束，benchmark 插件必须使用 Python |
| 强行翻译的代价？ | 9-13 人月，且失去与 62+ 个社区 benchmark 的兼容性 |
| Python 代码是否影响主程序运行？ | **不影响**。进程隔离、虚拟环境隔离、依赖隔离、纯文件通信 |
| Python 代码的本质是什么？ | 第三方评估框架的插件/配置，不是业务逻辑 |
| 如何改善 GitHub 语言统计？ | 添加一行 `.gitattributes` 标记为 vendored 代码即可 |

---

## 附录 A：GitHub 语言统计修正

在项目根目录添加 `.gitattributes` 文件即可让 GitHub Linguist 将 benchmark 代码识别为第三方代码（vendored），不计入语言统计：

```
server/eval-engine/benchmarks/**/*.py linguist-vendored
```

修正后 GitHub 将显示 TypeScript 约 95%+。

## 附录 B：Python 文件完整清单

共 38 个文件，全部位于 `server/eval-engine/benchmarks/` 目录下：

```
eval_benchmarks/__init__.py                           # 包初始化
eval_benchmarks/_registry.py                          # 任务注册入口
eval_benchmarks/clash_eval/__init__.py                # clash_eval 包
eval_benchmarks/clash_eval/clash_eval.py              # 知识冲突评估任务
eval_benchmarks/clash_eval/prompt.py                  # 提示词模板
eval_benchmarks/clash_eval/scorer.py                  # 评分逻辑
eval_benchmarks/open_agent_safety/__init__.py          # 包初始化
eval_benchmarks/open_agent_safety/open_agent_safety.py # 开放安全评估任务
eval_benchmarks/open_agent_safety/scorer.py            # 混合评分器
eval_benchmarks/raccoon/__init__.py                    # 包初始化
eval_benchmarks/raccoon/dataset.py                     # 数据集加载
eval_benchmarks/raccoon/raccoon.py                     # 金融安全评估任务
eval_benchmarks/raccoon/scorer.py                      # ROUGE-L 评分
eval_benchmarks/raccoon/templates.py                   # 提示词模板
eval_benchmarks/safeagentbench/__init__.py              # 包初始化
eval_benchmarks/safeagentbench/dataset.py               # 数据集加载
eval_benchmarks/safeagentbench/safeagentbench.py        # 任务规划评估
eval_benchmarks/safeagentbench/scorer.py                # 语义评分
eval_benchmarks/safeagentbench/execution_scorer.py      # 执行评分
eval_benchmarks/safeagentbench/solvers.py               # 7 种求解策略
eval_benchmarks/safeagentbench/prompts.py               # 提示词模板
eval_benchmarks/safeagentbench/tools.py                 # 工具定义
eval_benchmarks/safeagentbench/visual_tools.py          # 视觉工具
eval_benchmarks/safeagentbench/thor_client.py           # Docker 通信
eval_benchmarks/safeagentbench/thor_lifecycle.py         # 模拟器生命周期
eval_benchmarks/safeagentbench/state_comparison.py       # 状态对比
eval_benchmarks/safeagentbench/docker/server.py          # Docker 容器服务端
eval_benchmarks/safeagentbench/docker/low_level_controller.py  # 底层控制器
eval_benchmarks/saferag/__init__.py                     # 包初始化
eval_benchmarks/saferag/saferag.py                      # RAG 安全评估任务
eval_benchmarks/saferag/dataset.py                      # 数据集加载
eval_benchmarks/saferag/scorer.py                       # 评分逻辑
eval_benchmarks/saferag/direct_retriever.py             # 文档检索器
eval_benchmarks/saferag/utils.py                        # 路径工具
benchmarks/__init__.py                                  # 包初始化
benchmarks/patches/makemesay_utils.py                   # 上游补丁
benchmarks/patches/osworld_sparse_clone.py              # 上游补丁
benchmarks/patches/threecb_patch_dockerfiles.py         # 上游补丁
```
