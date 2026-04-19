/**
 * setup-venvs.ts
 *
 * One-time script to provision per-benchmark Python virtual environments.
 * Iterates over `catalog.yaml`, calling `venvService.setupBenchmarkEnv`
 * serially so that `uv` and `pip` don't fight over the cache.
 *
 * Usage:
 *   npx ts-node scripts/setup-venvs.ts
 *   npx ts-node scripts/setup-venvs.ts --force
 *   npx ts-node scripts/setup-venvs.ts --benchmarks=saferag,b3,bfcl
 */

import catalogService from '../src/services/catalogService';
import * as venvService from '../src/services/venvService';

interface Failure {
  name: string;
  error: string;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const onlyArg = process.argv.find((a) => a.startsWith('--benchmarks='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null;

  const benchmarks = catalogService
    .getAllBenchmarks()
    .filter((b) => !only || only.includes(b.name));

  if (benchmarks.length === 0) {
    console.error('No benchmarks to set up (check --benchmarks filter or catalog.yaml).');
    process.exit(1);
  }

  console.log(`=== Venv Setup (${benchmarks.length} benchmark${benchmarks.length === 1 ? '' : 's'}) ===\n`);
  if (force) console.log('Flag: --force (will recreate existing venvs)\n');

  const success: string[] = [];
  const failed: Failure[] = [];

  for (const bench of benchmarks) {
    const cfg = catalogService.getBenchmarkConfig(bench.name);
    if (!cfg) {
      failed.push({ name: bench.name, error: 'getBenchmarkConfig returned null' });
      continue;
    }
    const tag = `[${bench.name}]`;
    console.log(`${tag} python=${cfg.python} source=${cfg.source} — provisioning...`);
    try {
      await venvService.setupBenchmarkEnv(bench.name, cfg, force);
      success.push(bench.name);
      console.log(`${tag} OK`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      failed.push({ name: bench.name, error: msg });
      console.error(`${tag} FAILED — ${msg}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Success (${success.length}): ${success.join(', ') || '-'}`);
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
