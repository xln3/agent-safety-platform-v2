# Bug Report 4: Analogous Pattern Sweep

## Family 1: Count/Limit distribution (analog of Bug 1)

**Pattern**: Math.ceil/floor divisions used as allocators without accounting for rounding
artifacts and benchmark→task expansion. Finds places that compute per-task limits from
a total count but ignore the Σ ≠ count property.

### Findings

1. **v1Controller.ts:619**: `Math.ceil(totalCount / payload.benchmarks.length)` allocates samples
   per benchmark. Bug: ignores benchmark→task expansion (benchmark may have multiple tasks); ceil
   artifacts make Σ ≠ count when benchmark count doesn't divide evenly.
   - **Risk**: Real bug. Identical to original Bug 1 for v1 API. Will cause sample shortfall today.

2. **evalController.ts:183-184**: `perTaskTotal = limitNum > 0 ? limitNum : 0` + `jobTotalSamples
   = perTaskTotal * tasksToCreate.length` allocates per-task budget. Bug: does NOT ceil/floor
   per-benchmark, so avoids rounding artifacts, but code comment (line 181) acknowledges this
   is a defensive prediction only. Comments say "Defensive bumps in internalAgentRunnerController
   keep this honest if inspect_ai exceeds the predicted count."
   - **Risk**: Theoretical (not a bug; defensive design). Safe-by-design via runtime bumps.

3. **resultController.ts:165**: `Math.ceil(total / pageSize)` for pagination. This is safe—
   it's computing page count from results already on disk, not allocating future work.
   - **Risk**: False positive. Not an allocator.

4. **evalRunner.ts:938**: `Math.floor(maxLength / 2)` for error truncation. Safe—one-shot
   string operation, not an allocator.
   - **Risk**: False positive. Not sample-related.

5. **v1Controller.ts:485**: `Math.floor(raw)` on timeoutSec. Safe—one-shot math, not a count.
   - **Risk**: False positive. Not sample-related.

### Additional check: Per-dataset capacity

v1Controller.ts:666-667 computes `jobTotalSamples = perTaskTotal * tasksToCreate.length`
without checking per-benchmark capacity caps. The code expands benchmarks to tasks (line
626-635) but never validates that per-task limits honor benchmark-specific `limit` fields
from catalog.yaml (if they exist). This is the same root cause as Bug 1: ignores nested
structure.

### Risk Assessment
- **Real bugs**: 1 (v1Controller.ts:619 — identical to Bug 1).
- **Theoretical**: 1 (evalController.ts—already defended against).
- **False positives**: 3.

---

## Family 2: Hidden in-progress events (analog of Bug 2)

**Pattern**: Endpoints returning one-shot JSON snapshots of a running job while the
underlying state changes over time (via sseService broadcasts). Web UI uses /stream,
but one-shot endpoints don't mention the limitation.

### Findings

1. **v1Controller.ts:803** — `GET /api/v1/evaluate/:taskId` returns snapshot via
   `buildStatusPayload(taskId, samplesPerTask)`. This fetches EvalJob + EvalTask from DB
   and returns them as one-shot JSON. Meanwhile, sseService broadcasts `sample.finish`
   events that the V1 GET ignores (line 331 in internalAgentRunnerController shows
   sseService.emit('sample.finish') calls).
   - **Hidden info**: Per-sample progress (input/output/score) is streamed to Web UI via
     `/api/eval/jobs/:id/stream` (evalRoutes.ts:12, evalStreamController.ts) but V1 GET
     returns only the pre-paginated sample list. The job may be finishing samples in real-time
     while the GET response is being assembled.
   - **Risk**: Real bug. Callers of V1 GET cannot track progress reliably. They must poll
     and diff snapshots, not subscribe to events.

2. **evalController.ts:291** — `GET /api/eval/jobs/:id` returns `successResponse(job)` after
   `findByPk()`. This is a snapshot of job status at query time. Meanwhile, the job is running
   and sseService is emitting `task.finish`, `sample.finish` events.
   - **Hidden info**: Job status (running/completed/failed) may change between consecutive
     GET calls. No streaming variant exists for this endpoint (evalRoutes.ts has no
     GET /api/eval/jobs/:id/stream).
   - **Risk**: Defensive worth. The Web UI does use `/api/eval/jobs/:id/stream` (line 12)
     for per-sample progress, but the job status snapshot itself is stale-by-design.

3. **v1Controller.ts:529** — In sync wait loop: `const job = await EvalJob.findByPk(jobId,
   { attributes: ['status'] })` polls job status every 2 seconds (SYNC_POLL_INTERVAL_MS).
   This is a snapshot poll pattern, not a subscription. Correct for sync mode, but relies on
   frequent polling rather than event-driven updates.
   - **Hidden info**: Job status changes are event-driven (via sseService), not polled.
     Polling every 2 seconds may miss brief intermediate states.
   - **Risk**: Theoretical (polling is acceptable for sync mode; 2s interval is reasonable).

