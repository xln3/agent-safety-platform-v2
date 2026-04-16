/**
 * scoreService.ts
 *
 * Convert raw benchmark scores to normalised safety scores (0-100)
 * using the pure TypeScript scoreMapper module (no Python dependency).
 *
 * Flow:
 *   1. readEvalHeader() -> raw metrics
 *   2. Determine benchmark name via TASK_BENCHMARK_MAP
 *   3. Call convertScore(benchmark, rawScore)
 *   4. Update EvalTask record in MySQL
 */

import logger from '../utils/logger';
import EvalTask from '../models/EvalTask';
import { readEvalHeader, extractPrimaryMetric } from './resultReader';
import { convertScore, type ScoreResult as MapperResult } from './scoreMapper';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreResult {
  safetyScore: number;   // 0-100
  riskLevel: string;     // CRITICAL / HIGH / MEDIUM / LOW / MINIMAL
  interpretation: string; // Chinese description
}

// ---------------------------------------------------------------------------
// TASK_BENCHMARK_MAP — ported from Python score_service._TASK_TO_MAPPER
//
// Maps specific task names to the benchmark name used by score_mapper.
// When a task name is NOT in this map, the task name itself is used as
// the mapper key (most benchmarks use their own name directly).
// ---------------------------------------------------------------------------

const TASK_BENCHMARK_MAP: Record<string, string> = {
  // PersonalizedSafety variants
  personalized_safety_context_free: 'personalized_safety',
  personalized_safety_context_rich: 'personalized_safety',
  personalized_safety_youth: 'personalized_safety',
  personalized_safety_elderly: 'personalized_safety',
  personalized_safety_healthcare: 'personalized_safety',

  // PrivacyLens
  privacylens_probing_vignette: 'privacylens_probing',

  // SafeAgentBench variants
  safeagentbench_react: 'safeagentbench',
  safeagentbench_visual: 'safeagentbench',

  // ASB
  asb_ipi: 'asb',

  // SecQA
  sec_qa_v1: 'sec_qa',
  sec_qa_v2: 'sec_qa',

  // Personality
  personality_BFI: 'personality',
  personality_TRAIT: 'personality',

  // IHEval variants
  iheval_rule_multi_aligned: 'iheval',
  iheval_rule_multi_conflict: 'iheval',
  iheval_rule_single_aligned: 'iheval',
  iheval_task_extraction: 'iheval',
  iheval_task_translation: 'iheval',
  iheval_safety_hijack: 'iheval',
  iheval_safety_extraction: 'iheval',
  iheval_tool_webpage: 'iheval',
  iheval_task_lang_detect: 'iheval',
  iheval_tool_slack_user: 'iheval',

  // HealthBench variants
  healthbench_hard: 'healthbench',
  healthbench_consensus: 'healthbench',

  // WMDP variants
  wmdp_bio: 'wmdp',
  wmdp_chem: 'wmdp',
  wmdp_cyber: 'wmdp',
  wmdp_local_bio: 'wmdp',
  wmdp_local_chem: 'wmdp',
  wmdp_local_cyber: 'wmdp',

  // Fortress
  fortress_adversarial: 'fortress',
  fortress_benign: 'fortress',

  // CulturalBench (these map to themselves, included for explicitness)
  culturalbench_easy: 'culturalbench_easy',
  culturalbench_hard: 'culturalbench_hard',

  // HalluLens
  hallulens_task1_precise_wikiqa: 'hallulens',
  hallulens_task2_longwiki: 'hallulens',
  hallulens_task3_nonsense_mixed_entities: 'hallulens',
  hallulens_task3_round_robin_nonsense_name: 'hallulens',

  // SevenLLM
  sevenllm_mcq_zh: 'sevenllm',
  sevenllm_mcq_en: 'sevenllm',
  sevenllm_qa_zh: 'sevenllm',
  sevenllm_qa_en: 'sevenllm',

  // AssistantBench
  assistant_bench_closed_book: 'assistant_bench',
  assistant_bench_closed_book_zero_shot: 'assistant_bench',
  assistant_bench_web_browser: 'assistant_bench',

  // MSSBench
  mssbench_chat_if: 'mssbench',
  mssbench_chat_qc: 'mssbench',
  mssbench_chat_ic: 'mssbench',
  mssbench_chat_ic_cap: 'mssbench',
  mssbench_embodied_if: 'mssbench',
  mssbench_embodied_qc: 'mssbench',
  mssbench_embodied_ic: 'mssbench',
  mssbench_embodied_ic_cap: 'mssbench',
  mssbench_chat: 'mssbench',
  mssbench_embodied: 'mssbench',

  // MM-SafetyBench
  mm_safety_bench_illegal_activity: 'mm_safety_bench',

  // CyberSecEval 3
  cyse3_visual_prompt_injection: 'cyberseceval_3',

  // MMMU
  mmmu_multiple_choice: 'mmmu',
  mmmu_open: 'mmmu',

  // SafeRAG sub-tasks
  saferag_sn: 'saferag',
  saferag_icc: 'saferag',
  saferag_sa: 'saferag',
  saferag_wdos: 'saferag',

  // GDM Self-Reasoning
  gdm_approved_directories: 'gdm_self_reasoning',
  gdm_calculator_improvement: 'gdm_self_reasoning',
  gdm_context_length_mod_instrumental_only: 'gdm_self_reasoning',
  gdm_context_length_mod_irreversibility_only: 'gdm_self_reasoning',
  gdm_database_tool: 'gdm_self_reasoning',
  gdm_latency_calculator: 'gdm_self_reasoning',
  gdm_max_messages_calculator: 'gdm_self_reasoning',
  gdm_max_tokens: 'gdm_self_reasoning',
  gdm_oversight_frequency: 'gdm_self_reasoning',
  gdm_read_logs: 'gdm_self_reasoning',
  gdm_turn_off_filters: 'gdm_self_reasoning',

  // GDM Stealth
  gdm_oversight_pattern: 'gdm_stealth',
  gdm_classifier_evasion: 'gdm_stealth',
  gdm_cover_your_tracks: 'gdm_stealth',
  gdm_strategic_rule_breaking: 'gdm_stealth',

  // LAB-Bench sub-tasks
  lab_bench_litqa: 'lab_bench',
  lab_bench_suppqa: 'lab_bench',
  lab_bench_figqa: 'lab_bench',
  lab_bench_tableqa: 'lab_bench',
  lab_bench_dbqa: 'lab_bench',
  lab_bench_protocolqa: 'lab_bench',
  lab_bench_cloning_scenarios: 'lab_bench',
  lab_bench_seqqa: 'lab_bench',

  // AgentHarm benign variant
  agentharm_benign: 'agentharm',

  // OSWorld
  osworld_small: 'osworld',
};

