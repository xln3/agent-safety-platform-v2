/**
 * preflightService.ts
 *
 * Pre-flight checks before running evaluations.
 * Ported from benchmarks/preflight.py.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import os from 'os';
import { config } from '../config';
import logger from '../utils/logger';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum DependencyType {
  JUDGE_MODEL = 'judge_model',
  HF_NETWORK = 'hf_network',
  HF_AUTH = 'hf_auth',
  HF_GATED = 'hf_gated',
  DOCKER = 'docker',
  K8S = 'k8s',
  DATASET_DOWNLOAD = 'dataset_download',
}

export interface ActionItem {
  title: string;
  command?: string;
  url?: string;
  description?: string;
}

export interface BenchmarkRequirement {
  benchmark: string;
  tasks: string[];
  dependency: DependencyType;
  description: string;
  action?: ActionItem;
  optional?: boolean;
}

export interface PreflightResult {
  passed: boolean;
  dependency: DependencyType;
  benchmark: string;
  message: string;
  action?: ActionItem;
}

// ---------------------------------------------------------------------------
// Requirements registry
// ---------------------------------------------------------------------------

const BENCHMARK_REQUIREMENTS: BenchmarkRequirement[] = [
  {
    benchmark: 'cyberseceval_2',
    tasks: ['cyse2_interpreter_abuse', 'cyse2_prompt_injection', 'cyse2_vulnerability_exploit'],
    dependency: DependencyType.JUDGE_MODEL,
    description: 'CyberSecEval 2 requires a Judge Model for LLM-as-a-judge scoring',
    action: {
      title: 'Configure Judge Model',
      description: 'Set via catalog.yaml judge_model or --judge-model flag',
    },
  },
  {
    benchmark: 'xstest',
    tasks: ['xstest'],
    dependency: DependencyType.HF_GATED,
    description: 'xstest uses gated dataset walledai/XSTest, requires HF token + access approval',
    action: {
      title: 'Apply for HuggingFace dataset access',
      url: 'https://huggingface.co/datasets/walledai/XSTest',
      description: '1. Visit the link and click "Access repository"\n2. Set HF_TOKEN env var',
    },
  },
  {
    benchmark: 'strong_reject',
    tasks: ['strong_reject'],
    dependency: DependencyType.DATASET_DOWNLOAD,
    description: 'strong_reject needs dataset from GitHub',
    action: {
      title: 'Download strong_reject dataset',
      url: 'https://raw.githubusercontent.com/alexandrasouly/strongreject/3432b2d696b428f242bd507df96d80f686571d5e/strongreject_dataset/strongreject_dataset.csv',
    },
  },
  {
    benchmark: 'cyberseceval_2',
    tasks: ['cyse2_vulnerability_exploit'],
    dependency: DependencyType.DOCKER,
    description: 'cyse2_vulnerability_exploit requires Docker for sandboxed vulnerability testing',
    action: { title: 'Start Docker service', command: 'sudo systemctl start docker' },
  },
  {
    benchmark: 'cve_bench',
    tasks: ['cve_bench'],
    dependency: DependencyType.DOCKER,
    description: 'cve_bench requires Docker for CVE vulnerability environments',
    action: { title: 'Start Docker service', command: 'sudo systemctl start docker' },
  },
  {
    benchmark: 'privacylens',
    tasks: ['privacylens_probing', 'privacylens_action'],
    dependency: DependencyType.DATASET_DOWNLOAD,
    description: 'privacylens needs PrivacyLens dataset',
    action: {
      title: 'Download PrivacyLens dataset',
      url: 'https://github.com/SALT-NLP/PrivacyLens',
    },
  },
  {
    benchmark: 'privacylens',
    tasks: ['privacylens_action'],
    dependency: DependencyType.JUDGE_MODEL,
    description: 'privacylens_action requires Judge Model for leakage assessment',
    action: { title: 'Configure Judge Model' },
  },
];

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

export async function checkDocker(): Promise<{ passed: boolean; message: string }> {
  try {
    await execFileAsync('docker', ['info'], { timeout: 10_000 });
    return { passed: true, message: 'Docker is ready' };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { passed: false, message: 'Docker not installed' };
    }
    return { passed: false, message: 'Docker service not running' };
  }
}

export function checkHfToken(): { passed: boolean; message: string } {
  const token = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;
  if (!token) {
    return { passed: false, message: 'HF_TOKEN environment variable not set' };
  }
  return { passed: true, message: 'HuggingFace Token configured' };
}

export function checkHfNetwork(): Promise<{ passed: boolean; message: string }> {
  return new Promise((resolve) => {
    const req = https.get('https://huggingface.co/api/health', {
      timeout: 10_000,
      headers: { 'User-Agent': 'preflight-check' },
    }, (res) => {
      resolve(
        res.statusCode === 200
          ? { passed: true, message: 'HuggingFace network access OK' }
          : { passed: false, message: 'HuggingFace returned non-200' },
      );
    });
    req.on('error', () => resolve({ passed: false, message: 'Cannot reach HuggingFace' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ passed: false, message: 'HuggingFace connection timeout' });
    });
  });
}

export function checkDatasetCached(cachePath: string): { passed: boolean; message: string } {
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    if (stat.size > 0) {
      return { passed: true, message: `Dataset cached: ${cachePath}` };
    }
  }
  return { passed: false, message: `Dataset not found: ${cachePath}` };
}

export function checkJudgeModel(modelName?: string): { passed: boolean; message: string } {
  if (modelName) {
    return { passed: true, message: `Judge Model: ${modelName}` };
  }
  return { passed: false, message: 'Judge Model not configured' };
}

// ---------------------------------------------------------------------------
// Main preflight runner
// ---------------------------------------------------------------------------

export async function runPreflightChecks(
  benchmarks: string[],
  judgeModelName?: string,
): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];
  const checked = new Set<string>();

  for (const benchmark of benchmarks) {
    for (const req of BENCHMARK_REQUIREMENTS) {
      if (req.benchmark !== benchmark) continue;

      const key = `${req.benchmark}:${req.dependency}`;
      if (checked.has(key)) continue;
      checked.add(key);

      let passed = false;
      let message = '';

      switch (req.dependency) {
        case DependencyType.DOCKER: {
          const r = await checkDocker();
          passed = r.passed;
          message = r.message;
          break;
        }
        case DependencyType.HF_AUTH: {
          const r = checkHfToken();
          passed = r.passed;
          message = r.message;
          break;
        }
        case DependencyType.HF_GATED: {
          const r = checkHfToken();
          passed = r.passed;
          message = r.message;
          break;
        }
        case DependencyType.HF_NETWORK: {
          const r = await checkHfNetwork();
          passed = r.passed;
          message = r.message;
          break;
        }
        case DependencyType.JUDGE_MODEL: {
          const r = checkJudgeModel(judgeModelName);
          passed = r.passed;
          message = r.message;
          break;
        }
        case DependencyType.DATASET_DOWNLOAD: {
          if (benchmark === 'strong_reject') {
            const cacheDir = path.join(os.homedir(), '.cache', 'inspect_evals', 'strong_reject');
            const r = checkDatasetCached(path.join(cacheDir, 'strongreject_dataset.csv'));
            passed = r.passed;
            message = r.message;
          } else if (benchmark === 'privacylens') {
            const dataPath = path.join(
              config.evalPocRoot, 'benchmarks', 'eval_benchmarks',
              'privacylens', 'data', 'main_data.json',
            );
            const r = checkDatasetCached(dataPath);
            passed = r.passed;
            message = r.message;
          }
          break;
        }
      }

      results.push({
        passed,
        dependency: req.dependency,
        benchmark,
        message,
        action: passed ? undefined : req.action,
      });
    }
  }

  return results;
}

/**
 * Get required user permissions for the given benchmarks.
 */
export function getRequiredPermissions(benchmarks: string[]): string[] {
  const permissions: string[] = [];
  if (benchmarks.includes('cve_bench')) {
    permissions.push('cve_bench: Will run real CVE vulnerability apps in Docker containers (isolated)');
  }
  if (benchmarks.includes('cyberseceval_2')) {
    permissions.push('cyse2_vulnerability_exploit: Will compile and execute test code in Docker (isolated)');
  }
  return permissions;
}
