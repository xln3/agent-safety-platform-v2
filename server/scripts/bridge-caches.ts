/**
 * bridge-caches.ts
 *
 * Creates symlinks from global HuggingFace and inspect_evals caches
 * into the project's datasets-cache/ directory so that offline evals
 * can find all data without copying ~100GB.
 *
 * Usage: npx ts-node scripts/bridge-caches.ts
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../src/config';

const CACHE_DIR = path.join(config.evalPocRoot, 'datasets-cache');
const LOCAL_DATASETS = path.join(CACHE_DIR, 'datasets');
const LOCAL_HUB = path.join(CACHE_DIR, 'hub');
const LOCAL_INSPECT = path.join(CACHE_DIR, 'inspect_evals');

const GLOBAL_HF_DATASETS = path.join(os.homedir(), '.cache', 'huggingface', 'datasets');
const GLOBAL_HF_HUB = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
const GLOBAL_INSPECT = path.join(os.homedir(), '.cache', 'inspect_evals');

const MANIFEST_PATH = path.join(CACHE_DIR, '.manifest.json');

interface Manifest {
  datasets: Record<string, { cachedAt: string; source: string }>;
}

function readManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) return { datasets: {} };
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')); }
  catch { return { datasets: {} }; }
}

function writeManifest(m: Manifest): void {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function symlinkIfMissing(target: string, linkPath: string): boolean {
  if (fs.existsSync(linkPath)) return false;
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (err: any) {
    console.error(`  FAIL symlink ${target} -> ${linkPath}: ${err.message}`);
    return false;
  }
}

function bridgeDir(globalDir: string, localDir: string, filter?: (name: string) => boolean): number {
  if (!fs.existsSync(globalDir)) {
    console.log(`  Global dir not found: ${globalDir}`);
    return 0;
  }
  ensureDir(localDir);
  let linked = 0;
  for (const entry of fs.readdirSync(globalDir)) {
    if (filter && !filter(entry)) continue;
    const target = path.join(globalDir, entry);
    const link = path.join(localDir, entry);
    if (symlinkIfMissing(target, link)) {
      linked++;
    }
  }
  return linked;
}

function main(): void {
  console.log('=== Cache Bridge ===\n');
  ensureDir(CACHE_DIR);

  // 1. HF datasets
  console.log('1. HuggingFace datasets/');
  const dsLinked = bridgeDir(GLOBAL_HF_DATASETS, LOCAL_DATASETS);
  console.log(`   Linked: ${dsLinked} new symlinks\n`);

  // 2. HF hub (datasets-- dirs + .locks + CACHEDIR.TAG)
  console.log('2. HuggingFace hub/');
  const hubLinked = bridgeDir(GLOBAL_HF_HUB, LOCAL_HUB);
  console.log(`   Linked: ${hubLinked} new symlinks\n`);

  // 3. inspect_evals
  console.log('3. inspect_evals/');
  const inspLinked = bridgeDir(GLOBAL_INSPECT, LOCAL_INSPECT);
  console.log(`   Linked: ${inspLinked} new symlinks\n`);

  // 4. Update manifest
  console.log('4. Updating manifest...');
  const manifest = readManifest();
  const now = new Date().toISOString();

  // Mark all bridged datasets
  if (fs.existsSync(LOCAL_DATASETS)) {
    for (const entry of fs.readdirSync(LOCAL_DATASETS)) {
      // Derive benchmark name from dir name (rough: org___name -> name)
      const parts = entry.split('___');
      const name = parts.length > 1 ? parts[1] : parts[0];
      if (!manifest.datasets[name]) {
        manifest.datasets[name] = { cachedAt: now, source: 'hf' };
      }
    }
  }
  if (fs.existsSync(LOCAL_INSPECT)) {
    for (const entry of fs.readdirSync(LOCAL_INSPECT)) {
      if (!manifest.datasets[entry]) {
        manifest.datasets[entry] = { cachedAt: now, source: 'inspect_cache' };
      }
    }
  }
  writeManifest(manifest);
  console.log(`   Manifest entries: ${Object.keys(manifest.datasets).length}\n`);

  // Summary
  const totalDs = fs.existsSync(LOCAL_DATASETS) ? fs.readdirSync(LOCAL_DATASETS).length : 0;
  const totalHub = fs.existsSync(LOCAL_HUB) ? fs.readdirSync(LOCAL_HUB).length : 0;
  const totalInsp = fs.existsSync(LOCAL_INSPECT) ? fs.readdirSync(LOCAL_INSPECT).length : 0;
  console.log('=== Summary ===');
  console.log(`datasets-cache/datasets/:       ${totalDs} entries`);
  console.log(`datasets-cache/hub/:            ${totalHub} entries`);
  console.log(`datasets-cache/inspect_evals/:  ${totalInsp} entries`);
  console.log(`manifest entries:               ${Object.keys(manifest.datasets).length}`);
}

main();
