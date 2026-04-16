/**
 * commandBuilder.ts
 *
 * Constructs the `inspect eval` CLI command with all flags.
 * Ported from run-eval.py lines 749-838.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandBuildOptions {
  inspectPath: string;
  taskSpec: string;
  modelForInspect: string;
  apiBase?: string;
  limit?: number;
  effectiveJudge?: string | null;
  judgeParam?: string;
  modelRoles?: Record<string, string>;
  taskArgs?: Record<string, unknown>;
  sampleIds?: string[] | null;
  indexMode?: 'include' | 'exclude' | null;
  maxConnections?: number;
  maxSamples?: number;
  systemMessage?: string;
  reasoningEffort?: string;
  reasoningTokens?: number;
  extraArgs?: string[];
  /** Models dict from catalog.yaml for resolving short names */
  catalogModels?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Model name helpers
// ---------------------------------------------------------------------------

/**
 * Add "openai/" prefix if model name has no provider prefix.
 */
export function normalizeModelName(modelName: string): string {
  if (!modelName.includes('/')) {
    return `openai/${modelName}`;
  }
  return modelName;
}

/**
 * Replace "/" with "_" for safe use in file paths.
 */
export function sanitizeModelName(modelName: string): string {
  return modelName.replace(/\//g, '_');
}

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

/**
 * Build the full `inspect eval` CLI command array.
 */
export function buildInspectCommand(options: CommandBuildOptions): string[] {
  const {
    inspectPath,
    taskSpec,
    modelForInspect,
    apiBase,
    limit,
    effectiveJudge,
    judgeParam,
    modelRoles,
    taskArgs,
    sampleIds,
    indexMode,
    maxConnections,
    maxSamples,
    systemMessage,
    reasoningEffort,
    reasoningTokens,
    extraArgs,
    catalogModels,
  } = options;

  const cmd: string[] = [inspectPath, 'eval', taskSpec, '--model', modelForInspect];

  // Model base URL
  if (apiBase) {
    cmd.push('--model-base-url', apiBase);
  }

  // Sample ID filtering (include mode)
  let hasSampleIds = false;
  if (sampleIds && sampleIds.length > 0 && indexMode === 'include') {
    // Filter out wildcard patterns (inspect_ai doesn't support them)
    let literalIds = sampleIds.filter((id) => !id.includes('*') && !id.includes('?'));
    if (literalIds.length > 0) {
      // If limit specified with sample IDs, truncate
      if (limit && literalIds.length > limit) {
        literalIds = literalIds.slice(0, limit);
      }
      cmd.push('--sample-id', literalIds.join(','));
      hasSampleIds = true;
    }
  }
  // Note: exclude mode sample IDs are pre-computed by indexService
  // and passed as include-mode literal IDs after exclusion
  if (sampleIds && sampleIds.length > 0 && indexMode === 'exclude') {
    let ids = [...sampleIds];
    if (limit && ids.length > limit) {
      ids = ids.slice(0, limit);
    }
    cmd.push('--sample-id', ids.join(','));
    hasSampleIds = true;
  }

  // Limit (only if no sample IDs specified)
  if (limit && !hasSampleIds) {
    cmd.push('--limit', String(limit));
    // Override hardcoded epochs to prevent multiplication
    cmd.push('--epochs', '1');
  }

  // Judge model
  if (effectiveJudge) {
    cmd.push('--model-role', `grader=${effectiveJudge}`);
    if (judgeParam) {
      cmd.push('-T', `${judgeParam}=${effectiveJudge}`);
    }
  }

  // Additional model roles
  if (modelRoles) {
    const models = catalogModels || {};
    for (const [role, roleModel] of Object.entries(modelRoles)) {
      const modelDef = models[roleModel];
      let resolvedModel: string;
      if (modelDef) {
        const provider = modelDef.provider || 'openai';
        resolvedModel = `${provider}/${roleModel}`;
      } else {
        resolvedModel = normalizeModelName(roleModel);
      }
      cmd.push('--model-role', `${role}=${resolvedModel}`);
    }
  }

  // Task arguments
  if (taskArgs) {
    for (const [key, value] of Object.entries(taskArgs)) {
      cmd.push('-T', `${key}=${value}`);
    }
  }

  // Agent system prompt and reasoning config
  if (systemMessage) {
    cmd.push('--system-message', systemMessage);
  }
  if (reasoningEffort) {
    cmd.push('--reasoning-effort', reasoningEffort);
  }
  if (reasoningTokens) {
    cmd.push('--reasoning-tokens', String(reasoningTokens));
  }

  // Concurrency parameters
  if (maxConnections) {
    cmd.push('--max-connections', String(maxConnections));
  }
  if (maxSamples) {
    cmd.push('--max-samples', String(maxSamples));
  }

  // Extra arguments passthrough
  if (extraArgs && extraArgs.length > 0) {
    cmd.push(...extraArgs);
  }

  return cmd;
}
