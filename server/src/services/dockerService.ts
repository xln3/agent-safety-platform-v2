/**
 * dockerService.ts
 *
 * Docker lifecycle management for benchmarks that require containers.
 * Ported from run-eval.py lines 892-1037.
 *
 * All Docker commands are best-effort — errors are logged but never
 * thrown, to avoid failing the evaluation task.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import path from 'path';
import { config } from '../config';
import logger from '../utils/logger';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Container cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up stale Docker containers and networks BEFORE running a Docker benchmark.
 *
 * Aggressively removes ALL stopped inspect-* containers (exited, dead, created)
 * to prevent resource accumulation from previous failed runs.
 */
export async function dockerPreCleanup(
  benchmarkName: string,
  taskName?: string,
): Promise<void> {
  // 1. Remove stopped inspect-* containers
  try {
    const containerIds: string[] = [];

    for (const status of ['exited', 'dead', 'created']) {
      const { stdout } = await execFileAsync('docker', [
        'ps', '-a', '--format', '{{.ID}}\t{{.Names}}',
        '--filter', 'name=inspect-',
        '--filter', `status=${status}`,
      ], { timeout: 10_000 });

      for (const line of stdout.trim().split('\n')) {
        const parts = line.trim().split('\t');
        if (parts.length >= 2 && parts[0] && parts[1].startsWith('inspect-')) {
          containerIds.push(parts[0]);
        }
      }
    }

    // Deduplicate
    const uniqueIds = [...new Set(containerIds)];
    if (uniqueIds.length > 0) {
      await execFileAsync('docker', ['rm', '-f', ...uniqueIds], { timeout: 30_000 });
      logger.info(`[Docker pre-cleanup] Removed ${uniqueIds.length} stopped container(s)`);
    }
  } catch (err) {
    logger.warn(`[Docker pre-cleanup] Container cleanup failed:`, err);
  }

  // 2. Remove unused inspect-* networks
  await cleanupDockerNetworks();
}

/**
 * Remove stale inspect-* Docker networks to prevent address pool exhaustion.
 */
export async function cleanupDockerNetworks(): Promise<void> {
  try {
    const { stdout } = await execFileAsync('docker', [
      'network', 'ls', '--format', '{{.Name}}', '--filter', 'name=inspect-',
    ], { timeout: 10_000 });

    const networks = stdout.trim().split('\n').filter(Boolean);
    if (networks.length === 0) return;

    let removed = 0;
    for (const net of networks) {
      try {
        await execFileAsync('docker', ['network', 'rm', net.trim()], { timeout: 10_000 });
        removed++;
      } catch {
        // Network may be in use — skip
      }
    }

    if (removed > 0) {
      logger.info(`[Docker cleanup] Removed ${removed} stale inspect-* network(s)`);
    }
  } catch {
    // Best-effort — don't fail the task
  }
}

// ---------------------------------------------------------------------------
// AI2-THOR server for SafeAgentBench
// ---------------------------------------------------------------------------

/**
 * Ensure the AI2-THOR Docker container is running for SafeAgentBench.
 *
 * If the container is not responding on localhost:port, start it via docker compose.
 */
export async function ensureThorServer(port = 9100, timeout = 120): Promise<void> {
  // Quick health check
  const isRunning = await checkThorHealth(port);
  if (isRunning) {
    logger.info(`[AI2-THOR] Server already running on port ${port}`);
    return;
  }

  // Start the container
  const dockerDir = path.join(
    config.evalPocRoot, 'benchmarks', 'eval_benchmarks', 'safeagentbench', 'docker',
  );
  logger.info(`[AI2-THOR] Starting container from ${dockerDir}...`);

  try {
    await execFileAsync('docker', ['compose', 'up', '-d', '--build'], {
      cwd: dockerDir,
      timeout: 600_000,
    });
  } catch (err) {
    logger.warn(`[AI2-THOR] Failed to start:`, err);
    return;
  }

  // Wait for readiness
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    if (await checkThorHealth(port)) {
      logger.info(`[AI2-THOR] Server ready on port ${port}`);
      return;
    }
    await sleep(3000);
  }

  logger.warn(`[AI2-THOR] Server not ready after ${timeout}s, proceeding anyway`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkThorHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, { timeout: 5000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
