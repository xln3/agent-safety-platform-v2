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
import http from 'http';
import type { IncomingMessage } from 'http';
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

export type DatasetSource = 'hf' | 'github' | 'http' | 'local' | 'inspect_cache';

export interface DatasetSpec {
  benchmark: string;
  source: DatasetSource;
  /** HuggingFace repo id, e.g. "gorilla-llm/Berkeley-Function-Calling-Leaderboard" */
  hfRepo?: string;
  /** Single split (kept for backward compat with xstest entry) */
  hfSplit?: string;
  /** Multiple splits (e.g. agentharm val + test_public) */
  hfSplits?: string[];
  /** Pin HF dataset to a specific revision (commit sha / tag) */
  hfRevision?: string;
  /** Direct URL for github/http sources */
  url?: string;
  localPath?: string;
  /** Gated or token-required dataset; skipped with warning if HF_TOKEN absent */
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
  // ---- Pre-existing entries ---------------------------------------------
  {
    benchmark: 'xstest',
    source: 'hf',
    hfRepo: 'walledai/XSTest',
    hfSplit: 'test',
    requiresToken: true,
  },
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

  // ---- Priority category: tool_calling ----------------------------------
  {
    benchmark: 'bfcl',
    source: 'inspect_cache',
    // inspect_evals/bfcl downloads from GitHub via sparse-checkout, NOT from HF datasets.
    // Cache location: ~/.cache/inspect_evals/BFCL/
    // We trigger the download by running inspect_evals' own download logic in the bfcl venv.
  },
  {
    benchmark: 'b3',
    source: 'hf',
    hfRepo: 'Lakera/b3-agent-security-benchmark-weak',
    hfSplit: 'test',
  },
  {
    benchmark: 'agentharm',
    source: 'hf',
    hfRepo: 'ai-safety-institute/AgentHarm',
    hfSplits: ['val', 'test_public'],
  },
  // agentdojo: uses inspect_evals bundled data, no download needed
  // open_agent_safety: local (bundled under eval_benchmarks/open_agent_safety/data)

  // ---- Priority category: rag_safety ------------------------------------
  // saferag + clash_eval: local (data bundled under eval_benchmarks/*/data)

  // ---- Priority category: task_planning ---------------------------------
  {
    benchmark: 'gaia',
    source: 'hf',
    hfRepo: 'gaia-benchmark/GAIA',
    hfSplit: 'validation',
    requiresToken: true,
  },
  {
    benchmark: 'mind2web',
    source: 'hf',
    hfRepo: 'osunlp/Multimodal-Mind2Web',
  },
  {
    benchmark: 'mind2web_scores',
    source: 'http',
    url: 'https://huggingface.co/datasets/osunlp/Mind2Web/resolve/main/scores_all_data.pkl',
  },
  {
    benchmark: 'assistant_bench',
    source: 'hf',
    hfRepo: 'AssistantBench/AssistantBench',
  },
  // mind2web_sc: bundled in inspect_evals package
  // safeagentbench: local (data bundled)

  // ---- Priority category: business_safety -------------------------------
  {
    benchmark: 'truthfulqa',
    source: 'hf',
    hfRepo: 'truthfulqa/truthful_qa',
    hfSplit: 'validation',
  },
  {
    benchmark: 'gdpval',
    source: 'hf',
    hfRepo: 'openai/gdpval',
  },
  {
    benchmark: 'healthbench',
    source: 'http',
    url: 'https://openaipublic.blob.core.windows.net/simple-evals/healthbench/2025-05-07-06-14-12_oss_eval.jsonl',
  },
  // raccoon: local (data bundled)

  // ---- 1. 模型安全性 -------------------------------------------------------
  // strong_reject: already registered above
  {
    benchmark: 'makemesay',
    source: 'inspect_cache',
    // Uses ~/.cache/inspect_evals/make_me_say/
  },
  // xstest: already registered above
  {
    benchmark: 'coconot',
    source: 'hf',
    hfRepo: 'allenai/coconot',
  },
  {
    benchmark: 'fortress',
    source: 'hf',
    hfRepo: 'ScaleAI/fortress_public',
    hfSplit: 'test',
  },
  {
    benchmark: 'ifeval',
    source: 'hf',
    hfRepo: 'google/IFEval',
    hfSplit: 'train',
  },

