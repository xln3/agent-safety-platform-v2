/**
 * venvService.ts
 *
 * Manages per-benchmark Python virtual environments.
 * Ported from run-eval.py lines 268-420 + 62-69 + 187-265.
 *
 * Calls `uv` via child_process — does not rewrite uv itself.
 */

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import logger from '../utils/logger';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVAL_ENGINE_ROOT = config.evalPocRoot;
const VENVS_DIR = path.join(EVAL_ENGINE_ROOT, '.venvs');
const BENCHMARKS_DIR = path.join(EVAL_ENGINE_ROOT, 'benchmarks');
const LOCAL_BENCH_DIR = path.join(BENCHMARKS_DIR, 'eval_benchmarks');
const PATCHES_DIR = path.join(BENCHMARKS_DIR, 'patches');
const MARKER_FILE = '.eval-poc-marker.json';

/** Post-install patches: benchmark -> [(site-packages relative target, patch filename)] */
const VENV_PATCHES: Record<string, Array<[string, string]>> = {
  makemesay: [['inspect_evals/makemesay/utils.py', 'makemesay_utils.py']],
  osworld: [['inspect_evals/osworld/sparse_clone.py', 'osworld_sparse_clone.py']],
};

// ---------------------------------------------------------------------------
// In-process lock map (prevents duplicate concurrent setups for same benchmark)
// ---------------------------------------------------------------------------

const pendingSetups = new Map<string, Promise<boolean>>();

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getVenvPath(benchmarkName: string): string {
  return path.join(VENVS_DIR, benchmarkName);
}

export function getInspectPath(benchmarkName: string): string {
  return path.join(VENVS_DIR, benchmarkName, 'bin', 'inspect');
}

export function getPythonPath(benchmarkName: string): string {
  return path.join(VENVS_DIR, benchmarkName, 'bin', 'python');
}

// ---------------------------------------------------------------------------
// Marker (version tracking)
// ---------------------------------------------------------------------------

interface MarkerData {
  inspect_ai: string | null;
  inspect_evals: string | null;
  source: string;
  extras: string[];
  created: string;
}

