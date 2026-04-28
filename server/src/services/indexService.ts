/**
 * indexService.ts
 *
 * Manages YAML-based sample index files for include/exclude filtering.
 * Ported from run-eval.py lines 423-577.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { config } from '../config';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexData {
  mode: 'include' | 'exclude';
  sampleIds: string[];
}

/**
 * Per-file flag controlling whether `"<n>-<m>"` keys are expanded as numeric
 * ranges. Default is OFF — many real datasets (agentharm `1-1, 1-4`, ...) use
 * literal hyphen-composite IDs. Set `expand_ranges: true` in the YAML to opt
 * in for benchmarks where IDs really are numeric ranges.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEXES_DIR = path.join(config.evalPocRoot, 'benchmarks', 'indexes');

// ---------------------------------------------------------------------------
// Index path
// ---------------------------------------------------------------------------

export function getIndexPath(benchmarkName: string, taskName: string): string {
  return path.join(INDEXES_DIR, benchmarkName, `${taskName}.yaml`);
}

// ---------------------------------------------------------------------------
// Range expansion
// ---------------------------------------------------------------------------

/**
 * Expand range syntax in sample IDs.
 * "1-10" -> ["1", "2", ..., "10"]   (only when enabled=true)
 * "sample-*" -> preserved as-is (wildcard)
 *
 * Default `enabled=false`: hyphen-composite IDs are returned literally. This
 * is required for datasets like agentharm whose real sample IDs are strings
 * like "1-1", "1-4" — expanding them produced "00000000000000000001" zfilled
 * IDs that never matched the dataset (Bug found in job 52, 2026-04-28).
 */
export function expandSampleRanges(samples: string[], enabled = false): string[] {
  if (!enabled) {
    return [...samples];
  }
  const result: string[] = [];
  for (const s of samples) {
    if (s.includes('*') || s.includes('?')) {
      result.push(s);
      continue;
    }

    const match = s.match(/^(\d+)-(\d+)$/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start <= end && (end - start) < 10000) {
        for (let i = start; i <= end; i++) {
          result.push(String(i));
        }
      } else {
        result.push(s);
      }
    } else {
      result.push(s);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Index file loading
// ---------------------------------------------------------------------------

/**
 * Load an index file (supports old and new formats).
 *
 * Old format: samples is a list ["1", "2-5", ...]
 * New format: samples is a dict {"1": {sources, added}, ...}
 *
 * Returns null if file doesn't exist or is empty.
 */
export function loadIndexFile(indexPath: string): IndexData | null {
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  let data: any;
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    data = yaml.load(raw);
  } catch (err) {
    logger.warn(`Failed to parse index file ${indexPath}:`, err);
    return null;
  }

  if (!data) return null;

  const mode = (data.mode || 'include') as 'include' | 'exclude';
  const expandRanges = data.expand_ranges === true;
  const samplesData = data.samples;

  if (!samplesData) return null;

  let sampleIds: string[];

  if (typeof samplesData === 'object' && !Array.isArray(samplesData)) {
    sampleIds = expandSampleRanges(Object.keys(samplesData), expandRanges);
  } else if (Array.isArray(samplesData)) {
    sampleIds = expandSampleRanges(samplesData.map(String), expandRanges);
  } else {
    return null;
  }

  return { mode, sampleIds };
}

// ---------------------------------------------------------------------------
// Simple glob matching
// ---------------------------------------------------------------------------

/**
 * Simple glob match supporting * and ? wildcards.
 */
export function simpleGlobMatch(pattern: string, str: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
    .replace(/\*/g, '.*')                    // * -> .*
    .replace(/\?/g, '.');                    // ? -> .
  return new RegExp(`^${regexStr}$`).test(str);
}

/**
 * Check if a sample ID matches any of the given patterns.
 */
export function matchSampleId(sampleId: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.includes('*') || pattern.includes('?')) {
      if (simpleGlobMatch(pattern, sampleId)) return true;
    } else if (sampleId === pattern) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Convenience resolver
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  benchmarkName: string;
  taskName: string;
  noIndex?: boolean;
  indexFile?: string;
}

/**
 * Resolve index sample IDs for a benchmark/task combination.
 * Returns null if no index applies.
 */
export function resolveIndexSampleIds(options: ResolveOptions): IndexData | null {
  if (options.noIndex) return null;

  const idxPath = options.indexFile || getIndexPath(options.benchmarkName, options.taskName);
  const indexData = loadIndexFile(idxPath);

  if (indexData) {
    logger.debug(
      `Index file: ${idxPath}, mode=${indexData.mode}, ${indexData.sampleIds.length} samples`,
    );
  }

  return indexData;
}
