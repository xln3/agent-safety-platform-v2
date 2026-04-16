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
 * "1-10" -> ["1", "2", ..., "10"]
 * "sample-*" -> preserved as-is (wildcard)
 */
export function expandSampleRanges(samples: string[]): string[] {
  const result: string[] = [];
  for (const s of samples) {
    // Skip wildcards
    if (s.includes('*') || s.includes('?')) {
      result.push(s);
      continue;
    }

    // Parse range syntax: "1-10"
    const match = s.match(/^(\d+)-(\d+)$/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      for (let i = start; i <= end; i++) {
        result.push(String(i));
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
  const samplesData = data.samples;

  if (!samplesData) return null;

  let sampleIds: string[];

  if (typeof samplesData === 'object' && !Array.isArray(samplesData)) {
    // New format: dict {id: {sources, added}}
    sampleIds = expandSampleRanges(Object.keys(samplesData));
  } else if (Array.isArray(samplesData)) {
    // Old format: list ["1", "2-5", ...]
    sampleIds = expandSampleRanges(samplesData.map(String));
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