// ---------------------------------------------------------------------------
// Score mapper bridge (pure TypeScript — no Python dependency)
// ---------------------------------------------------------------------------

/**
 * Convert a single benchmark raw score to a safety score.
 */
function callScoreMapper(
  benchmarkName: string,
  rawScore: number,
): ScoreResult {
  const result = convertScore(benchmarkName, rawScore);
  return {
    safetyScore: result.safetyScore,
    riskLevel: result.riskLevel,
    interpretation: result.interpretation,
  };
}

/**
 * Batch convert multiple benchmark scores.
 */
function callBatchScoreMapper(
  tasks: Array<{ benchmarkName: string; rawScore: number }>,
): ScoreResult[] {
  return tasks.map((t) => callScoreMapper(t.benchmarkName, t.rawScore));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the benchmark / mapper name for a given task name.
 *
 * Checks TASK_BENCHMARK_MAP first; falls back to the task name itself.
 * Also strips the `inspect_evals/` prefix and normalises hyphens to
 * underscores so that task names from .eval files match our map keys.
 */
function resolveBenchmarkName(taskName: string): string {
  // Normalise: strip common prefix, replace hyphens
  let normalised = taskName;
  if (normalised.includes('/')) {
    normalised = normalised.split('/').pop()!;
  }
  normalised = normalised.replace(/-/g, '_');

  return TASK_BENCHMARK_MAP[normalised] ?? normalised;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the safety score for a single eval task and persist the
 * result to the EvalTask row in MySQL.
 *
 * Steps:
 *   1. Read eval header from the .eval file
 *   2. Extract primary metric value (raw score)
 *   3. Determine benchmark name via TASK_BENCHMARK_MAP
 *   4. Call convertScore() from scoreMapper
 *   5. Update EvalTask record
 */
export async function computeTaskScore(
  taskId: number | string,
  evalFilePath: string,
): Promise<void> {
  const task = await EvalTask.findByPk(taskId);
  if (!task) {
    logger.error(`computeTaskScore: task not found: ${taskId}`);
    return;
  }

  let header;
  try {
    header = await readEvalHeader(evalFilePath);
  } catch (err) {
    logger.error(`computeTaskScore: failed to read eval file for task ${taskId}`, err);
    await task.update({
      riskLevel: null,
      errorMessage: `Failed to read eval file: ${(err as Error).message}`,
    });
    return;
  }

  // Extract the primary metric
  const rawTaskName = task.taskName.replace(/-/g, '_');
  const rawScore = extractPrimaryMetric(header, rawTaskName);

  if (rawScore === null) {
    logger.warn(`computeTaskScore: no metric value found for task ${taskId} (${task.taskName})`);
    await task.update({
      rawScore: null,
      riskLevel: null,
      samplesTotal: header.samplesTotal,
      samplesPassed: header.samplesCompleted,
      errorMessage: 'No metric value found in eval results',
    });
    return;
  }

  // Determine benchmark name and call score_mapper
  const benchmarkName = resolveBenchmarkName(task.taskName);

  let scoreResult: ScoreResult;
  try {
    scoreResult = callScoreMapper(benchmarkName, rawScore);
  } catch (err) {
    logger.error(
      `computeTaskScore: score_mapper failed for task ${taskId} ` +
      `(benchmark=${benchmarkName}, rawScore=${rawScore})`,
      err,
    );
    await task.update({
      rawScore,
      riskLevel: null,
      samplesTotal: header.samplesTotal,
      samplesPassed: header.samplesCompleted,
      errorMessage: `score_mapper error: ${(err as Error).message}`,
    });
    return;
  }

  // Persist results
  await task.update({
    rawScore,
    safetyScore: scoreResult.safetyScore,
    score: scoreResult.safetyScore,
    riskLevel: scoreResult.riskLevel,
    interpretation: scoreResult.interpretation,
    samplesTotal: header.samplesTotal,
    samplesPassed: header.samplesCompleted,
    errorMessage: null,
  });

  logger.info(
    `computeTaskScore: task ${taskId} scored -- ` +
    `raw=${rawScore}, safety=${scoreResult.safetyScore}, risk=${scoreResult.riskLevel}`,
  );
}

/**
 * Batch-compute safety scores for multiple tasks.
 *
 * Optimised: reads all eval headers first, then calls convertScore()
 * from scoreMapper for every task that has a valid metric.
 */
export async function computeBatchScores(
  tasks: Array<{ taskId: number | string; evalFilePath: string }>,
): Promise<void> {
  if (tasks.length === 0) return;

  // Phase 1: read headers and extract raw scores
  interface PreparedTask {
    taskId: number | string;
    task: EvalTask;
    header: Awaited<ReturnType<typeof readEvalHeader>>;
    rawScore: number;
    benchmarkName: string;
  }

  const prepared: PreparedTask[] = [];

  for (const { taskId, evalFilePath } of tasks) {
    const task = await EvalTask.findByPk(taskId);
    if (!task) {
      logger.error(`computeBatchScores: task not found: ${taskId}`);
      continue;
    }

    let header;
    try {
      header = await readEvalHeader(evalFilePath);
    } catch (err) {
      logger.error(`computeBatchScores: failed to read eval file for task ${taskId}`, err);
      await task.update({
        riskLevel: null,
        errorMessage: `Failed to read eval file: ${(err as Error).message}`,
      });
      continue;
    }

    const rawTaskName = task.taskName.replace(/-/g, '_');
    const rawScore = extractPrimaryMetric(header, rawTaskName);

    if (rawScore === null) {
      logger.warn(`computeBatchScores: no metric for task ${taskId} (${task.taskName})`);
      await task.update({
        rawScore: null,
        riskLevel: null,
        samplesTotal: header.samplesTotal,
        samplesPassed: header.samplesCompleted,
        errorMessage: 'No metric value found in eval results',
      });
      continue;
    }

    const benchmarkName = resolveBenchmarkName(task.taskName);
    prepared.push({ taskId, task, header, rawScore, benchmarkName });
  }

  if (prepared.length === 0) return;

  // Phase 2: batch call score_mapper
  let scoreResults: ScoreResult[];
  try {
    scoreResults = callBatchScoreMapper(
      prepared.map((p) => ({ benchmarkName: p.benchmarkName, rawScore: p.rawScore })),
    );
  } catch (err) {
    // If batch call fails, fall back to individual calls
    logger.warn('computeBatchScores: batch call failed, falling back to individual calls', err);
    for (const p of prepared) {
      try {
        const result = callScoreMapper(p.benchmarkName, p.rawScore);
        await p.task.update({
          rawScore: p.rawScore,
          safetyScore: result.safetyScore,
          score: result.safetyScore,
          riskLevel: result.riskLevel,
          interpretation: result.interpretation,
          samplesTotal: p.header.samplesTotal,
          samplesPassed: p.header.samplesCompleted,
          errorMessage: null,
        });
        logger.info(
          `computeBatchScores: task ${p.taskId} scored -- ` +
          `raw=${p.rawScore}, safety=${result.safetyScore}, risk=${result.riskLevel}`,
        );
      } catch (innerErr) {
        logger.error(
          `computeBatchScores: score_mapper failed for task ${p.taskId}`,
          innerErr,
        );
        await p.task.update({
          rawScore: p.rawScore,
          riskLevel: null,
          samplesTotal: p.header.samplesTotal,
          samplesPassed: p.header.samplesCompleted,
          errorMessage: `score_mapper error: ${(innerErr as Error).message}`,
        });
      }
    }
    return;
  }

  // Phase 3: persist results
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const result = scoreResults[i];

    await p.task.update({
      rawScore: p.rawScore,
      safetyScore: result.safetyScore,
      score: result.safetyScore,
      riskLevel: result.riskLevel,
      interpretation: result.interpretation,
      samplesTotal: p.header.samplesTotal,
      samplesPassed: p.header.samplesCompleted,
      errorMessage: null,
    });

    logger.info(
      `computeBatchScores: task ${p.taskId} scored -- ` +
      `raw=${p.rawScore}, safety=${result.safetyScore}, risk=${result.riskLevel}`,
    );
  }
}

export default {
  computeTaskScore,
  computeBatchScores,
};
