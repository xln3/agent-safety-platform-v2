/**
 * prepare-docker.ts
 *
 * Pre-pull all Docker images required by `needs_docker: true` benchmarks
 * so that evaluations don't stall waiting for `docker pull` at runtime.
 *
 * IMPORTANT: This script never packs images into the deployment artifact.
 * It only stores them in the daemon's `/var/lib/docker/` cache and writes
 * a manifest (`server/eval-engine/.docker-cache/manifest.json`) for ops.
 *
 * Behavior summary:
 *   1. Parse `benchmarks/catalog.yaml` to find benchmarks with needs_docker.
 *   2. Walk each benchmark's upstream package + local wrapper for
 *      Dockerfiles (FROM lines) and compose files (image: keys).
 *   3. Pull every extracted, registry-resolvable image (skip local-build refs
 *      like "threecb-debian-base" that have no registry slash and no tag).
 *   4. Optionally `docker save` each image to .docker-cache/<sanitized>.tar.
 *   5. Write a manifest summarising which benchmarks are ready / skipped.
 *
 * Usage:
 *   npx ts-node scripts/prepare-docker.ts                    # pull everything
 *   npx ts-node scripts/prepare-docker.ts --dry-run          # only print plan
 *   npx ts-node scripts/prepare-docker.ts --benchmark threecb
 *   npx ts-node scripts/prepare-docker.ts --force            # re-pull existing
 *   npx ts-node scripts/prepare-docker.ts --save             # also docker save
 *   npx ts-node scripts/prepare-docker.ts --help
 *
 * Proxy note:
 *   This server runs Clash on 127.0.0.1:7890 and pollutes shell-level
 *   http_proxy/https_proxy. We unset those vars in spawned docker commands
 *   so docker uses its own daemon-level proxy config (or no proxy).
 */

import fs from 'fs';
import path from 'path';
import { execFile, spawnSync, SpawnSyncOptions } from 'child_process';
import { promisify } from 'util';
import yaml from 'js-yaml';
import { config } from '../src/config';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EVAL_ENGINE = config.evalPocRoot;
const CATALOG_PATH = path.join(EVAL_ENGINE, 'benchmarks', 'catalog.yaml');
const VENVS_DIR = path.join(EVAL_ENGINE, '.venvs');
const LOCAL_BENCHMARKS_DIR = path.join(EVAL_ENGINE, 'benchmarks', 'eval_benchmarks');
const DOCKER_CACHE_DIR = path.join(EVAL_ENGINE, '.docker-cache');
const MANIFEST_PATH = path.join(DOCKER_CACHE_DIR, 'manifest.json');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

interface CliFlags {
  dryRun: boolean;
  force: boolean;
  save: boolean;
  benchmark: string | null;
  help: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: false,
    force: false,
    save: false,
    benchmark: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--save') flags.save = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--benchmark') flags.benchmark = argv[++i] ?? null;
    else if (a.startsWith('--benchmark=')) flags.benchmark = a.split('=')[1];
  }
  return flags;
}

function printUsage(): void {
  console.log(`Usage: ts-node scripts/prepare-docker.ts [options]

Pre-pull Docker images for benchmarks that have needs_docker: true.

Options:
  --dry-run               Print plan only; do not pull or save.
  --force                 Pull even if image is already cached.
  --save                  Additionally export each image as a .tar
                          into ${path.relative(process.cwd(), DOCKER_CACHE_DIR)}/.
                          (NOT default — tars can be tens of GB; only
                          use this for offline transport scenarios.)
  --benchmark <name>      Only process the named benchmark.
  -h, --help              Show this help.

Manifest: ${path.relative(process.cwd(), MANIFEST_PATH)}
`);
}

// ---------------------------------------------------------------------------
// Catalog parsing
// ---------------------------------------------------------------------------

interface CatalogYamlBenchmark {
  source?: string;
  module?: string;
  python?: string;
  needs_docker?: boolean;
}

interface CatalogYaml {
  benchmarks?: Record<string, CatalogYamlBenchmark>;
}

interface BenchmarkEntry {
  name: string;
  source: string;        // 'upstream' | 'local'
  module: string;        // e.g. 'inspect_evals/threecb' or 'eval_benchmarks/cve_bench'
  python: string;        // e.g. '3.10'
  needsDocker: boolean;
}

