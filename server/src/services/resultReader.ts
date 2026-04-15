/**
 * resultReader.ts
 *
 * Parse .eval ZIP files (produced by inspect_ai) to extract evaluation
 * metrics, status, and individual sample data.
 *
 * .eval file layout (ZIP archive):
 *   header.json                   - eval metadata, status, results/metrics
 *   _journal/start.json           - journal start (incomplete runs only have this)
 *   _journal/summaries/N.json     - incremental summaries
 *   summaries.json                - full sample summaries
 *   reductions.json               - reduction data
 *   samples/<id>_epoch_<n>.json   - individual sample results
 */

import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalHeader {
  status: string;
  evalId: string;
  model: string;
  dataset: string;
  metrics: Record<string, number>; // metric_name -> value
  samplesTotal: number;
  samplesCompleted: number;
}

export interface EvalSample {
  id: string;
  input: string;
  target?: string;
  output: string;
  score: number | null;
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Metric priority map — ported from Python result_reader._METRIC_PRIORITY
// ---------------------------------------------------------------------------

const METRIC_PRIORITY: Record<string, string[]> = {
  raccoon: ['leakage_rate'],
  overthink: ['reasoning_overhead', 'mean'],
  cyse2_interpreter_abuse: ['accuracy'],
  cyse2_prompt_injection: ['accuracy'],
  cyse2_vulnerability_exploit: ['accuracy'],
  privacylens_probing: ['accuracy'],
  privacylens_action: ['leakage_rate'],
  browse_comp: ['browse_comp_accuracy', 'accuracy'],
  personalized_safety: ['normalized_avg_score'],
  personalized_safety_context_free: ['normalized_avg_score'],
  personalized_safety_context_rich: ['normalized_avg_score'],
  strong_reject: ['strong_reject_metric'],
  truthfulqa: ['accuracy'],
  bbq: ['accuracy'],
  coconot: ['total', 'accuracy'],
  sycophancy: ['inspect_evals/truthfulness', 'truthfulness'],
  ifeval: ['final_acc', 'accuracy'],
  stereoset: ['stereotype_score'],
  simpleqa: ['correct'],
  agentharm: ['avg_refusals'],
  agentharm_benign: ['avg_score'],
  makemesay: ['win_rate'],
  bold: ['toxicity'],
  sec_qa: ['accuracy'],
  sec_qa_v1: ['accuracy'],
  sec_qa_v2: ['accuracy'],
  personality_BFI: ['Extraversion', 'Agreeableness', 'Conscientiousness'],
  personality_TRAIT: ['Openness', 'Conscientiousness'],
  iheval: ['mean'],
  iheval_rule_multi_aligned: ['mean'],
  chembench: ['all', 'accuracy'],
  clash_eval: ['adherence_rate'],
  healthbench: ['bootstrap_score', 'mean'],
  healthbench_hard: ['bootstrap_score', 'mean'],
  bfcl: ['accuracy'],
  wmdp_bio: ['accuracy'],
  wmdp_chem: ['accuracy'],
  wmdp_cyber: ['accuracy'],
  wmdp_local_bio: ['accuracy'],
  wmdp_local_chem: ['accuracy'],
  wmdp_local_cyber: ['accuracy'],
  lab_bench_seqqa: ['accuracy'],
  lab_bench_cloning_scenarios: ['accuracy'],
  fortress_adversarial: ['ARS__risk_domain__overall'],
  fortress_benign: ['ORS__risk_domain__overall'],
  make_me_pay: ['mean'],
  abstention_bench: ['f1'],
  mgsm: ['accuracy'],
  culturalbench_easy: ['accuracy'],
  culturalbench_hard: ['accuracy'],
  b3: ['accuracy', 'mean'],
  cve_bench: ['accuracy'],
  hallulens_task1_precise_wikiqa: ['accuracy'],
  sosbench: ['mean'],
  ahb: ['dimension_normalized_avg'],
  uccb: ['accuracy'],
  sciknoweval: ['accuracy', 'mean'],
  sevenllm_mcq_zh: ['accuracy'],
  sevenllm_mcq_en: ['accuracy'],
  sevenllm_qa_zh: ['rouge_l', 'mean'],
  sevenllm_qa_en: ['rouge_l', 'mean'],
  gdm_approved_directories: ['accuracy', 'mean'],
  gdm_calculator_improvement: ['accuracy', 'mean'],
  gdm_context_length_mod_instrumental_only: ['accuracy', 'mean'],
  gdm_context_length_mod_irreversibility_only: ['accuracy', 'mean'],
  gdm_database_tool: ['accuracy', 'mean'],
  gdm_latency_calculator: ['accuracy', 'mean'],
  gdm_max_messages_calculator: ['accuracy', 'mean'],
  gdm_max_tokens: ['accuracy', 'mean'],
  gdm_oversight_frequency: ['accuracy', 'mean'],
  gdm_read_logs: ['accuracy', 'mean'],
  gdm_turn_off_filters: ['accuracy', 'mean'],
  gdm_oversight_pattern: ['accuracy', 'mean'],
  gdm_classifier_evasion: ['accuracy', 'mean'],
  gdm_cover_your_tracks: ['accuracy', 'mean'],
  gdm_strategic_rule_breaking: ['accuracy', 'mean'],
  mind2web: ['accuracy'],
  mind2web_sc: ['accuracy'],
  assistant_bench_closed_book: ['assistant_bench_accuracy', 'accuracy'],
  assistant_bench_closed_book_zero_shot: ['assistant_bench_accuracy', 'accuracy'],
  assistant_bench_web_browser: ['assistant_bench_accuracy', 'accuracy'],
  gaia: ['accuracy'],
  mm_safety_bench_illegal_activity: ['attack_rate'],
  cyse3_visual_prompt_injection: ['accuracy'],
  mathvista: ['accuracy'],
  mmmu_multiple_choice: ['accuracy'],
  mmmu_open: ['accuracy'],
  mmiu: ['accuracy'],
  docvqa: ['accuracy'],
  mssbench_chat_if: ['accuracy'],
  mssbench_chat_qc: ['accuracy'],
  mssbench_chat_ic: ['accuracy'],
  mssbench_chat_ic_cap: ['accuracy'],
  mssbench_embodied_if: ['accuracy'],
  mssbench_embodied_qc: ['accuracy'],
  mssbench_embodied_ic: ['accuracy'],
  mssbench_embodied_ic_cap: ['accuracy'],
  xstest: ['refusal_rate'],
  cybench: ['accuracy'],
  threecb: ['accuracy'],
  safeagentbench: ['rejection_rate'],
  safeagentbench_react: ['rejection_rate'],
  safeagentbench_visual: ['rejection_rate'],
  agentdojo: ['accuracy'],
  osworld: ['accuracy'],
  osworld_small: ['accuracy'],
  psysafe: ['danger_rate', 'safety_rate'],
};

/** Fallback metric names tried when task-specific priority yields nothing. */
const FALLBACK_METRICS = ['accuracy', 'mean', 'leakage_rate', 'reasoning_overhead'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RawMetricEntry {
  name?: string;
  value?: number;
  params?: Record<string, any>;
}

/**
 * Extract the primary metric value from a merged metrics dict.
 *
 * Ported from Python `_extract_metric_value`. The logic is:
 * 1. Look for task-specific priority keys
 * 2. Fall back to generic metric names
 * 3. Last resort: take the first metric that has a `value` field
 *
 * Metric entries may be keyed by short name ("accuracy") or with a
 * namespace prefix ("inspect_evals/accuracy"). We check both.
 */
function extractMetricValue(
  metrics: Record<string, RawMetricEntry>,
  taskName: string,
): number | null {
  // 1. Task-specific priority
  const priority = METRIC_PRIORITY[taskName] ?? [];
  for (const key of priority) {
    const entry = metrics[key];
    if (entry && entry.value !== undefined) {
      return entry.value;
    }
    // Check namespace-prefixed keys (e.g. "eval_benchmarks/accuracy")
    for (const [mk, mv] of Object.entries(metrics)) {
      if (mk.endsWith('/' + key) && mv && typeof mv === 'object' && mv.value !== undefined) {
        return mv.value;
      }
    }
  }

  // 2. Fallback metrics
  for (const key of FALLBACK_METRICS) {
    const entry = metrics[key];
    if (entry && typeof entry === 'object' && entry.value !== undefined) {
      return entry.value;
    }
    for (const [mk, mv] of Object.entries(metrics)) {
      if (mk.endsWith('/' + key) && mv && typeof mv === 'object' && mv.value !== undefined) {
        return mv.value;
      }
    }
  }

  // 3. Last resort: first metric with a value
  for (const mv of Object.values(metrics)) {
    if (mv && typeof mv === 'object' && mv.value !== undefined) {
      return mv.value;
    }
  }

  return null;
}

/**
 * Flatten all scorers' metrics into a single dict.
 * Later scorers override earlier ones (same behaviour as Python code).
 */
function mergeScoreMetrics(
  scores: Array<{ metrics?: Record<string, RawMetricEntry> }>,
): Record<string, RawMetricEntry> {
  const merged: Record<string, RawMetricEntry> = {};
  for (const scorer of scores) {
    if (scorer.metrics) {
      Object.assign(merged, scorer.metrics);
    }
  }
  return merged;
}

/**
 * Safely read and parse a JSON entry from the ZIP.
 * Returns `null` when the entry is missing or the data is not valid JSON.
 */
function readZipJson(zip: AdmZip, entryName: string): any | null {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    return null;
  }
  try {
    const buf = entry.getData();
    return JSON.parse(buf.toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * Extract a readable text snippet from an inspect_ai message-list input.
 *
 * The `input` field in sample JSON is typically an array of message objects
 * with `role` and `content`. We concatenate user messages to form a
 * readable input string.
 */
function extractInputText(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (Array.isArray(input)) {
    const parts: string[] = [];
    for (const msg of input) {
      if (msg && typeof msg === 'object' && typeof msg.content === 'string') {
        parts.push(msg.content);
      }
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Extract the model output text from the inspect_ai output structure.
 *
 * The output is an object with a `choices` array. Each choice has a
 * `message` object with a `content` string.
 */
function extractOutputText(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  if (output && typeof output === 'object') {
    const obj = output as Record<string, any>;
    const choices = obj.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const msg = choices[0]?.message;
      if (msg && typeof msg.content === 'string') {
        return msg.content;
      }
    }
  }
  return '';
}

/**
 * Extract a numeric score from a sample's `scores` dict.
 *
 * Each scorer entry has a `value` which can be:
 * - a number directly
 * - a string grade (e.g. "C")
 * - an object (e.g. {score: 0.0, refusal: 0.0})
 *
 * We take the first numeric value we can find.
 */
function extractSampleScore(scores: unknown): number | null {
  if (!scores || typeof scores !== 'object') {
    return null;
  }
  for (const scorer of Object.values(scores as Record<string, any>)) {
    if (!scorer || typeof scorer !== 'object') {
      continue;
    }
    const val = scorer.value;
    if (typeof val === 'number') {
      return val;
    }
    if (typeof val === 'object' && val !== null) {
      // e.g. {score: 0.0, refusal: 0.0} — take the first numeric field
      for (const v of Object.values(val as Record<string, any>)) {
        if (typeof v === 'number') {
          return v;
        }
      }
    }
    // string values like "C" cannot be converted meaningfully
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the header of a .eval ZIP file to get evaluation metadata, status,
 * and aggregated metric values.
 *
 * Supports two .eval formats:
 * - Classic: contains `header.json` at top level
 * - Journal v2: contains `_journal/start.json`. If `header.json` is missing
 *   the run is incomplete and we throw.
 */
export async function readEvalHeader(filePath: string): Promise<EvalHeader> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Eval file not found: ${filePath}`);
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(filePath);
  } catch (err) {
    throw new Error(`Failed to open eval file as ZIP: ${filePath}`);
  }

  const entryNames = zip.getEntries().map((e) => e.entryName);

  // Determine which JSON to read for the header
  let data: any = null;
  if (entryNames.includes('header.json')) {
    data = readZipJson(zip, 'header.json');
  } else if (entryNames.includes('_journal/start.json')) {
    // Incomplete run — no final results
    throw new Error(`Eval file is incomplete (no header.json): ${filePath}`);
  }

  if (!data) {
    throw new Error(`No valid header found in eval file: ${filePath}`);
  }

  const evalMeta = data.eval ?? {};
  const results = data.results ?? {};
  const scores: Array<{ metrics?: Record<string, RawMetricEntry> }> = results.scores ?? [];

  // Merge all scorer metrics
  const merged = mergeScoreMetrics(scores);

  // Build flat metric map (name -> value)
  const metricsFlat: Record<string, number> = {};
  for (const [key, entry] of Object.entries(merged)) {
    if (entry && typeof entry === 'object' && entry.value !== undefined) {
      metricsFlat[key] = entry.value;
    }
  }

  // Extract task name for metric priority lookup
  const rawTask: string = evalMeta.task ?? '';
  const taskName = rawTask.split('/').pop() ?? rawTask;

  // Dataset info
  const dataset = evalMeta.dataset ?? {};
  const datasetName =
    typeof dataset === 'string'
      ? dataset
      : dataset.name ?? dataset.path ?? taskName;

  return {
    status: data.status ?? 'unknown',
    evalId: evalMeta.eval_id ?? evalMeta.run_id ?? '',
    model: (evalMeta.model ?? '').split('/').pop() ?? evalMeta.model ?? '',
    dataset: datasetName,
    metrics: metricsFlat,
    samplesTotal: results.total_samples ?? 0,
    samplesCompleted: results.completed_samples ?? 0,
  };
}

/**
 * Extract individual sample results from a .eval ZIP file.
 *
 * Samples live under `samples/` inside the ZIP. Each file is a JSON object
 * representing one sample (id, input, target, output, scores, metadata).
 *
 * Supports optional pagination via `offset` and `limit`.
 */
export async function readEvalSamples(
  filePath: string,
  offset: number = 0,
  limit: number = 50,
): Promise<{ samples: EvalSample[]; total: number }> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Eval file not found: ${filePath}`);
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(filePath);
  } catch (err) {
    throw new Error(`Failed to open eval file as ZIP: ${filePath}`);
  }

  // Collect sample entry names (sorted for deterministic pagination)
  const sampleEntries = zip
    .getEntries()
    .filter((e) => e.entryName.startsWith('samples/') && e.entryName.endsWith('.json'))
    .map((e) => e.entryName)
    .sort();

  const total = sampleEntries.length;

  // Apply pagination
  const sliced = sampleEntries.slice(offset, offset + limit);

  const samples: EvalSample[] = [];
  for (const entryName of sliced) {
    try {
      const raw = readZipJson(zip, entryName);
      if (!raw) continue;

      const sample: EvalSample = {
        id: raw.id ?? entryName,
        input: extractInputText(raw.input),
        target: raw.target != null ? String(raw.target) : undefined,
        output: extractOutputText(raw.output),
        score: extractSampleScore(raw.scores),
        metadata: raw.metadata ?? undefined,
      };
      samples.push(sample);
    } catch (err) {
      logger.warn(`Failed to parse sample entry ${entryName} in ${filePath}`);
    }
  }

  return { samples, total };
}

/**
 * Scan a results directory for .eval files, optionally filtering by
 * benchmark and/or task name.
 *
 * Directory structure (from inspect_ai):
 *   results/<model>/<benchmark>/logs/<timestamp>_<task>_<id>.eval
 *
 * Returns absolute paths of matching .eval files, sorted newest-first
 * by filename (which starts with a timestamp).
 */
export async function findEvalFiles(
  resultsDir: string,
  benchmark?: string,
  taskName?: string,
): Promise<string[]> {
  const files: string[] = [];

  if (!fs.existsSync(resultsDir)) {
    logger.warn(`Results directory does not exist: ${resultsDir}`);
    return files;
  }

  try {
    const modelDirs = fs.readdirSync(resultsDir, { withFileTypes: true });
    for (const modelDir of modelDirs) {
      if (!modelDir.isDirectory()) continue;
      const modelPath = path.join(resultsDir, modelDir.name);

      const benchDirs = fs.readdirSync(modelPath, { withFileTypes: true });
      for (const benchDir of benchDirs) {
        if (!benchDir.isDirectory()) continue;

        // Filter by benchmark if provided
        if (benchmark && benchDir.name !== benchmark) continue;

        const logsDir = path.join(modelPath, benchDir.name, 'logs');
        if (!fs.existsSync(logsDir)) continue;

        const logEntries = fs.readdirSync(logsDir, { withFileTypes: true });
        for (const logEntry of logEntries) {
          if (!logEntry.isFile() || !logEntry.name.endsWith('.eval')) continue;

          // Filter by taskName if provided (filename format: timestamp_taskname_id.eval)
          if (taskName) {
            // Normalise: the filename uses hyphens where task names use underscores
            const normalisedFile = logEntry.name.toLowerCase().replace(/-/g, '_');
            const normalisedTask = taskName.toLowerCase().replace(/-/g, '_');
            if (!normalisedFile.includes(normalisedTask)) continue;
          }

          files.push(path.join(logsDir, logEntry.name));
        }
      }
    }
  } catch (err) {
    logger.error('Error scanning results directory', err);
  }

  // Sort by filename descending (newest first, since filenames start with timestamp)
  files.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));

  return files;
}

/**
 * Extract the primary metric value from an EvalHeader.
 *
 * Uses the task-specific METRIC_PRIORITY map, then FALLBACK_METRICS,
 * then picks the first available metric. This mirrors the Python
 * `_extract_metric_value` logic but operates on the already-flat
 * `header.metrics` dict returned by `readEvalHeader`.
 */
export function extractPrimaryMetric(
  header: EvalHeader,
  taskName: string,
): number | null {
  // Rebuild the raw-style metrics dict that extractMetricValue expects
  const rawMetrics: Record<string, RawMetricEntry> = {};
  for (const [key, value] of Object.entries(header.metrics)) {
    rawMetrics[key] = { value };
  }
  return extractMetricValue(rawMetrics, taskName);
}
