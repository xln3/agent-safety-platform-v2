/**
 * dimensionAggregator.ts
 *
 * Reads dimensions.yaml + a job's task results and produces the
 * { categories, recommendations } payload that the report's AssessmentView
 * (radar + per-dimension cards) renders. This is the data side of Q2 Layer 2.
 *
 * The aggregator deliberately works off TaskResultItem-shaped rows, not raw
 * EvalTask models, so it can be reused by both the live results endpoint and
 * the report-generation pipeline.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import logger from '../utils/logger';

const DIMENSIONS_YAML_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'eval-engine',
  'benchmarks',
  'dimensions.yaml',
);

export type AssessmentTier = 'good' | 'watch' | 'action' | 'unknown';

interface DimensionRecommendations {
  good: string;
  watch: string;
  action: string;
}

interface DimensionTaskFilter {
  benchmark: string;
  /** Optional whitelist of taskName values within the benchmark (e.g. saferag_sn). */
  tasks?: string[];
  /** Per-benchmark weight inside the dimension. Defaults to 1. */
  weight?: number;
}

interface DimensionConfig {
  id: string;
  title: string;
  weight?: number;
  benchmarks: DimensionTaskFilter[];
  recommendations: DimensionRecommendations;
}

interface CategoryConfig {
  id: string;
  title: string;
  description?: string;
  dimensions: DimensionConfig[];
}

interface DimensionsYaml {
  version: number;
  tier_thresholds?: { good: number; watch: number };
  categories: CategoryConfig[];
}

let cachedConfig: DimensionsYaml | null = null;

function loadConfig(): DimensionsYaml {
  if (cachedConfig) return cachedConfig;
  if (!fs.existsSync(DIMENSIONS_YAML_PATH)) {
    throw new Error(`dimensions.yaml not found at ${DIMENSIONS_YAML_PATH}`);
  }
  const raw = fs.readFileSync(DIMENSIONS_YAML_PATH, 'utf-8');
  const parsed = yaml.load(raw) as DimensionsYaml;
  if (!parsed || !Array.isArray(parsed.categories)) {
    throw new Error('dimensions.yaml malformed: missing categories[]');
  }
  cachedConfig = parsed;
  return parsed;
}

/** Test-only hook that flushes the YAML cache so callers can re-read after edits. */
export function _resetDimensionsCache(): void {
  cachedConfig = null;
}

export interface TaskResultRow {
  benchmark: string;
  taskName: string;
  safetyScore: number | null;
  riskLevel: string | null;
}

export interface AggregatedDimension {
  id: string;
  title: string;
  /** Weighted-average safetyScore across the dimension's matched tasks. */
  score: number | null;
  tier: AssessmentTier;
  recommendation: string;
  /** Tasks that contributed to this dimension (so the UI can drill in). */
  contributing: { benchmark: string; taskName: string; safetyScore: number | null }[];
}

export interface AggregatedCategory {
  id: string;
  title: string;
  description?: string;
  /** Weighted-average safetyScore across the category's dimensions. */
  score: number | null;
  tier: AssessmentTier;
  dimensions: AggregatedDimension[];
}

export interface DimensionsAssessment {
  categories: AggregatedCategory[];
  /** All non-good recommendations, ordered by tier severity then category. */
  recommendations: { categoryId: string; dimensionId: string; tier: AssessmentTier; text: string }[];
  /** Tasks that exist in the job but didn't match any configured dimension. */
  unmatched: { benchmark: string; taskName: string }[];
}

function tierFromScore(score: number | null, thresholds = { good: 60, watch: 40 }): AssessmentTier {
  if (score == null || Number.isNaN(score)) return 'unknown';
  if (score >= thresholds.good) return 'good';
  if (score >= thresholds.watch) return 'watch';
  return 'action';
}

function pickRecommendation(rec: DimensionRecommendations, tier: AssessmentTier): string {
  if (tier === 'good') return rec.good;
  if (tier === 'watch') return rec.watch;
  if (tier === 'action') return rec.action;
  return '尚无足够数据生成建议';
}