function loadDockerBenchmarks(): BenchmarkEntry[] {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`catalog.yaml not found at ${CATALOG_PATH}`);
  }
  const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
  const parsed = (yaml.load(raw) as CatalogYaml) || {};
  const map = parsed.benchmarks ?? {};
  const out: BenchmarkEntry[] = [];
  for (const [name, cfg] of Object.entries(map)) {
    if (!cfg?.needs_docker) continue;
    out.push({
      name,
      source: cfg.source ?? 'upstream',
      module: cfg.module ?? '',
      python: cfg.python ?? '3.10',
      needsDocker: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image extraction
// ---------------------------------------------------------------------------

/** A reference we found in source files. May or may not be pullable. */
interface ImageRef {
  /** Raw token, e.g. `python:3.11-slim` or `threecb-debian-base`. */
  raw: string;
  /** Location it came from (for manifest). */
  source: string;
  /** Whether we believe it's a registry image (vs local self-built). */
  pullable: boolean;
  /** If from a Dockerfile, the Dockerfile dir for optional builds. */
  dockerfileDir?: string;
}

/**
 * Decide if a token looks like a registry-pullable image:
 *   - has a slash (org/name) -> probably DockerHub/private registry
 *   - has a colon AND the part before colon contains a known public name
 *     like python|node|alpine|ubuntu|nginx|debian|centos|redis|mysql|postgres
 *     OR it has a slash
 *   - rejects bare tags like "threecb-debian-base" with no slash, no colon
 */
function looksPullable(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  // Strip @sha256:... digest suffix for the heuristic
  const noDigest = s.split('@')[0];
  if (noDigest.includes('/')) return true;
  // Pure name:tag — only treat as pullable if the name is a known public image
  const PUBLIC_IMAGE_NAMES = new Set([
    'python', 'node', 'alpine', 'ubuntu', 'debian', 'nginx', 'centos',
    'redis', 'mysql', 'postgres', 'mariadb', 'mongo', 'busybox',
    'golang', 'rust', 'openjdk', 'eclipse-temurin', 'adoptopenjdk',
    'httpd', 'php', 'ruby', 'perl', 'gcc', 'haskell',
  ]);
  if (noDigest.includes(':')) {
    const name = noDigest.split(':')[0].toLowerCase();
    if (PUBLIC_IMAGE_NAMES.has(name)) return true;
  }
  return false;
}

/** Strip a leading platform spec like `--platform=linux/amd64`. */
function stripFromDirectives(line: string): string {
  // FROM [--platform=...] <image> [AS alias]
  let s = line.replace(/^FROM\s+/i, '');
  s = s.replace(/^--platform=\S+\s+/i, '');
  // drop trailing AS <alias>
  s = s.replace(/\s+AS\s+\S+\s*$/i, '');
  return s.trim();
}

function extractFromDockerfile(filePath: string): ImageRef[] {
  const refs: ImageRef[] = [];
  let content = '';
  try { content = fs.readFileSync(filePath, 'utf-8'); }
  catch { return refs; }
  const dir = path.dirname(filePath);
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (/^FROM\s/i.test(t)) {
      const ref = stripFromDirectives(t);
      if (ref) {
        refs.push({
          raw: ref,
          source: filePath,
          pullable: looksPullable(ref),
          dockerfileDir: dir,
        });
      }
    }
  }
  return refs;
}

function extractFromCompose(filePath: string): ImageRef[] {
  const refs: ImageRef[] = [];
  let parsed: any;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return refs;
  }
  if (!parsed || typeof parsed !== 'object') return refs;
  const services = parsed.services && typeof parsed.services === 'object' ? parsed.services : {};
  for (const svc of Object.values(services as Record<string, any>)) {
    if (!svc || typeof svc !== 'object') continue;
    const image = (svc as any).image;
    if (typeof image === 'string' && image.trim()) {
      refs.push({
        raw: image.trim(),
        source: filePath,
        pullable: looksPullable(image.trim()),
      });
    }
  }
  return refs;
}

/** Walk a directory tree (limited depth) and collect docker config files. */
function walkForDockerFiles(root: string, maxDepth = 8): {
  dockerfiles: string[];
  composes: string[];
} {
  const dockerfiles: string[] = [];
  const composes: string[] = [];
  if (!fs.existsSync(root)) return { dockerfiles, composes };

  const stack: { p: string; d: number }[] = [{ p: root, d: 0 }];
  while (stack.length > 0) {
    const { p, d } = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(p, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === '__pycache__' || e.name === 'node_modules' || e.name === '.git') continue;
        if (d + 1 <= maxDepth) stack.push({ p: full, d: d + 1 });
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        if (lower === 'dockerfile' || lower.startsWith('dockerfile.') || lower.startsWith('dockerfile_')) {
          dockerfiles.push(full);
        } else if (
          lower === 'compose.yaml' || lower === 'compose.yml' ||
          lower === 'docker-compose.yaml' || lower === 'docker-compose.yml' ||
          /^compose[-_].*\.ya?ml$/.test(lower) ||
          /^docker-compose[-_].*\.ya?ml$/.test(lower)
        ) {
          composes.push(full);
        }
      }
    }
  }
  return { dockerfiles, composes };
}