4. **resultController.ts:22** — `GET /api/results/by-job/:jobId` returns snapshot via
   `findByPk()`. This returns task scores + aggregates at query time. If a job is still
   running (status = 'running'), the scores may be stale.
   - **Hidden info**: Scores are finalized only when task status = 'success'. A running
     job shows incomplete scores, but the endpoint doesn't advertise this.
   - **Risk**: Defensive worth. The endpoint is typically called after a job completes,
     but early callers see partial results.

### Pattern Summary
- V1 GET is the only endpoint where polling callers (non-streaming) face a real limitation.
- evalController endpoints have streaming variants in evalStreamController.ts.
- The core issue: one-shot endpoints don't document that sseService is the source of truth
  for in-flight updates.

### Risk Assessment
- **Real bugs**: 1 (v1Controller.ts:803 — no streaming variant, V1 callers can't subscribe).
- **Theoretical**: 2 (polling, early access to partial results).
- **Well-designed**: 1 (evalController — streaming variant exists for per-sample tracking).

---

## Family 3: Bridge/scorer compatibility (analog of Bug 3)

**Pattern**: Python solvers/scorers that access state.output.message or state.output.choices[0]
will crash with IndexError when ts_bridge_solver.py sets only completion, not choices.

### Findings

1. **ts_bridge_solver.py:190** — Sets `state.output.completion = output` ONLY. Does not set
   `state.output.choices`. This means `state.output.message` (a property that does
   `self.choices[0].message`) will raise IndexError.
   - **Root cause**: (confirmed as per original Bug 3).
   - **Risk**: Real bug affecting downstream scorers.

2. **b3/scorer.py:63-64** — `if state.output and state.output.message:` reads
   `state.output.message`. When ts_bridge sets only completion, this crashes.
   - **Benchmarks affected**: b3 (in catalog tool_calling category, actively used).
   - **Risk**: Real bug. Blocks b3 for ts_bridge users today.

3. **assistant_bench/solver.py** — Accesses `state.output.message`. When called via
   ts_bridge, will crash.
   - **Benchmarks affected**: assistant_bench (source unknown; may not be in active catalog).
   - **Risk**: Real bug if benchmark is in active catalog.

4. **sosbench/sosbench.py** — Accesses `state.output.message`. When called via ts_bridge,
   will crash.
   - **Benchmarks affected**: sosbench (meta-benchmark, may aggregate others).
   - **Risk**: Real bug if sosbench is active.

5. **mind2web/solver.py** — Accesses `state.output.choices[0]` directly. When ts_bridge
   doesn't populate choices, will raise IndexError.
   - **Benchmarks affected**: mind2web.
   - **Risk**: Real bug if mind2web is active and uses ts_bridge.

### Safe scorers (use state.output.completion)
- **agentdojo/scorer.py:25, 34, 68** — Uses `state.output.completion`. Safe.
- **agentharm/scorer.py** — Uses `state.messages[].text`. Safe (ts_bridge populates messages).
- **Most in-house benchmarks** (asb, mm_safety_bench, psysafe, safeagentbench, etc.) —
  Use `state.output.completion`. Safe.

### Catalog active benchmarks that may be affected
From catalogService.ts (BENCHMARK_META):
- **b3**: ✓ active, tool_calling category, HAS state.output.message access → BLOCKS.
- **agentharm**: active, harmful_task category, SAFE (uses state.messages).
- **agentdojo**: active, tool_calling category, SAFE (uses state.output.completion).
- **assistant_bench**: unknown status, HAS state.output.message access.
- **sosbench**: unknown status (meta-benchmark?), HAS state.output.message access.
- **mind2web**: unknown status, HAS state.output.choices[0] access.

### Risk Assessment
- **Real bugs blocking usage today**: 1 (b3 with ts_bridge users).
- **Real bugs if benchmarks are active**: 2–3 (assistant_bench, sosbench, mind2web).
- **Safe by design**: 2+ (agentdojo, agentharm, in-house scorers).

---

## Summary: Fix Priority

### Immediate (block production usage)
1. **Bug 1 variant (v1Controller.ts:619)**: Identical root cause to reported Bug 1. Fix by
   tracking Σ allocation and adjusting last task, or use fair distribution (quota/task = count
   / num_tasks, allocate quota per task, redistribute remainder).
2. **Bug 3 variant (b3 scorer + ts_bridge)**: b3 is actively used. Fix by either:
   - Making ts_bridge set state.output.choices = [{ message: output }] (safer).
   - Patching b3/scorer.py to use state.output.completion (quick workaround).

### High (incomplete visibility)
3. **Bug 2 variant (v1Controller.ts:803)**: V1 API lacks streaming variant. Add
   `/api/v1/evaluate/:taskId/stream` endpoint or document that V1 is one-shot only.

### Defer or defend
4. **evalController.ts**: Already defended; streaming variant exists.
5. **assistant_bench, sosbench, mind2web**: Verify if active in catalog. If yes, add to
   Bug 3 fix list. If no, defer.

---

## Code locations for fixes

| Bug | File | Line | Fix Type |
|-----|------|------|----------|
| 1-variant | v1Controller.ts | 619 | Distribution algo |
| 2-variant | v1Controller.ts | 803 | Add /stream endpoint |
| 3-variant | ts_bridge_solver.py | 190 | Set choices field |
| 3-check | catalogService.ts | (all) | Verify b3 status |

