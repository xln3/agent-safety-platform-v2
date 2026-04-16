/**
 * datasetService.ts
 *
 * Manages offline dataset caching for evaluation benchmarks.
 * Ensures all HuggingFace and GitHub datasets are pre-downloaded
 * so evaluations run without network access.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import { config } from '../config';
import logger from '../utils/logger';
import * as venvService from './venvService';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATASET_CACHE_DIR = path.join(config.evalPocRoot, 'datasets-cache');
const DATASETS_DIR = path.join(DATASET_CACHE_DIR, 'datasets');
const GITHUB_DIR = path.join(DATASET_CACHE_DIR, 'github');
const MANIFEST_PATH = path.join(DATASET_CACHE_DIR, '.manifest.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatasetSource = 'hf' | 'github' | 'local';

export interface DatasetSpec {
  benchmark: string;
  source: DatasetSource;
  hfRepo?: string;
  hfSplit?: string;
  url?: string;
  localPath?: string;
  requiresToken?: boolean;
}

export interface DatasetStatus {
  benchmark: string;
  ready: boolean;
  source: DatasetSource;
  cachedAt?: string;
  message: string;
}

interface Manifest {
  datasets: Record<string, { cachedAt: string; source: DatasetSource }>;
}

// ---------------------------------------------------------------------------
// Dataset registry — maps benchmarks to their data sources
//
// Only includes benchmarks that need external data downloads.
// Local benchmarks (clash_eval, raccoon, safeagentbench, open_agent_safety)
// already have data bundled in eval_benchmarks/*/data/.
// ---------------------------------------------------------------------------

const DATASET_REGISTRY: DatasetSpec[] = [
  // HuggingFace gated dataset
  {
    benchmark: 'xstest',
    source: 'hf',
    hfRepo: 'walledai/XSTest',
    hfSplit: 'test',
    requiresToken: true,
  },

  // GitHub direct downloads
  {
    benchmark: 'strong_reject',
    source: 'github',
    url: 'https://raw.githubusercontent.com/alexandrasouly/strongreject/3432b2d696b428f242bd507df96d80f686571d5e/strongreject_dataset/strongreject_dataset.csv',
  },
  {
    benchmark: 'privacylens',
    source: 'github',
    url: 'https://raw.githubusercontent.com/SALT-NLP/PrivacyLens/main/data/main_data.json',
  },
];

// ---------------------------------------------------------------------------
// Manifest management
// ---------------------------------------------------------------------------

function readManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { datasets: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return { datasets: {} };
  }
}

function writeManifest(manifest: Manifest): void {
  fs.mkdirSync(DATASET_CACHE_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);

    const doRequest = (requestUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      https.get(requestUrl, { timeout: 60_000 }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
    };

    doRequest(url);
  });
}

async function downloadHfDataset(spec: DatasetSpec): Promise<void> {
  if (!spec.hfRepo) return;

  // Use the benchmark's venv Python to call datasets.load_dataset
  // This ensures proper caching in HF cache format
  const pythonPath = venvService.getPythonPath(spec.benchmark);
  if (!fs.existsSync(pythonPath)) {
    throw new Error(`Venv not found for ${spec.benchmark}. Run setup first.`);
  }

  const cacheDir = DATASETS_DIR;
  fs.mkdirSync(cacheDir, { recursive: true });

  const script = [
    'from datasets import load_dataset',
    `load_dataset("${spec.hfRepo}"`,
    spec.hfSplit ? `, split="${spec.hfSplit}"` : '',
    `, cache_dir="${cacheDir}")`,
    'print("OK")',
  ].join('');

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  env.HF_DATASETS_CACHE = cacheDir;
  // Don't set offline mode during download
  delete env.HF_DATASETS_OFFLINE;
  delete env.HF_HUB_OFFLINE;

  await execFileAsync(pythonPath, ['-c', script], {
    timeout: 300_000,
    env,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check the offline cache status for all registered datasets.
 */
export function checkAllDatasetStatus(): DatasetStatus[] {
  const manifest = readManifest();

  return DATASET_REGISTRY.map((spec) => {
    const entry = manifest.datasets[spec.benchmark];
    if (entry) {
      return {
        benchmark: spec.benchmark,
        ready: true,
        source: spec.source,
        cachedAt: entry.cachedAt,
        message: `Cached at ${entry.cachedAt}`,
      };
    }
    return {
      benchmark: spec.benchmark,
      ready: false,
      source: spec.source,
      message: spec.requiresToken
        ? 'Not cached (requires HF_TOKEN)'
        : 'Not cached',
    };
  });
}

/**
 * Check if a specific benchmark's dataset is ready.
 */
export function checkDatasetReady(benchmark: string): boolean {
  // Local benchmarks are always ready
  const spec = DATASET_REGISTRY.find((s) => s.benchmark === benchmark);
  if (!spec) return true; // Not in registry = local data, always ready

  const manifest = readManifest();
  return !!manifest.datasets[benchmark];
}

/**
 * Prepare (download) a single benchmark's dataset.
 */
export async function prepareBenchmarkDataset(benchmark: string): Promise<void> {
  const spec = DATASET_REGISTRY.find((s) => s.benchmark === benchmark);
  if (!spec) {
    logger.info(`${benchmark}: no external dataset needed (local data)`);
    return;
  }

  logger.info(`Preparing dataset for ${benchmark} (source: ${spec.source})...`);

  if (spec.source === 'github' && spec.url) {
    const filename = path.basename(spec.url);
    const dest = path.join(GITHUB_DIR, benchmark, filename);
    await downloadFile(spec.url, dest);
    logger.info(`Downloaded: ${dest}`);
  } else if (spec.source === 'hf') {
    await downloadHfDataset(spec);
    logger.info(`HF dataset cached for ${benchmark}`);
  }

  // Update manifest
  const manifest = readManifest();
  manifest.datasets[benchmark] = {
    cachedAt: new Date().toISOString(),
    source: spec.source,
  };
  writeManifest(manifest);
}

/**
 * Prepare all registered datasets.
 */
export async function prepareAllDatasets(): Promise<{
  success: string[];
  failed: Array<{ benchmark: string; error: string }>;
}> {
  const success: string[] = [];
  const failed: Array<{ benchmark: string; error: string }> = [];

  for (const spec of DATASET_REGISTRY) {
    try {
      await prepareBenchmarkDataset(spec.benchmark);
      success.push(spec.benchmark);
    } catch (err: any) {
      logger.error(`Failed to prepare ${spec.benchmark}:`, err.message);
      failed.push({ benchmark: spec.benchmark, error: err.message });
    }
  }

  return { success, failed };
}

/**
 * Get environment variables for offline dataset mode.
 */
export function getDatasetCacheEnv(): Record<string, string> {
  return {
    HF_DATASETS_OFFLINE: '1',
    HF_HOME: DATASET_CACHE_DIR,
    HF_DATASETS_CACHE: DATASETS_DIR,
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_OFFLINE: '1',
    HF_UPDATE_DOWNLOAD_COUNTS: '0',
  };
}