/** Locate ALL plausible upstream package directories in the benchmark's venv.
 *  Returns multiple paths because some benchmarks ship a thin stub plus a
 *  separate package containing the docker assets (cve_bench wraps cvebench). */
function findUpstreamPackageDirs(bench: BenchmarkEntry): string[] {
  const venvLib = path.join(VENVS_DIR, bench.name, 'lib');
  if (!fs.existsSync(venvLib)) return [];
  let pyVerDir: string | null = null;
  try {
    const entries = fs.readdirSync(venvLib);
    pyVerDir = entries.find(e => e.startsWith('python')) ?? null;
  } catch { return []; }
  if (!pyVerDir) return [];

  const sitePackages = path.join(venvLib, pyVerDir, 'site-packages');
  if (!fs.existsSync(sitePackages)) return [];

  // Module path is e.g. "inspect_evals/threecb" or "eval_benchmarks/cve_bench".
  // We want any directory likely to hold docker assets:
  //   - <sp>/<module>          (when module path resolves directly)
  //   - <sp>/inspect_evals/<name>
  //   - <sp>/<name>            (standalone packages: cvebench)
  //   - <sp>/<name_no_underscore>  (cve_bench -> cvebench)
  const candidates: string[] = [];
  if (bench.module) {
    const segs = bench.module.split('/');
    candidates.push(path.join(sitePackages, ...segs));
  }
  candidates.push(path.join(sitePackages, 'inspect_evals', bench.name));
  candidates.push(path.join(sitePackages, bench.name));
  candidates.push(path.join(sitePackages, bench.name.replace(/_/g, '')));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) out.push(c);
  }
  return out;
}

/** Locate the local wrapper directory under benchmarks/eval_benchmarks/<name>. */
function findLocalWrapperDir(bench: BenchmarkEntry): string | null {
  // Convention: benchmarks/eval_benchmarks/<name>
  const direct = path.join(LOCAL_BENCHMARKS_DIR, bench.name);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return direct;
  // Fallback: module path may be eval_benchmarks/<x>
  if (bench.module.startsWith('eval_benchmarks/')) {
    const sub = bench.module.split('/').slice(1).join('/');
    const p = path.join(LOCAL_BENCHMARKS_DIR, sub);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

interface BenchmarkExtraction {
  benchmark: string;
  refs: ImageRef[];
  searchedDirs: string[];
  warnings: string[];
}

function extractImagesForBenchmark(bench: BenchmarkEntry): BenchmarkExtraction {
  const out: BenchmarkExtraction = {
    benchmark: bench.name,
    refs: [],
    searchedDirs: [],
    warnings: [],
  };

  const dirs: string[] = [];
  const upstreams = findUpstreamPackageDirs(bench);
  for (const u of upstreams) dirs.push(u);
  if (upstreams.length === 0 && bench.source === 'upstream') {
    out.warnings.push(`upstream package dir not found (venv missing or not provisioned)`);
  }

  const local = findLocalWrapperDir(bench);
  if (local) dirs.push(local);

  out.searchedDirs = dirs;

  const seen = new Set<string>();
  for (const dir of dirs) {
    const { dockerfiles, composes } = walkForDockerFiles(dir);
    for (const df of dockerfiles) {
      for (const ref of extractFromDockerfile(df)) {
        if (!seen.has(ref.raw)) {
          seen.add(ref.raw);
          out.refs.push(ref);
        }
      }
    }
    for (const cf of composes) {
      for (const ref of extractFromCompose(cf)) {
        if (!seen.has(ref.raw)) {
          seen.add(ref.raw);
          out.refs.push(ref);
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Docker exec helpers (proxies always unset)
// ---------------------------------------------------------------------------

/**
 * Build a child-process env that explicitly drops shell-level proxy vars.
 * The Clash shell proxy on this host (127.0.0.1:7890) hijacks docker pulls.
 */
function envWithoutProxies(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.all_proxy;
  delete env.ALL_PROXY;
  return env;
}

async function dockerInfoOk(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], {
      timeout: 15_000,
      env: envWithoutProxies(),
    });
    return true;
  } catch {
    return false;
  }
}

async function imageExistsLocally(imageRef: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('docker', [
      'images', '--format', '{{.Repository}}:{{.Tag}}',
    ], { timeout: 15_000, env: envWithoutProxies() });
    const refNoDigest = imageRef.split('@')[0];
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.includes(refNoDigest);
  } catch {
    return false;
  }
}

/** Streams docker pull output to stdout so the user can watch progress. */
function dockerPullStreaming(imageRef: string): { ok: boolean; error?: string } {
  const opts: SpawnSyncOptions = {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: envWithoutProxies(),
  };
  // Strip @sha256 digest for human-friendly pull (digest will still be enforced via tag)
  const result = spawnSync('docker', ['pull', imageRef], opts);
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: `exit code ${result.status}` };
  }
  return { ok: true };
}

function sanitizeForFilename(imageRef: string): string {
  return imageRef.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function dockerSaveStreaming(imageRef: string, outDir: string): { ok: boolean; error?: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, sanitizeForFilename(imageRef) + '.tar');
  const result = spawnSync('docker', ['save', '-o', out, imageRef], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: envWithoutProxies(),
  });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: `exit code ${result.status}` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

interface BenchmarkManifestEntry {
  images: string[];
  status: 'ready' | 'partial' | 'skipped' | 'failed';
  notes: string | null;
}

interface DockerManifest {
  generatedAt: string;
  schemaVersion: number;
  benchmarks: Record<string, BenchmarkManifestEntry>;
}

function readManifest(): DockerManifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      benchmarks: {},
    };
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as DockerManifest;
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      benchmarks: {},
    };
  }
}