  // ---- 2. 模型事实性 -------------------------------------------------------
  {
    benchmark: 'simpleqa',
    source: 'inspect_cache',
    // Uses ~/.cache/inspect_evals/simpleqa/
  },
  {
    benchmark: 'sciknoweval',
    source: 'hf',
    hfRepo: 'hicai-zju/SciKnowEval',
  },
  {
    benchmark: 'mask',
    source: 'hf',
    hfRepo: 'cais/MASK',
  },
  {
    benchmark: 'abstention_bench',
    source: 'inspect_cache',
    // Uses ~/.cache/inspect_evals/abstention_bench/
  },

  // ---- 3. 公平性 -----------------------------------------------------------
  {
    benchmark: 'bbq',
    source: 'hf',
    hfRepo: 'heegyu/bbq',
    hfSplit: 'test',
  },
  {
    benchmark: 'bold',
    source: 'hf',
    hfRepo: 'AmazonScience/bold',
  },
  {
    benchmark: 'ahb',
    source: 'hf',
    hfRepo: 'sentientfutures/ahb',
  },
  {
    benchmark: 'stereoset',
    source: 'hf',
    hfRepo: 'McGill-NLP/stereoset',
    hfSplit: 'validation',
  },
  {
    benchmark: 'culturalbench',
    source: 'hf',
    hfRepo: 'kellycyy/CulturalBench',
  },
  {
    benchmark: 'uccb',
    source: 'hf',
    hfRepo: 'CraneAILabs/UCCB',
  },
  {
    benchmark: 'mgsm',
    source: 'inspect_cache',
    // Uses ~/.cache/inspect_evals/mgsm/
  },

  // ---- 4. 隐私 -------------------------------------------------------------
  // privacylens: already registered above

  // ---- 5. 前沿安全 ---------------------------------------------------------
  {
    benchmark: 'wmdp',
    source: 'hf',
    hfRepo: 'cais/wmdp',
  },
  {
    benchmark: 'sevenllm',
    source: 'inspect_cache',
    // Uses ~/.cache/inspect_evals/sevenllm/
  },
  {
    benchmark: 'sec_qa',
    source: 'hf',
    hfRepo: 'zefang-liu/secqa',
  },
  {
    benchmark: 'sosbench',
    source: 'hf',
    hfRepo: 'SOSBench/SOSBench',
  },
  {
    benchmark: 'lab_bench',
    source: 'hf',
    hfRepo: 'futurehouse/lab-bench',
  },
  {
    benchmark: 'chembench',
    source: 'hf',
    hfRepo: 'jablonkagroup/ChemBench',
  },

  // ---- 6-7. 工具调用 + RAG: 已注册上方 ------------------------------------

  // ---- 8. 多模态 -----------------------------------------------------------
  {
    benchmark: 'mm_safety_bench',
    source: 'inspect_cache',
    // Uses ~/.cache/inspect_evals/mm_safety_bench/
  },
  {
    benchmark: 'cyberseceval_3',
    source: 'hf',
    hfRepo: 'facebook/cyberseceval3-visual-prompt-injection',
  },
  {
    benchmark: 'mathvista',
    source: 'hf',
    hfRepo: 'AI4Math/MathVista',
  },
  {
    benchmark: 'mmmu',
    source: 'hf',
    hfRepo: 'MMMU/MMMU',
  },
  {
    benchmark: 'mmiu',
    source: 'hf',
    hfRepo: 'FanqingM/MMIU-Benchmark',
  },
  {
    benchmark: 'docvqa',
    source: 'hf',
    hfRepo: 'lmms-lab/DocVQA',
  },
  {
    benchmark: 'mssbench',
    source: 'hf',
    hfRepo: 'kzhou35/mssbench',
  },

  // ---- 9-15. 其他类别 -------------------------------------------------------
  {
    benchmark: 'personalized_safety',
    source: 'hf',
    hfRepo: 'wick1d/Personalized_Safety_Data',
  },
  {
    benchmark: 'sycophancy',
    source: 'inspect_cache',
    // Uses ~/.cache/inspect_evals/sycophancy/
  },
  {
    benchmark: 'personality',
    source: 'hf',
    hfRepo: 'mirlab/TRAIT',
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
// Disk-presence helpers (fallback when manifest is missing / incomplete)
// ---------------------------------------------------------------------------

/** Return true if dirPath is a directory containing at least one file (max 3 levels deep). */
function dirHasFiles(dirPath: string): boolean {
  try {
    if (!fs.statSync(dirPath).isDirectory()) return false;
  } catch { return false; }

  function scan(dir: string, depth: number): boolean {
    if (depth > 3) return false;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile()) return true;
        if (entry.isDirectory() && scan(path.join(dir, entry.name), depth + 1)) return true;
      }
    } catch { /* permission errors etc */ }
    return false;
  }
  return scan(dirPath, 0);
}