function readMarker(venvPath: string): MarkerData | null {
  const markerPath = path.join(venvPath, MARKER_FILE);
  if (!fs.existsSync(markerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
  } catch {
    return null;
  }
}

function getInstalledVersion(venvPath: string, pkg: string): string | null {
  try {
    const result = execFileSync('uv', ['pip', 'show', '-p', venvPath, pkg], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    for (const line of result.split('\n')) {
      if (line.startsWith('Version:')) {
        return line.split(':')[1].trim();
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

function writeMarker(venvPath: string, source: string, extras: string[]): void {
  const marker: MarkerData = {
    inspect_ai: getInstalledVersion(venvPath, 'inspect-ai'),
    inspect_evals: getInstalledVersion(venvPath, 'inspect-evals'),
    source,
    extras,
    created: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(venvPath, MARKER_FILE), JSON.stringify(marker, null, 2));
}

// ---------------------------------------------------------------------------
// Patch system
// ---------------------------------------------------------------------------

function findSitePackages(venvPath: string): string | null {
  const libDir = path.join(venvPath, 'lib');
  if (!fs.existsSync(libDir)) return null;

  const pythonDirs = fs.readdirSync(libDir).filter((d) => d.startsWith('python'));
  if (pythonDirs.length === 0) return null;

  const sp = path.join(libDir, pythonDirs[0], 'site-packages');
  return fs.existsSync(sp) ? sp : null;
}

function applyPatches(benchmarkName: string, venvPath: string): void {
  const patches = VENV_PATCHES[benchmarkName] || [];
  const sp = findSitePackages(venvPath);

  if (!sp) {
    if (patches.length > 0) {
      logger.warn(`Cannot find site-packages for ${benchmarkName}, skipping patches`);
    }
    return;
  }

  for (const [targetRel, patchFilename] of patches) {
    const patchSrc = path.join(PATCHES_DIR, patchFilename);
    const target = path.join(sp, targetRel);

    if (!fs.existsSync(patchSrc)) {
      logger.warn(`Patch source not found: ${patchSrc}`);
      continue;
    }
    if (!fs.existsSync(path.dirname(target))) {
      logger.warn(`Patch target dir not found: ${path.dirname(target)}`);
      continue;
    }

    fs.copyFileSync(patchSrc, target);
    logger.info(`Applied patch: ${targetRel}`);
  }

  // Special: threecb Dockerfile patching
  if (benchmarkName === 'threecb') {
    patchThreecbDockerfiles(sp);
  }
}

function patchThreecbDockerfiles(sitePackages: string): void {
  const taskConfigs = path.join(sitePackages, 'inspect_evals', 'threecb', 'task_configs');
  if (!fs.existsSync(taskConfigs)) return;

  let patched = 0;

  function walkDockerfiles(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDockerfiles(fullPath);
      } else if (entry.name === 'Dockerfile') {
        patchSingleDockerfile(fullPath);
        patched++;
      }
    }
  }

  function patchSingleDockerfile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const newLines: string[] = [];
    let skipContinuation = false;

    for (const line of lines) {
      const stripped = line.trim();
      if (skipContinuation) {
        if (!stripped.endsWith('\\')) {
          skipContinuation = false;
        }
        continue;
      }

      if (stripped.startsWith('FROM debian:stable')) {
        newLines.push('FROM threecb-debian-base');
        continue;
      }
      if (stripped.startsWith('FROM alpine:')) {
        newLines.push('FROM threecb-alpine-base');
        continue;
      }
      if (stripped.startsWith('RUN apt-get') || stripped.startsWith('RUN apk')) {
        if (stripped.endsWith('\\')) {
          skipContinuation = true;
        }
        continue;
      }

      newLines.push(line);
    }

    let result = newLines.join('\n');
    while (result.includes('\n\n\n')) {
      result = result.replace(/\n\n\n/g, '\n\n');
    }
    result = result.trim() + '\n';
    fs.writeFileSync(filePath, result);
  }

  walkDockerfiles(taskConfigs);

  if (patched > 0) {
    logger.info(`Patched ${patched} threecb Dockerfile(s) (pre-built base images)`);
  }
}

// ---------------------------------------------------------------------------
// Cross-process lock (atomic mkdir)
// ---------------------------------------------------------------------------

/**
 * Remove a lock path whether it's a file or a directory.
 * Handles the case where a previous process left a regular file
 * instead of a directory (e.g., due to a different lock implementation).
 */
function removeLockPath(lockDir: string): void {
  try {
    const stat = fs.statSync(lockDir);
    if (stat.isDirectory()) {
      fs.rmdirSync(lockDir);
    } else {
      fs.unlinkSync(lockDir);
    }
  } catch {
    // Already gone
  }
}

function acquireDirLock(lockDir: string): boolean {
  try {
    fs.mkdirSync(lockDir, { recursive: false });
    return true;
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      // Check for stale lock (older than 10 minutes)
      try {
        const stat = fs.statSync(lockDir);
        if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
          removeLockPath(lockDir);
          fs.mkdirSync(lockDir, { recursive: false });
          return true;
        }
      } catch {
        // Ignore
      }
      return false;
    }
    throw err;
  }
}

function releaseDirLock(lockDir: string): void {
  removeLockPath(lockDir);
}

async function waitForDirLock(lockDir: string, timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!acquireDirLock(lockDir)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for lock: ${lockDir}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------------------------------------------------------------------------
// Shell helper
// ---------------------------------------------------------------------------

async function runUv(args: string[], label: string): Promise<boolean> {
  try {
    const { stderr } = await execFileAsync('uv', args, {
      timeout: 300_000,
      encoding: 'utf-8',
    });
    return true;
  } catch (err: any) {
    logger.error(`${label} failed:`, err.stderr?.slice(0, 500) || err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main setup function
// ---------------------------------------------------------------------------

/**
 * Set up an isolated virtual environment for a benchmark.
 *
 * Uses two-level locking:
 * - In-process: Map<string, Promise> deduplicates concurrent calls
 * - Cross-process: atomic mkdir prevents races between Node instances
 */
export async function setupBenchmarkEnv(
  benchmarkName: string,
  benchmarkConfig: Record<string, any>,
  force = false,
): Promise<boolean> {
  // In-process deduplication
  const existing = pendingSetups.get(benchmarkName);
  if (existing && !force) {
    return existing;
  }

  const promise = doSetup(benchmarkName, benchmarkConfig, force);
  pendingSetups.set(benchmarkName, promise);
  try {
    return await promise;
  } finally {
    pendingSetups.delete(benchmarkName);
  }
}

async function doSetup(
  benchmarkName: string,
  cfg: Record<string, any>,
  force: boolean,
): Promise<boolean> {
  const venvPath = getVenvPath(benchmarkName);
  const pythonVersion = cfg.python || '3.10';
  const extras: string[] = cfg.extras || [];
  const source: string = cfg.source || 'upstream';

  // Ensure .venvs dir exists
  fs.mkdirSync(VENVS_DIR, { recursive: true });

  // Cross-process lock
  const lockDir = path.join(VENVS_DIR, `${benchmarkName}.setup.lock`);
  await waitForDirLock(lockDir);

  try {
    // Re-check under lock
    if (fs.existsSync(venvPath) && !force) {
      const inspectBin = getInspectPath(benchmarkName);
      if (fs.existsSync(inspectBin)) {
        logger.info(`Venv already exists: ${venvPath}`);
        if (!readMarker(venvPath)) {
          writeMarker(venvPath, source, extras);
        }
        return true;
      }
    }

    logger.info(`Creating venv: ${venvPath} (Python ${pythonVersion})`);

    // 1. Create venv
    const venvArgs = ['venv', venvPath, '--python', pythonVersion];
    if (fs.existsSync(venvPath)) venvArgs.push('--clear');
    if (!await runUv(venvArgs, 'uv venv')) return false;

    // 2. Install inspect-ai
    if (!await runUv(['pip', 'install', '-p', venvPath, 'inspect-ai'], 'inspect-ai')) return false;

    // 3. Install inspect-evals (with extras)
    let installSpec = 'inspect-evals';
    if (extras.length > 0) {
      installSpec = `inspect-evals[${extras.join(',')}]`;
    }
    if (!await runUv(['pip', 'install', '-p', venvPath, installSpec], 'inspect-evals')) return false;

    // 4. Install eval_benchmarks package
    if (!await runUv(['pip', 'install', '-p', venvPath, '-e', BENCHMARKS_DIR], 'eval_benchmarks')) return false;

    // 5. Local benchmark: install requirements.txt
    if (source === 'local') {
      const moduleName = (cfg.module || '').split('/').pop() || '';
      const reqFile = path.join(LOCAL_BENCH_DIR, moduleName, 'requirements.txt');
      if (fs.existsSync(reqFile)) {
        await runUv(['pip', 'install', '-p', venvPath, '-r', reqFile], `${moduleName} deps`);
      }
    }

    // 6. Install openai
    if (!await runUv(['pip', 'install', '-p', venvPath, 'openai'], 'openai')) return false;

    // 7. Sanity check
    const pythonBin = getPythonPath(benchmarkName);
    try {
      execFileSync(pythonBin, ['-c', 'import inspect_evals'], {
        timeout: 30_000,
        encoding: 'utf-8',
      });
    } catch {
      logger.error(`inspect_evals import check failed for ${benchmarkName}, removing venv`);
      fs.rmSync(venvPath, { recursive: true, force: true });
      return false;
    }

    // 8. Apply patches
    applyPatches(benchmarkName, venvPath);

    // 9. Write marker
    writeMarker(venvPath, source, extras);
    logger.info(`Venv setup complete: ${benchmarkName}`);
    return true;
  } finally {
    releaseDirLock(lockDir);
  }
}