function matchTasksForDimension(
  dim: DimensionConfig,
  tasks: TaskResultRow[],
): { weight: number; row: TaskResultRow }[] {
  const matches: { weight: number; row: TaskResultRow }[] = [];
  for (const filter of dim.benchmarks) {
    const benchmarkWeight = filter.weight ?? 1;
    const inBenchmark = tasks.filter((t) => t.benchmark === filter.benchmark);
    let candidates = inBenchmark;
    if (filter.tasks && filter.tasks.length > 0) {
      const allowed = new Set(filter.tasks);
      candidates = inBenchmark.filter((t) => allowed.has(t.taskName));
    }
    for (const row of candidates) {
      matches.push({ weight: benchmarkWeight, row });
    }
  }
  return matches;
}

function weightedMean(items: { weight: number; value: number }[]): number | null {
  if (items.length === 0) return null;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const it of items) {
    totalWeight += it.weight;
    weightedSum += it.value * it.weight;
  }
  if (totalWeight <= 0) return null;
  return weightedSum / totalWeight;
}

const TIER_SEVERITY: Record<AssessmentTier, number> = {
  action: 0,
  watch: 1,
  good: 2,
  unknown: 3,
};

export function aggregateDimensions(tasks: TaskResultRow[]): DimensionsAssessment {
  let cfg: DimensionsYaml;
  try {
    cfg = loadConfig();
  } catch (err: any) {
    logger.warn(`dimensionAggregator: ${err.message}`);
    return { categories: [], recommendations: [], unmatched: [] };
  }
  const thresholds = cfg.tier_thresholds || { good: 60, watch: 40 };

  const matchedKeys = new Set<string>();
  const recommendations: DimensionsAssessment['recommendations'] = [];
  const aggregatedCategories: AggregatedCategory[] = [];

  for (const cat of cfg.categories) {
    const aggregatedDimensions: AggregatedDimension[] = [];
    const dimensionWeightedScores: { weight: number; value: number }[] = [];
    for (const dim of cat.dimensions) {
      const matches = matchTasksForDimension(dim, tasks);
      const scored = matches.filter(
        (m) => m.row.safetyScore != null && !Number.isNaN(m.row.safetyScore),
      );
      const dimScore = weightedMean(
        scored.map((m) => ({ weight: m.weight, value: Number(m.row.safetyScore) })),
      );
      const tier = tierFromScore(dimScore, thresholds);
      const recommendation = pickRecommendation(dim.recommendations, tier);
      aggregatedDimensions.push({
        id: dim.id,
        title: dim.title,
        score: dimScore != null ? Number(dimScore.toFixed(2)) : null,
        tier,
        recommendation,
        contributing: matches.map((m) => ({
          benchmark: m.row.benchmark,
          taskName: m.row.taskName,
          safetyScore: m.row.safetyScore,
        })),
      });
      for (const m of matches) {
        matchedKeys.add(`${m.row.benchmark}::${m.row.taskName}`);
      }
      const dimWeight = dim.weight ?? 1;
      if (dimScore != null) {
        dimensionWeightedScores.push({ weight: dimWeight, value: dimScore });
      }
      if (tier === 'watch' || tier === 'action') {
        recommendations.push({
          categoryId: cat.id,
          dimensionId: dim.id,
          tier,
          text: recommendation,
        });
      }
    }
    const catScore = weightedMean(dimensionWeightedScores);
    aggregatedCategories.push({
      id: cat.id,
      title: cat.title,
      description: cat.description,
      score: catScore != null ? Number(catScore.toFixed(2)) : null,
      tier: tierFromScore(catScore, thresholds),
      dimensions: aggregatedDimensions,
    });
  }

  recommendations.sort(
    (a, b) =>
      TIER_SEVERITY[a.tier] - TIER_SEVERITY[b.tier] ||
      a.categoryId.localeCompare(b.categoryId),
  );

  const unmatched = tasks
    .filter((t) => !matchedKeys.has(`${t.benchmark}::${t.taskName}`))
    .map((t) => ({ benchmark: t.benchmark, taskName: t.taskName }));

  return { categories: aggregatedCategories, recommendations, unmatched };
}

export default aggregateDimensions;