/**
 * Check whether a dataset's files exist on disk, independent of the manifest.
 * Used as a fallback when the manifest has no entry for a benchmark.
 */
function checkDiskForDataset(spec: DatasetSpec): boolean {
  switch (spec.source) {
    case 'hf': {
      if (!spec.hfRepo || !fs.existsSync(DATASETS_DIR)) return false;
      const [org, name] = spec.hfRepo.split('/');
      const prefix = org.toLowerCase() + '___';
      const nameNorm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      try {
        return fs.readdirSync(DATASETS_DIR).some((entry) => {
          const entryLower = entry.toLowerCase();
          if (!entryLower.startsWith(prefix)) return false;
          const entryNamePart = entryLower.slice(prefix.length).replace(/[^a-z0-9]/g, '');
          if (entryNamePart !== nameNorm) return false;
          return dirHasFiles(path.join(DATASETS_DIR, entry));
        });
      } catch { return false; }
    }
    case 'github':
    case 'http': {
      if (!spec.url) return false;
      const filename = path.basename(spec.url.split('?')[0]);
      const dest = path.join(GITHUB_DIR, spec.benchmark, filename);
      try { return fs.statSync(dest).isFile(); } catch { return false; }
    }
    case 'inspect_cache': {
      const inspectDir = path.join(DATASET_CACHE_DIR, 'inspect_evals', 'BFCL');
      return dirHasFiles(inspectDir);
    }
    case 'local':
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

/**
 * Download a single URL to disk with redirect + retry/backoff.
 * Remote targets like Azure Blob occasionally return 5xx or disconnect mid-stream;
 * caller gets up to `maxAttempts` retries with exponential backoff.
 */
function downloadFile(url: string, dest: string, maxAttempts = 3): Promise<void> {
  const attempt = (n: number): Promise<void> =>
    new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const file = fs.createWriteStream(dest);

      const cleanupAndReject = (err: Error) => {
        try { file.close(); } catch { /* ignore */ }
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch { /* ignore */ }
        reject(err);
      };

      const doRequest = (requestUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          cleanupAndReject(new Error('Too many redirects'));
          return;
        }

        const lib = requestUrl.startsWith('http://') ? http : https;
        lib.get(requestUrl, { timeout: 120_000 }, (res: IncomingMessage) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doRequest(res.headers.location, redirectCount + 1);
            return;
          }
          if (res.statusCode !== 200) {
            cleanupAndReject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
          file.on('error', cleanupAndReject);
        }).on('error', cleanupAndReject);
      };

      doRequest(url);
    });

  return (async () => {
    let lastErr: Error | null = null;
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        await attempt(i);
        return;
      } catch (err: any) {
        lastErr = err;
        if (i < maxAttempts) {
          const backoff = Math.min(1000 * Math.pow(2, i - 1), 8000);
          logger.warn(`downloadFile ${url} attempt ${i}/${maxAttempts} failed (${err.message}); retrying in ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }
    throw lastErr ?? new Error(`downloadFile exhausted ${maxAttempts} attempts`);
  })();
}

/**
 * Find any benchmark venv that can host HF `datasets` calls.
 * Prefers the spec's own venv; falls back to any available benchmark venv
 * so dataset prep can run before/after individual venvs are set up.
 */
function resolveHostPython(benchmark: string): string {
  const own = venvService.getPythonPath(benchmark);
  if (fs.existsSync(own)) return own;

  const venvsRoot = path.join(config.evalPocRoot, '.venvs');
  if (fs.existsSync(venvsRoot)) {
    for (const name of fs.readdirSync(venvsRoot)) {
      const candidate = path.join(venvsRoot, name, 'bin', 'python');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(
    `No Python venv found for ${benchmark} (expected ${own}). ` +
    `Run 'npm run setup:venvs' (at least for one benchmark) before preparing datasets.`,
  );
}

async function downloadHfDataset(spec: DatasetSpec): Promise<void> {
  if (!spec.hfRepo) return;

  const pythonPath = resolveHostPython(spec.benchmark);
  const cacheDir = DATASETS_DIR;
  fs.mkdirSync(cacheDir, { recursive: true });

  // Gracefully skip gated datasets when no token is available
  if (spec.requiresToken && !process.env.HF_TOKEN) {
    throw new Error(
      `${spec.benchmark}: requires HF_TOKEN for gated HF repo '${spec.hfRepo}'. ` +
      `Obtain access at https://huggingface.co/${spec.hfRepo} and export HF_TOKEN before retrying.`,
    );
  }

  const splits = spec.hfSplits && spec.hfSplits.length > 0
    ? spec.hfSplits
    : (spec.hfSplit ? [spec.hfSplit] : [null]);

  const revisionArg = spec.hfRevision ? `, revision=${JSON.stringify(spec.hfRevision)}` : '';
  const tokenArg = spec.requiresToken ? ', token=True' : '';

  const pyLines = [
    'import os, sys',
    'from datasets import load_dataset',
    `repo = ${JSON.stringify(spec.hfRepo)}`,
    `cache = ${JSON.stringify(cacheDir)}`,
    ...splits.map((s) => {
      const splitArg = s ? `, split=${JSON.stringify(s)}` : '';
      return `load_dataset(repo${splitArg}, cache_dir=cache${revisionArg}${tokenArg})`;
    }),
    'print("OK")',
  ];

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  env.HF_DATASETS_CACHE = cacheDir;
  env.HF_HOME = DATASET_CACHE_DIR;
  // Strip offline flags so download can actually hit the network
  delete env.HF_DATASETS_OFFLINE;
  delete env.HF_HUB_OFFLINE;
  delete env.TRANSFORMERS_OFFLINE;

  await execFileAsync(pythonPath, ['-c', pyLines.join('\n')], {
    timeout: 600_000,
    env,
    maxBuffer: 32 * 1024 * 1024,
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
  let manifestDirty = false;

  const statuses = DATASET_REGISTRY.map((spec) => {
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

    // Manifest miss — check disk as fallback
    const onDisk = checkDiskForDataset(spec);
    if (onDisk) {
      const now = new Date().toISOString();
      manifest.datasets[spec.benchmark] = { cachedAt: now, source: spec.source };
      manifestDirty = true;
      return {
        benchmark: spec.benchmark,
        ready: true,
        source: spec.source,
        cachedAt: now,
        message: `Found on disk (manifest repaired)`,
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

  if (manifestDirty) {
    try { writeManifest(manifest); } catch (err) {
      logger.warn('Failed to auto-repair dataset manifest:', err);
    }
  }

  return statuses;
}

/**
 * Check if a specific benchmark's dataset is ready.
 */
export function checkDatasetReady(benchmark: string): boolean {
  const spec = DATASET_REGISTRY.find((s) => s.benchmark === benchmark);
  if (!spec) return true; // Not in registry = local data, always ready

  const manifest = readManifest();
  if (manifest.datasets[benchmark]) return true;

  // Manifest miss — check disk as fallback
  return checkDiskForDataset(spec);
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

  if ((spec.source === 'github' || spec.source === 'http') && spec.url) {
    const filename = path.basename(spec.url.split('?')[0]);
    const dest = path.join(GITHUB_DIR, benchmark, filename);
    await downloadFile(spec.url, dest);
    logger.info(`Downloaded: ${dest}`);
  } else if (spec.source === 'hf') {
    await downloadHfDataset(spec);
    logger.info(`HF dataset cached for ${benchmark}`);
  } else if (spec.source === 'inspect_cache') {
    // Self-contained: copy bundled BFCL data (300 curated records) to the
    // inspect_evals cache location so inspect eval runs fully offline.
    // If a cache already exists (full or bundled), leave it untouched —
    // the full dataset is a valid superset and --sample-id handles filtering.
    const pythonPath = resolveHostPython(benchmark);
    const bundledDir = path.join(config.evalPocRoot, 'benchmarks', 'data', 'bfcl');
    const pyScript = [
      'import os, shutil, sys',
      'from inspect_evals.constants import INSPECT_EVALS_CACHE_PATH',
      'cache_dir = str(INSPECT_EVALS_CACHE_PATH / "BFCL")',
      'bundled = sys.argv[1]',
      'if os.path.exists(cache_dir):',
      '    print(f"BFCL cache already present at {cache_dir}, keeping as-is")',
      'else:',
      '    shutil.copytree(bundled, cache_dir)',
      '    print(f"Copied bundled BFCL data to {cache_dir}")',
    ].join('\n');
    await execFileAsync(pythonPath, ['-c', pyScript, bundledDir], {
      timeout: 60_000,
    });
    logger.info(`inspect_cache dataset ready for ${benchmark}`);
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
