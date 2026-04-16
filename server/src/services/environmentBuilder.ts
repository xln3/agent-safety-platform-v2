/**
 * environmentBuilder.ts
 *
 * Constructs the environment variables for `inspect eval` subprocess.
 * Ported from run-eval.py lines 662-746.
 */

import path from 'path';
import { config } from '../config';
import { sanitizeModelName, normalizeModelName } from './commandBuilder';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvBuildOptions {
  benchmarkName: string;
  model: string;
  apiBase?: string;
  apiKey?: string;
  judgeModel?: string | null;
  benchmarkConfig: Record<string, any>;
  catalogModels?: Record<string, any>;
}

export interface EnvBuildResult {
  env: Record<string, string>;
  effectiveJudge: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Benchmark-specific environment variable defaults */
const BENCHMARK_ENV_DEFAULTS: Record<string, string> = {
  MSSBENCH_DATA_ROOT: path.join(config.evalPocRoot, 'data', 'mssbench'),
  SAFERAG_ROOT: path.join(config.evalPocRoot, 'vendor', 'SafeRAG'),
  CYBENCH_ACKNOWLEDGE_RISKS: '1',
};

// ---------------------------------------------------------------------------
// Judge model resolution
// ---------------------------------------------------------------------------

export function resolveJudgeModel(
  judgeModel: string | null | undefined,
  benchmarkConfig: Record<string, any>,
  catalogModels: Record<string, any>,
): { effectiveJudge: string | null; env: Record<string, string> } {
  const env: Record<string, string> = {};

  // Treat "default" as unset
  if (judgeModel && judgeModel.toLowerCase() === 'default') {
    judgeModel = null;
  }

  let effectiveJudge = judgeModel || benchmarkConfig.judge_model || null;
  if (!effectiveJudge) {
    return { effectiveJudge: null, env };
  }

  const modelDef = catalogModels[effectiveJudge];
  if (modelDef) {
    const provider = modelDef.provider || 'openai';
    effectiveJudge = `${provider}/${effectiveJudge}`;

    if (modelDef.base_url) {
      env.JUDGE_BASE_URL = modelDef.base_url;
    }

    const apiKeyEnvName = modelDef.api_key_env;
    if (apiKeyEnvName) {
      const keyValue = process.env[apiKeyEnvName] || '';
      if (keyValue) {
        env.JUDGE_API_KEY = keyValue;
      }
    }
  } else {
    effectiveJudge = normalizeModelName(effectiveJudge);
  }

  // Always set JUDGE_MODEL_NAME (bare name without provider prefix)
  env.JUDGE_MODEL_NAME = effectiveJudge.includes('/')
    ? effectiveJudge.split('/').slice(1).join('/')
    : effectiveJudge;

  return { effectiveJudge, env };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the complete environment for an inspect eval subprocess.
 */
export function buildEnvironment(options: EnvBuildOptions): EnvBuildResult {
  const {
    benchmarkName,
    model,
    apiBase,
    apiKey,
    judgeModel,
    benchmarkConfig,
    catalogModels = {},
  } = options;

  // Start with current process env
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Set INSPECT_LOG_DIR
  const sanitizedModel = sanitizeModelName(model);
  const resultsDir = path.join(config.resultsDir, sanitizedModel, benchmarkName, 'logs');
  env.INSPECT_LOG_DIR = resultsDir;

  // Proxy normalization: ensure both upper/lowercase variants are set
  for (const [lower, upper] of [['http_proxy', 'HTTP_PROXY'], ['https_proxy', 'HTTPS_PROXY']]) {
    const val = env[upper] || env[lower];
    if (val) {
      env[lower] = val;
      env[upper] = val;
    }
  }

  // Remove VSCode extension env vars that interfere with inspect_ai caching
  delete env.INSPECT_WORKSPACE_ID;
  delete env.INSPECT_VSCODE_EXT_VERSION;

  // Inject benchmark-specific defaults
  for (const [envKey, envDefault] of Object.entries(BENCHMARK_ENV_DEFAULTS)) {
    if (!env[envKey]) {
      env[envKey] = envDefault;
    }
  }

  // HuggingFace offline mode — force datasets lib to use local cache only
  const datasetsCacheDir = path.join(config.evalPocRoot, 'datasets-cache');
  env.HF_DATASETS_OFFLINE = '1';
  env.HF_HOME = datasetsCacheDir;
  env.HF_DATASETS_CACHE = path.join(datasetsCacheDir, 'datasets');
  env.TRANSFORMERS_OFFLINE = '1';
  env.HF_HUB_OFFLINE = '1';
  env.HF_UPDATE_DOWNLOAD_COUNTS = '0';

  // Resolve judge model
  const judgeResult = resolveJudgeModel(judgeModel, benchmarkConfig, catalogModels);
  Object.assign(env, judgeResult.env);

  // API key / base URL overrides
  if (apiKey) {
    env.OPENAI_API_KEY = apiKey;
  }
  if (apiBase) {
    env.OPENAI_BASE_URL = apiBase;
  }

  return {
    env,
    effectiveJudge: judgeResult.effectiveJudge,
  };
}
