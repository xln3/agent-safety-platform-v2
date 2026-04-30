/**
 * v1SampleShape — single source of truth for V1 sample serialization.
 *
 * Three places need the same `{ id, input, target, output, status, score?, error? }`
 * shape: GET /api/v1/evaluate/:taskId (tasks[].samples[]),
 * GET /api/v1/evaluate/:jobId/samples (flat list), and
 * GET /api/results/by-job/:jobId/tasks/:taskId/samples (legacy alias).
 *
 * Two upstream sources feed those endpoints:
 *   - EvalItem rows (DB, real-time, written per-sample by the bridge solver)
 *   - inspect_ai .json/.eval log files (batch, only after task completes)
 *
 * EvalItem is preferred whenever rows exist; the log file is the fallback for
 * very old jobs that ran before EvalItem persistence existed (or edge cases
 * where the bridge never fired).
 */

import EvalItem from '../models/EvalItem';
import type { EvalSample } from './resultReader';

export type V1SampleSource = 'eval_items' | 'log_file' | 'none';

export interface V1Sample {
  id: string;
  input: string;
  target: unknown;
  output: string;
  status: string;
  score?: number;
  error?: string;
}

/** Flat shape used by GET /api/v1/evaluate/{jobId}/samples. */
export interface V1RawSample {
  benchmark: string;
  taskName: string;
  sampleId: string;
  input: string;
  target: unknown;
  output: string;
  status: string;
  score?: number;
  error?: string;
}

/** Wrap a V1Sample with benchmark/taskName context for the flat /samples list. */
export function toV1RawSample(
  sample: V1Sample,
  ctx: { benchmark: string; taskName: string },
): V1RawSample {
  const { id, ...rest } = sample;
  return {
    benchmark: ctx.benchmark,
    taskName: ctx.taskName,
    sampleId: id,
    ...rest,
  };
}

/** Convert one EvalItem row to V1Sample. status reflects live row state. */
export function evalItemToV1Sample(item: EvalItem): V1Sample {
  const inputJson: any = (item.inputJson as any) ?? {};
  const inputText =
    typeof inputJson.input === 'string'
      ? inputJson.input
      : Array.isArray(inputJson.messages)
        ? inputJson.messages
            .filter(
              (m: any) =>
                m && typeof m === 'object' && typeof m.content === 'string',
            )
            .map((m: any) => m.content)
            .join('\n')
        : '';
  return {
    id: item.sampleId,
    input: inputText,
    target: inputJson.target ?? null,
    output: item.outputText ?? '',
    status: item.status,
    ...(item.score !== null && item.score !== undefined ? { score: item.score } : {}),
    ...(item.errorMessage ? { error: item.errorMessage } : {}),
  };
}

/**
 * Convert one inspect_ai log-file sample to V1Sample.
 *
 * Log-file samples have no live status — they're written at task completion,
 * so a present sample is by definition completed. We map `error` presence to
 * `failed`, otherwise `success`.
 */
export function logSampleToV1Sample(s: EvalSample): V1Sample {
  return {
    id: s.id,
    input: s.input,
    target: s.target ?? null,
    output: s.output,
    status: s.error ? 'failed' : 'success',
    ...(s.score !== null && s.score !== undefined ? { score: s.score } : {}),
    ...(s.error ? { error: s.error } : {}),
  };
}

/**
 * Allocate a total sample count across N tasks with strict Σ = totalCount.
 *
 * Pre-condition: totalCount >= numTasks. Caller MUST validate and reject with
 * a 400 before calling — the platform's coverage rule says every resolved task
 * gets ≥1 sample (gaps in category coverage are a config error, not an
 * acceptable runtime outcome). With that pre-condition met, base = floor(t/n)
 * is at least 1, the first `remainder` tasks get base+1, the rest get base,
 * and Σ = totalCount exactly.
 */
export function allocateSamples(totalCount: number, numTasks: number): number[] {
  if (numTasks <= 0) return [];
  if (totalCount < numTasks) {
    throw new Error(
      `allocateSamples requires totalCount(${totalCount}) >= numTasks(${numTasks}); ` +
        `caller must validate and reject before invoking.`,
    );
  }
  const base = Math.floor(totalCount / numTasks);
  const remainder = totalCount % numTasks;
  return Array.from({ length: numTasks }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
}