function writeManifest(m: DockerManifest): void {
  fs.mkdirSync(DOCKER_CACHE_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printUsage();
    return;
  }

  console.log('=== Docker Image Pre-pull ===');
  console.log(`evalEngine: ${EVAL_ENGINE}`);
  console.log(`manifest:   ${MANIFEST_PATH}`);
  console.log(`flags:      dryRun=${flags.dryRun} force=${flags.force} save=${flags.save} benchmark=${flags.benchmark ?? '*'}`);
  console.log('');

  // 1. Daemon health check (skip in dry-run because we still want plan output)
  if (!flags.dryRun) {
    const ok = await dockerInfoOk();
    if (!ok) {
      console.error('docker info failed — daemon may be down or current user lacks access.');
      console.error('Install/start Docker, or run with --dry-run to inspect the plan only.');
      process.exit(2);
    }
  }

  // 2. Load benchmarks
  let benchmarks: BenchmarkEntry[];
  try {
    benchmarks = loadDockerBenchmarks();
  } catch (err: any) {
    console.error('Failed to load catalog.yaml:', err.message);
    process.exit(2);
  }
  if (flags.benchmark) {
    benchmarks = benchmarks.filter(b => b.name === flags.benchmark);
    if (benchmarks.length === 0) {
      console.error(`No needs_docker benchmark named "${flags.benchmark}" in catalog.yaml.`);
      process.exit(2);
    }
  }
  console.log(`Found ${benchmarks.length} benchmark(s) with needs_docker: true.\n`);

  // 3. Extract images per benchmark
  const extractions: BenchmarkExtraction[] = [];
  for (const b of benchmarks) {
    extractions.push(extractImagesForBenchmark(b));
  }

  // 4. Print plan
  console.log('--- Plan ---');
  console.log(pad('benchmark', 22) + pad('pullable', 10) + pad('skipped (local-build)', 24) + 'images');
  console.log('-'.repeat(80));
  for (const e of extractions) {
    const pullable = e.refs.filter(r => r.pullable).map(r => r.raw);
    const local = e.refs.filter(r => !r.pullable).map(r => r.raw);
    const summary = pullable.length
      ? pullable.slice(0, 3).join(', ') + (pullable.length > 3 ? ', …' : '')
      : '(none)';
    console.log(
      pad(e.benchmark, 22) +
      pad(String(pullable.length), 10) +
      pad(String(local.length), 24) +
      summary,
    );
    for (const w of e.warnings) {
      console.log(`  ! warning: ${w}`);
    }
  }
  console.log('');

  if (flags.dryRun) {
    console.log('Dry run — exiting without pulling. Re-run without --dry-run to execute.');
    return;
  }

  // 5. Execute: pull each pullable image once (deduped across benchmarks)
  const manifest = readManifest();
  manifest.generatedAt = new Date().toISOString();
  manifest.schemaVersion = 1;

  // Deduplicate pullable refs across all benchmarks
  const allPullable = new Map<string, { ref: ImageRef; benchmarks: string[] }>();
  for (const e of extractions) {
    for (const r of e.refs) {
      if (!r.pullable) continue;
      const key = r.raw;
      if (!allPullable.has(key)) allPullable.set(key, { ref: r, benchmarks: [] });
      allPullable.get(key)!.benchmarks.push(e.benchmark);
    }
  }

  console.log(`--- Pull (${allPullable.size} unique image(s)) ---\n`);
  const pullResults = new Map<string, { ok: boolean; error?: string; skipped?: boolean }>();
  for (const [imgRef] of allPullable) {
    let exists = false;
    if (!flags.force) {
      exists = await imageExistsLocally(imgRef);
    }
    if (exists) {
      console.log(`[skip] ${imgRef} (already present)`);
      pullResults.set(imgRef, { ok: true, skipped: true });
      continue;
    }
    console.log(`[pull] ${imgRef}`);
    const r = dockerPullStreaming(imgRef);
    pullResults.set(imgRef, r);
    if (!r.ok) {
      console.log(`  -> FAILED: ${r.error}`);
    } else {
      console.log(`  -> OK`);
    }
    console.log('');
  }

  // 6. Optional save
  if (flags.save) {
    console.log(`--- Save tarballs (${DOCKER_CACHE_DIR}) ---\n`);
    for (const [imgRef, res] of pullResults) {
      if (!res.ok) continue;
      console.log(`[save] ${imgRef}`);
      const r = dockerSaveStreaming(imgRef, DOCKER_CACHE_DIR);
      if (!r.ok) {
        console.log(`  -> FAILED: ${r.error}`);
      } else {
        console.log(`  -> OK`);
      }
    }
  }

  // 7. Write manifest
  for (const e of extractions) {
    const pullableList = e.refs.filter(r => r.pullable).map(r => r.raw);
    const localList = e.refs.filter(r => !r.pullable).map(r => r.raw);

    let status: BenchmarkManifestEntry['status'] = 'ready';
    let notes: string | null = null;

    if (pullableList.length === 0 && localList.length === 0) {
      status = 'skipped';
      notes = e.warnings.length
        ? e.warnings.join('; ')
        : 'No image references extracted; manual config may be needed';
    } else {
      const failed = pullableList.filter(img => {
        const r = pullResults.get(img);
        return !r || !r.ok;
      });
      if (failed.length === pullableList.length && pullableList.length > 0) {
        status = 'failed';
        notes = `Failed pulls: ${failed.join(', ')}`;
      } else if (failed.length > 0) {
        status = 'partial';
        notes = `Failed pulls: ${failed.join(', ')}`;
      } else if (localList.length > 0 && pullableList.length === 0) {
        status = 'skipped';
        notes = `All references are local-build (built on demand by inspect_ai); ` +
          `eg ${localList.slice(0, 2).join(', ')}`;
      } else {
        status = 'ready';
        if (localList.length > 0) {
          notes = `Local-build refs (built on demand): ${localList.join(', ')}`;
        }
      }
    }

    manifest.benchmarks[e.benchmark] = {
      images: [...pullableList, ...localList],
      status,
      notes,
    };
  }
  writeManifest(manifest);
  console.log(`\nManifest written: ${MANIFEST_PATH}`);

  // 8. Summary
  const benches = Object.values(manifest.benchmarks);
  const ready = benches.filter(b => b.status === 'ready').length;
  const partial = benches.filter(b => b.status === 'partial').length;
  const skipped = benches.filter(b => b.status === 'skipped').length;
  const failed = benches.filter(b => b.status === 'failed').length;
  console.log('\n=== Summary ===');
  console.log(`ready:   ${ready}`);
  console.log(`partial: ${partial}`);
  console.log(`skipped: ${skipped}`);
  console.log(`failed:  ${failed}`);

  // Exit code: 0 unless ALL benchmarks failed
  if (failed > 0 && ready === 0 && partial === 0) {
    process.exit(1);
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s + ' ';
  return s + ' '.repeat(n - s.length);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
