/**
 * verify-offline.ts
 *
 * Comprehensive offline verification for all 69 benchmarks × 139 tasks.
 * Runs 5 layers of checks and produces JSON + Markdown reports.
 *
 * Usage:
 *   npx ts-node scripts/verify-offline.ts              # Full verification
 *   npx ts-node scripts/verify-offline.ts --phase=1    # Static only
 *   npx ts-node scripts/verify-offline.ts --check-only # Skip venv building
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import catalogService from '../src/services/catalogService';
import { loadIndexFile, getIndexPath } from '../src/services/indexService';
import { buildInspectCommand } from '../src/services/commandBuilder';
import { buildEnvironment, resolveJudgeModel } from '../src/services/environmentBuilder';
import { checkAllDatasetStatus } from '../src/services/datasetService';
import { getInspectPath, getPythonPath, getVenvPath } from '../src/services/venvService';
import { config } from '../src/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckResult {
  benchmark: string;
  task?: string;
  layer: number;
  check: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface LayerSummary {
  layer: number;
  name: string;
  passed: number;
  failed: number;
  warned: number;
  total: number;
}

interface FullReport {
  timestamp: string;
  layers: LayerSummary[];
  results: CheckResult[];
  overallStatus: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL';
  dockerBenchmarks: string[];
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const EVAL_ENGINE = config.evalPocRoot;
const INDEXES_DIR = path.join(EVAL_ENGINE, 'benchmarks', 'indexes');
const LOCAL_BENCH_DIR = path.join(EVAL_ENGINE, 'benchmarks', 'eval_benchmarks');
const DATASETS_CACHE = path.join(EVAL_ENGINE, 'datasets-cache');
const results: CheckResult[] = [];

function add(r: Omit<CheckResult, 'severity'>): void {
  results.push({ ...r, severity: r.passed ? 'info' : 'error' });
}
function warn(r: Omit<CheckResult, 'severity' | 'passed'>): void {
  results.push({ ...r, passed: true, severity: 'warning' });
}

// ---------------------------------------------------------------------------
// Layer 1: Static File Verification
// ---------------------------------------------------------------------------

function layer1Static(): void {
  console.log('\n=== Layer 1: Static File Verification ===\n');
  const benchmarks = catalogService.getAllBenchmarks();

  for (const bench of benchmarks) {
    // Index directory
    const idxDir = path.join(INDEXES_DIR, bench.name);
    add({
      benchmark: bench.name, layer: 1,
      check: 'index_dir_exists',
      passed: fs.existsSync(idxDir),
      message: fs.existsSync(idxDir) ? 'OK' : `Missing: ${idxDir}`,
    });

    // SELECTION_REPORT.md
    const reportPath = path.join(idxDir, 'SELECTION_REPORT.md');
    const hasReport = fs.existsSync(reportPath);
    if (!hasReport) {
      warn({
        benchmark: bench.name, layer: 1,
        check: 'selection_report',
        message: 'SELECTION_REPORT.md missing',
      });
    }

    // Task index files
    for (const task of bench.tasks) {
      const indexPath = getIndexPath(bench.name, task.name);
      const exists = fs.existsSync(indexPath);
      let parseable = false;
      let sampleCount = 0;
      if (exists) {
        const data = loadIndexFile(indexPath);
        parseable = data !== null;
        sampleCount = data?.sampleIds?.length ?? 0;
      }
      add({
        benchmark: bench.name, task: task.name, layer: 1,
        check: 'index_yaml_exists',
        passed: exists,
        message: exists ? `OK (${sampleCount} samples)` : `Missing: ${indexPath}`,
      });
      if (exists) {
        add({
          benchmark: bench.name, task: task.name, layer: 1,
          check: 'index_yaml_parseable',
          passed: parseable,
          message: parseable ? 'OK' : 'YAML parse failed',
        });
      }
    }

    // Local benchmark code
    if (bench.source === 'local') {
      const moduleName = bench.module.split('/').pop() || '';
      const localDir = path.join(LOCAL_BENCH_DIR, moduleName);
      const initPy = path.join(localDir, '__init__.py');
      add({
        benchmark: bench.name, layer: 1,
        check: 'local_code_dir',
        passed: fs.existsSync(localDir),
        message: fs.existsSync(localDir) ? 'OK' : `Missing: ${localDir}`,
      });
      if (fs.existsSync(localDir)) {
        add({
          benchmark: bench.name, layer: 1,
          check: 'local_init_py',
          passed: fs.existsSync(initPy),
          message: fs.existsSync(initPy) ? 'OK' : `Missing __init__.py`,
        });
      }
    }
  }

  const l1 = results.filter(r => r.layer === 1);
  const pass = l1.filter(r => r.passed).length;
  const fail = l1.filter(r => !r.passed && r.severity === 'error').length;
  console.log(`  Checks: ${l1.length}, Passed: ${pass}, Failed: ${fail}`);
}

// ---------------------------------------------------------------------------
// Layer 2: Venv Health
// ---------------------------------------------------------------------------

function layer2Venvs(): void {
  console.log('\n=== Layer 2: Venv Health ===\n');
  const benchmarks = catalogService.getAllBenchmarks();

  for (const bench of benchmarks) {
    const venvPath = getVenvPath(bench.name);
    const inspectPath = getInspectPath(bench.name);
    const pythonPath = getPythonPath(bench.name);
    const markerPath = path.join(venvPath, '.eval-poc-marker.json');

    // Venv exists
    const venvExists = fs.existsSync(venvPath);
    add({
      benchmark: bench.name, layer: 2,
      check: 'venv_exists',
      passed: venvExists,
      message: venvExists ? 'OK' : `Missing: ${venvPath}`,
    });

    if (!venvExists) continue;

    // bin/inspect exists
    const inspExists = fs.existsSync(inspectPath);
    add({
      benchmark: bench.name, layer: 2,
      check: 'inspect_binary',
      passed: inspExists,
      message: inspExists ? 'OK' : 'bin/inspect missing',
    });

    // bin/python exists
    const pyExists = fs.existsSync(pythonPath);
    add({
      benchmark: bench.name, layer: 2,
      check: 'python_binary',
      passed: pyExists,
      message: pyExists ? 'OK' : 'bin/python missing',
    });

    // Marker file
    let markerValid = false;
    if (fs.existsSync(markerPath)) {
      try {
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        markerValid = !!marker.inspect_ai && !!marker.inspect_evals;
        add({
          benchmark: bench.name, layer: 2,
          check: 'marker_valid',
          passed: markerValid,
          message: markerValid
            ? `inspect_ai=${marker.inspect_ai}, inspect_evals=${marker.inspect_evals}`
            : 'Marker has null versions',
        });
      } catch {
        add({
          benchmark: bench.name, layer: 2,
          check: 'marker_valid',
          passed: false,
          message: 'Marker JSON parse failed',
        });
      }
    } else {
      add({
        benchmark: bench.name, layer: 2,
        check: 'marker_valid',
        passed: false,
        message: 'Marker file missing',
      });
    }

    // Import check (only if python exists)
    if (pyExists) {
      try {
        execFileSync(pythonPath, ['-c', 'import inspect_evals'], {
          timeout: 15_000, encoding: 'utf-8', stdio: 'pipe',
        });
        add({
          benchmark: bench.name, layer: 2,
          check: 'import_inspect_evals',
          passed: true, message: 'OK',
        });
      } catch (err: any) {
        add({
          benchmark: bench.name, layer: 2,
          check: 'import_inspect_evals',
          passed: false,
          message: `Import failed: ${(err.stderr || err.message || '').slice(0, 200)}`,
        });
      }
    }
  }

  const l2 = results.filter(r => r.layer === 2);
  const pass = l2.filter(r => r.passed).length;
  const fail = l2.filter(r => !r.passed && r.severity === 'error').length;
  console.log(`  Checks: ${l2.length}, Passed: ${pass}, Failed: ${fail}`);
}

// ---------------------------------------------------------------------------
// Layer 3: Dataset Availability
// ---------------------------------------------------------------------------

function layer3Datasets(): void {
  console.log('\n=== Layer 3: Dataset Availability ===\n');

  // Use existing checkAllDatasetStatus
  const statuses = checkAllDatasetStatus();
  for (const s of statuses) {
    add({
      benchmark: s.benchmark, layer: 3,
      check: 'dataset_status',
      passed: s.ready,
      message: s.message,
    });
  }

  // Check local benchmarks have data
  const benchmarks = catalogService.getAllBenchmarks();
  for (const bench of benchmarks) {
    if (bench.source !== 'local') continue;
    const moduleName = bench.module.split('/').pop() || '';
    const dataDir = path.join(LOCAL_BENCH_DIR, moduleName, 'data');
    const hasData = fs.existsSync(dataDir);
    // Some local benchmarks may not have a data/ dir (data in code)
    if (hasData) {
      add({
        benchmark: bench.name, layer: 3,
        check: 'local_data_dir',
        passed: true,
        message: `Local data: ${dataDir}`,
      });
    }
  }

  // Verify key cache dirs
  const dsDir = path.join(DATASETS_CACHE, 'datasets');
  const hubDir = path.join(DATASETS_CACHE, 'hub');
  const inspDir = path.join(DATASETS_CACHE, 'inspect_evals');

  const dsCount = fs.existsSync(dsDir) ? fs.readdirSync(dsDir).length : 0;
  const hubCount = fs.existsSync(hubDir) ? fs.readdirSync(hubDir).length : 0;
  const inspCount = fs.existsSync(inspDir) ? fs.readdirSync(inspDir).length : 0;

  add({
    benchmark: '_global', layer: 3,
    check: 'cache_datasets_dir',
    passed: dsCount > 30,
    message: `${dsCount} dataset dirs`,
  });
  add({
    benchmark: '_global', layer: 3,
    check: 'cache_hub_dir',
    passed: hubCount > 30,
    message: `${hubCount} hub dirs`,
  });
  add({
    benchmark: '_global', layer: 3,
    check: 'cache_inspect_dir',
    passed: inspCount > 15,
    message: `${inspCount} inspect_evals dirs`,
  });

  const l3 = results.filter(r => r.layer === 3);
  const pass = l3.filter(r => r.passed).length;
  const fail = l3.filter(r => !r.passed && r.severity === 'error').length;
  console.log(`  Checks: ${l3.length}, Passed: ${pass}, Failed: ${fail}`);
}

// ---------------------------------------------------------------------------
// Layer 4: Command Construction
// ---------------------------------------------------------------------------

function layer4Commands(): void {
  console.log('\n=== Layer 4: Command Construction ===\n');
  const benchmarks = catalogService.getAllBenchmarks();
  const models = catalogService.getModels();

  for (const bench of benchmarks) {
    const cfg = catalogService.getBenchmarkConfig(bench.name);
    if (!cfg) {
      add({
        benchmark: bench.name, layer: 4,
        check: 'config_exists',
        passed: false,
        message: 'getBenchmarkConfig returned null',
      });
      continue;
    }

    const inspectPath = getInspectPath(bench.name);

    for (const task of cfg.tasks) {
      // Build command
      try {
        const { effectiveJudge, env: judgeEnv } = resolveJudgeModel(
          null, cfg as any, models,
        );

        // Load index
        const indexPath = getIndexPath(bench.name, task.name);
        const indexData = loadIndexFile(indexPath);
        const sampleIds = indexData?.sampleIds ?? null;
        const indexMode = indexData?.mode ?? null;

        const cmd = buildInspectCommand({
          inspectPath,
          taskSpec: task.path || `${cfg.module}/${task.name}`,
          modelForInspect: 'openai/test-model',
          effectiveJudge,
          judgeParam: cfg.judgeParam,
          modelRoles: cfg.modelRoles,
          taskArgs: task.taskArgs,
          sampleIds,
          indexMode,
          catalogModels: models,
        });

        add({
          benchmark: bench.name, task: task.name, layer: 4,
          check: 'command_builds',
          passed: true,
          message: `OK (${cmd.length} args, ${sampleIds?.length ?? 0} sample IDs)`,
        });

        // Verify inspect binary path exists (if venv is ready)
        const binExists = fs.existsSync(inspectPath);
        add({
          benchmark: bench.name, task: task.name, layer: 4,
          check: 'inspect_path_valid',
          passed: binExists,
          message: binExists ? 'OK' : `inspect binary not found: ${inspectPath}`,
        });

        // Verify index has samples
        if (indexData) {
          add({
            benchmark: bench.name, task: task.name, layer: 4,
            check: 'index_has_samples',
            passed: indexData.sampleIds.length > 0,
            message: `${indexData.sampleIds.length} samples (${indexData.mode})`,
          });
        }
      } catch (err: any) {
        add({
          benchmark: bench.name, task: task.name, layer: 4,
          check: 'command_builds',
          passed: false,
          message: `Build failed: ${err.message}`,
        });
      }
    }
  }

  const l4 = results.filter(r => r.layer === 4);
  const pass = l4.filter(r => r.passed).length;
  const fail = l4.filter(r => !r.passed && r.severity === 'error').length;
  console.log(`  Checks: ${l4.length}, Passed: ${pass}, Failed: ${fail}`);
}

// ---------------------------------------------------------------------------
// Layer 5: Task Import Verification
// ---------------------------------------------------------------------------

function layer5TaskImport(): void {
  console.log('\n=== Layer 5: Task Import ===\n');
  const benchmarks = catalogService.getAllBenchmarks();
  const dockerBenchmarks = new Set(benchmarks.filter(b => b.needsDocker).map(b => b.name));

  for (const bench of benchmarks) {
    const pythonPath = getPythonPath(bench.name);
    if (!fs.existsSync(pythonPath)) {
      for (const task of bench.tasks) {
        add({
          benchmark: bench.name, task: task.name, layer: 5,
          check: 'task_import',
          passed: false,
          message: 'Skipped: no venv python',
        });
      }
      continue;
    }

    // Use bench.module (Python package) for import, not task.path (inspect eval spec)
    // bench.module is like "inspect_evals/fortress" or "eval_benchmarks/saferag"
    const importPath = bench.module.replace(/\//g, '.');

    for (const task of bench.tasks) {
      const pyCode = [
        'import os',
        "os.environ['HF_DATASETS_OFFLINE']='1'",
        "os.environ['HF_HUB_OFFLINE']='1'",
        "os.environ['TRANSFORMERS_OFFLINE']='1'",
        `os.environ['HF_HOME']='${DATASETS_CACHE}'`,
        `os.environ['HF_DATASETS_CACHE']='${path.join(DATASETS_CACHE, 'datasets')}'`,
        `os.environ['INSPECT_EVALS_CACHE_PATH']='${path.join(DATASETS_CACHE, 'inspect_evals')}'`,
        `import ${importPath}`,
        `print('OK')`,
      ].join('; ');

      try {
        const out = execFileSync(pythonPath, ['-c', pyCode], {
          timeout: 30_000,
          encoding: 'utf-8',
          stdio: 'pipe',
          env: {
            ...process.env,
            HF_DATASETS_OFFLINE: '1',
            HF_HUB_OFFLINE: '1',
            TRANSFORMERS_OFFLINE: '1',
            HF_HOME: DATASETS_CACHE,
            HF_DATASETS_CACHE: path.join(DATASETS_CACHE, 'datasets'),
            INSPECT_EVALS_CACHE_PATH: path.join(DATASETS_CACHE, 'inspect_evals'),
          },
        });
        add({
          benchmark: bench.name, task: task.name, layer: 5,
          check: 'task_import',
          passed: true,
          message: `OK (${out.trim()})`,
        });
      } catch (err: any) {
        const stderr = (err.stderr || '').toString();
        const isDocker = dockerBenchmarks.has(bench.name);
        // Some Docker benchmarks fail import due to missing Docker deps
        add({
          benchmark: bench.name, task: task.name, layer: 5,
          check: 'task_import',
          passed: false,
          message: `${isDocker ? '[Docker] ' : ''}Import failed: ${stderr.split('\n').filter((l: string) => l.trim()).pop()?.slice(0, 200) || err.message}`,
        });
      }
    }
  }

  const l5 = results.filter(r => r.layer === 5);
  const pass = l5.filter(r => r.passed).length;
  const fail = l5.filter(r => !r.passed && r.severity === 'error').length;
  console.log(`  Checks: ${l5.length}, Passed: ${pass}, Failed: ${fail}`);
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(): FullReport {
  const benchmarks = catalogService.getAllBenchmarks();
  const dockerBenchmarks = benchmarks.filter(b => b.needsDocker).map(b => b.name);

  const layers: LayerSummary[] = [];
  for (let i = 1; i <= 5; i++) {
    const lr = results.filter(r => r.layer === i);
    layers.push({
      layer: i,
      name: ['', 'Static Files', 'Venv Health', 'Dataset Availability', 'Command Construction', 'Task Import'][i],
      passed: lr.filter(r => r.passed && r.severity !== 'warning').length,
      failed: lr.filter(r => !r.passed).length,
      warned: lr.filter(r => r.severity === 'warning').length,
      total: lr.length,
    });
  }

  // Overall status: PASS if no layer has errors, CONDITIONAL_PASS if only Docker benchmarks fail
  const nonDockerFails = results.filter(r =>
    !r.passed && r.severity === 'error' &&
    !dockerBenchmarks.includes(r.benchmark) &&
    r.benchmark !== '_global',
  );
  const allFails = results.filter(r => !r.passed && r.severity === 'error');

  let overallStatus: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL';
  if (allFails.length === 0) {
    overallStatus = 'PASS';
  } else if (nonDockerFails.length === 0) {
    overallStatus = 'CONDITIONAL_PASS';
  } else {
    overallStatus = 'FAIL';
  }

  return {
    timestamp: new Date().toISOString(),
    layers,
    results,
    overallStatus,
    dockerBenchmarks,
  };
}

function writeJsonReport(report: FullReport): void {
  const outPath = path.join(EVAL_ENGINE, 'verify-offline-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report: ${outPath}`);
}

function writeMarkdownReport(report: FullReport): void {
  const lines: string[] = [];
  lines.push('# 离线验证报告 / Offline Verification Report');
  lines.push('');
  lines.push(`> 生成时间: ${report.timestamp}`);
  lines.push(`> 总体状态: **${report.overallStatus}**`);
  lines.push('');

  // Summary table
  lines.push('## 各层验证结果');
  lines.push('');
  lines.push('| Layer | 名称 | 通过 | 失败 | 警告 | 总计 |');
  lines.push('|-------|------|------|------|------|------|');
  for (const l of report.layers) {
    lines.push(`| ${l.layer} | ${l.name} | ${l.passed} | ${l.failed} | ${l.warned} | ${l.total} |`);
  }
  lines.push('');

  // Per-benchmark summary
  lines.push('## 各基准验证状态');
  lines.push('');
  const benchmarks = catalogService.getAllBenchmarks();
  lines.push('| 基准 | Source | Docker | L1 | L2 | L3 | L4 | L5 | 状态 |');
  lines.push('|------|--------|--------|----|----|----|----|----|----|');

  for (const bench of benchmarks) {
    const benchResults = report.results.filter(r => r.benchmark === bench.name);
    const statusByLayer: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const lr = benchResults.filter(r => r.layer === i);
      if (lr.length === 0) {
        statusByLayer.push('-');
      } else if (lr.every(r => r.passed)) {
        statusByLayer.push('PASS');
      } else {
        statusByLayer.push('FAIL');
      }
    }
    const allPass = statusByLayer.every(s => s === 'PASS' || s === '-');
    const docker = bench.needsDocker ? 'Yes' : '';
    const status = allPass ? 'PASS' : (bench.needsDocker ? 'DOCKER' : 'FAIL');
    lines.push(`| ${bench.name} | ${bench.source} | ${docker} | ${statusByLayer.join(' | ')} | ${status} |`);
  }
  lines.push('');

  // Failures detail
  const failures = report.results.filter(r => !r.passed && r.severity === 'error');
  if (failures.length > 0) {
    lines.push('## 失败详情');
    lines.push('');
    lines.push('| 基准 | Task | Layer | Check | 信�� |');
    lines.push('|------|------|-------|-------|------|');
    for (const f of failures.slice(0, 200)) {
      lines.push(`| ${f.benchmark} | ${f.task || '-'} | ${f.layer} | ${f.check} | ${f.message.slice(0, 120)} |`);
    }
    if (failures.length > 200) {
      lines.push(`\n> ... 另有 ${failures.length - 200} 条失败记录，见 verify-offline-report.json`);
    }
    lines.push('');
  }

  // Docker benchmarks
  lines.push('## Docker 依赖基准（14 个）');
  lines.push('');
  lines.push('以下基准需要 Docker 运行时，离线验证仅检查代码/配置，不验证容器执行：');
  lines.push('');
  for (const name of report.dockerBenchmarks) {
    lines.push(`- ${name}`);
  }
  lines.push('');

  const outPath = path.join(config.evalPocRoot, '..', '..', 'docs', 'OFFLINE_VERIFICATION.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`Markdown report: ${outPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const phaseArg = process.argv.find(a => a.startsWith('--phase='));
  const phase = phaseArg ? parseInt(phaseArg.split('=')[1], 10) : 0;

  console.log('========================================');
  console.log(' Offline Verification: 69 benchmarks × 139 tasks');
  console.log('========================================');

  if (phase === 0 || phase === 1) layer1Static();
  if (phase === 0 || phase === 2) layer2Venvs();
  if (phase === 0 || phase === 3) layer3Datasets();
  if (phase === 0 || phase === 4) layer4Commands();
  if (phase === 0 || phase === 5) layer5TaskImport();

  const report = generateReport();

  console.log('\n========================================');
  console.log(` Overall Status: ${report.overallStatus}`);
  console.log('========================================');

  for (const l of report.layers) {
    const icon = l.failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  Layer ${l.layer} (${l.name}): ${icon} — ${l.passed}/${l.total} passed, ${l.failed} failed`);
  }

  writeJsonReport(report);
  writeMarkdownReport(report);

  const totalFailed = report.layers.reduce((s, l) => s + l.failed, 0);
  if (totalFailed > 0 && report.overallStatus === 'FAIL') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
