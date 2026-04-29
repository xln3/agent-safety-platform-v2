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
  /**
   * Per-judge overrides (base URL / api key). When present, the grader role
   * is emitted as a JSON `--model-role` spec so inspect_ai forwards them to
   * the openai provider; otherwise the bare model name is used and the
   * provider falls back to the same env vars as the solver.
   */
  judgeOverride?: { apiBase?: string | null; apiKey?: string | null } | null;
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
  /**
   * Custom solver path (e.g. "/abs/path/to/ts_bridge_solver.py@ts_bridge").
   * When set, inspect_ai delegates per-sample solving to that callable
   * instead of generating with --model.
   */
  solverPath?: string;
  /** Args forwarded to the solver via -S key=value. */
  solverArgs?: Record<string, string | number>;
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
    judgeOverride,
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
    solverPath,
    solverArgs,
  } = options;

  const cmd: string[] = [inspectPath, 'eval', taskSpec, '--model', modelForInspect];

  // Use JSON log format so the platform produces single-file .json logs
  // instead of the legacy .eval (zip) bundle. Old .eval files remain readable
  // via resultReader's zip fallback path.
  cmd.push('--log-format', 'json');

  // Custom solver — pushed early so it precedes other --solver-arg flags
  if (solverPath) {
    cmd.push('--solver', solverPath);
    if (solverArgs) {
      for (const [k, v] of Object.entries(solverArgs)) {
        cmd.push('-S', `${k}=${v}`);
      }
    }
  }

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
  }

  // Force epochs=1 whenever the caller asked for a finite budget — applies to
  // both --limit and --sample-id paths so that benchmarks like b3 (epochs=5
  // default) don't silently 5× the requested sample count.
  if (limit) {
    cmd.push('--epochs', '1');
  }

  // Judge model
  if (effectiveJudge) {
    if (judgeOverride && (judgeOverride.apiBase || judgeOverride.apiKey)) {
      // inspect_ai parses --model-role JSON via parse_model_role_cli_args:
      // it pops "model" + "model_args"; "model_args" is forwarded to the
      // provider's get_model() (so base_url + api_key live there).
      const modelArgs: Record<string, unknown> = {};
      if (judgeOverride.apiBase) modelArgs.base_url = judgeOverride.apiBase;
      if (judgeOverride.apiKey) modelArgs.api_key = judgeOverride.apiKey;
      const roleSpec: Record<string, unknown> = { model: effectiveJudge, model_args: modelArgs };
      cmd.push('--model-role', `grader=${JSON.stringify(roleSpec)}`);
    } else {
      cmd.push('--model-role', `grader=${effectiveJudge}`);
    }
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
