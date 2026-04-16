#!/usr/bin/env python3
"""
DEPRECATED: This file is superseded by TypeScript services:
  - server/src/services/evalRunner.ts (orchestration)
  - server/src/services/venvService.ts (venv management)
  - server/src/services/commandBuilder.ts (CLI args)
  - server/src/services/environmentBuilder.ts (env vars)
  - server/src/services/indexService.ts (index files)
  - server/src/services/dockerService.ts (Docker lifecycle)
Retained for reference only. Will be removed in a future release.

---

统一 Eval 入口脚本 - 每个 benchmark 使用独立虚拟环境

用法:
    ./run-eval.py <benchmark>[:<task>] --model <model_name> [options]

示例:
    ./run-eval.py strong_reject --model doubao-seed-1-8-251228
    ./run-eval.py cyberseceval_2:cyse2_interpreter_abuse --model doubao-seed-1-8-251228
    ./run-eval.py truthfulqa --model doubao-seed-1-8-251228 --limit 10

一键测评:
    ./run-eval.py --run-all --model <model_name>    # 运行所有 benchmark
    ./run-eval.py --preflight                        # 仅运行预检查

环境管理:
    ./run-eval.py --setup <benchmark>    # 仅设置环境，不运行
    ./run-eval.py --setup-all            # 设置所有 benchmark 环境
    ./run-eval.py --check-venvs          # 审计所有 venvs，报告可用更新
    ./run-eval.py --update-all           # 升级所有 venvs 到最新 PyPI 版本
"""
from __future__ import annotations

import argparse
import fcntl
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

# 导入预检查模块
sys.path.insert(0, str(Path(__file__).parent / "benchmarks"))
from preflight import (
    JudgeModelConfig,
    run_preflight_checks,
    print_preflight_report,
    get_required_permissions,
)


# 项目根目录
PROJECT_ROOT = Path(__file__).parent.resolve()
VENVS_DIR = PROJECT_ROOT / ".venvs"
LOCAL_BENCH_DIR = PROJECT_ROOT / "benchmarks" / "eval_benchmarks"
INDEXES_DIR = PROJECT_ROOT / "benchmarks" / "indexes"
TOOLS_DIR = PROJECT_ROOT / "benchmarks" / "tools"


MARKER_FILE = ".eval-poc-marker.json"
PATCHES_DIR = PROJECT_ROOT / "benchmarks" / "patches"

# Post-install patches: benchmark_name -> list of (site-packages relative target, patch source file)
# These are applied after venv creation/upgrade to fix upstream bugs.
VENV_PATCHES = {
    "makemesay": [
        ("inspect_evals/makemesay/utils.py", PATCHES_DIR / "makemesay_utils.py"),
    ],
    "osworld": [
        ("inspect_evals/osworld/sparse_clone.py", PATCHES_DIR / "osworld_sparse_clone.py"),
    ],
}


def load_catalog():
    """加载 benchmark 路由配置"""
    catalog_path = PROJECT_ROOT / "benchmarks" / "catalog.yaml"
    with open(catalog_path, "r") as f:
        return yaml.safe_load(f)


def _get_installed_version(venv_path: Path, package: str) -> str | None:
    """Get installed version of a package in a venv."""
    try:
        result = subprocess.run(
            ["uv", "pip", "show", "-p", str(venv_path), package],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if line.startswith("Version:"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return None


def _write_marker(venv_path: Path, source: str, extras: list[str] | None = None):
    """Write version tracking marker after successful setup/upgrade."""
    marker = {
        "inspect_ai": _get_installed_version(venv_path, "inspect-ai"),
        "inspect_evals": _get_installed_version(venv_path, "inspect-evals"),
        "source": source,
        "extras": extras or [],
        "created": datetime.now(timezone.utc).isoformat(),
    }
    marker_path = venv_path / MARKER_FILE
    marker_path.write_text(json.dumps(marker, indent=2))


def _read_marker(venv_path: Path) -> dict | None:
    """Read version tracking marker from a venv."""
    marker_path = venv_path / MARKER_FILE
    if not marker_path.exists():
        return None
    try:
        return json.loads(marker_path.read_text())
    except Exception:
        return None


def _check_pypi_updates(venv_path: Path, marker: dict, timeout: float = 8.0) -> bool:
    """Check if PyPI has newer versions of inspect-ai or inspect-evals.

    Returns True if updates are available, False otherwise.
    Uses `uv pip install --dry-run --upgrade` for fast check.
    """
    try:
        result = subprocess.run(
            ["uv", "pip", "install", "-p", str(venv_path),
             "--dry-run", "--upgrade", "inspect-ai", "inspect-evals"],
            capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            return False
        # If dry-run output contains "Would install" or "Would upgrade", updates exist
        output = result.stdout + result.stderr
        return "Would install" in output or "Would upgrade" in output
    except subprocess.TimeoutExpired:
        print("  PyPI update check timed out, using existing venv")
        return False
    except Exception:
        return False


def _upgrade_venv(venv_path: Path, extras: list[str] | None = None) -> bool:
    """Upgrade inspect-ai and inspect-evals in an existing venv."""
    print("  Upgrading inspect-ai + inspect-evals...")

    result = subprocess.run(
        ["uv", "pip", "install", "-p", str(venv_path),
         "--upgrade", "inspect-ai"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  Warning: inspect-ai upgrade failed: {result.stderr[:200]}")
        return False

    install_spec = "inspect-evals"
    if extras:
        install_spec = f"inspect-evals[{','.join(extras)}]"

    result = subprocess.run(
        ["uv", "pip", "install", "-p", str(venv_path),
         "--upgrade", install_spec],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  Warning: inspect-evals upgrade failed: {result.stderr[:200]}")
        return False

    return True


def sanitize_model_name(model_name: str) -> str:
    """处理模型名称：斜杠替换为下划线"""
    return model_name.replace("/", "_")


def normalize_model_name(model_name: str) -> str:
    """
    规范化模型名称为 inspect_ai 所需格式。
    如果模型名称不包含 '/'，则默认添加 'openai/' 前缀。
    """
    if "/" not in model_name:
        return f"openai/{model_name}"
    return model_name


def _apply_patches(benchmark_name: str, venv_path: Path) -> None:
    """Apply post-install patches to a venv's site-packages.

    Patches fix upstream bugs (e.g., SSL errors when downloading data).
    Patch source files live in benchmarks/patches/.
    """
    patches = VENV_PATCHES.get(benchmark_name, [])

    # Find site-packages directory
    site_packages = list(venv_path.glob("lib/python*/site-packages"))
    if not site_packages:
        if patches:
            print(f"  警告: 无法找到 site-packages 目录，跳过补丁")
        return
    sp = site_packages[0]

    for target_rel, patch_src in patches:
        target = sp / target_rel
        if not patch_src.exists():
            print(f"  警告: 补丁源文件不存在: {patch_src}")
            continue
        if not target.parent.exists():
            print(f"  警告: 补丁目标目录不存在: {target.parent}")
            continue
        shutil.copy2(patch_src, target)
        print(f"  已应用补丁: {target_rel}")

    # Special: threecb Dockerfile patching (replace base images to avoid runtime apt-get)
    if benchmark_name == "threecb":
        _patch_threecb_dockerfiles(sp)


def _patch_threecb_dockerfiles(site_packages: Path) -> None:
    """Patch threecb Dockerfiles to use pre-built base images.

    Pre-built images (threecb-debian-base, threecb-alpine-base) contain ALL
    apt/apk packages, eliminating runtime downloads that fail through proxy.
    """
    task_configs = site_packages / "inspect_evals" / "threecb" / "task_configs"
    if not task_configs.exists():
        return

    patched = 0
    for dockerfile in task_configs.rglob("Dockerfile"):
        content = dockerfile.read_text()
        lines = content.split('\n')
        new_lines = []
        skip_continuation = False

        for line in lines:
            stripped = line.strip()
            if skip_continuation:
                if stripped.endswith('\\'):
                    continue
                skip_continuation = False
                continue

            if stripped.startswith('FROM debian:stable'):
                new_lines.append('FROM threecb-debian-base')
                continue
            if stripped.startswith('FROM alpine:'):
                new_lines.append('FROM threecb-alpine-base')
                continue
            if stripped.startswith('RUN apt-get') or stripped.startswith('RUN apk'):
                if stripped.endswith('\\'):
                    skip_continuation = True
                continue

            new_lines.append(line)

        result = '\n'.join(new_lines)
        while '\n\n\n' in result:
            result = result.replace('\n\n\n', '\n\n')
        result = result.strip() + '\n'
        dockerfile.write_text(result)
        patched += 1

    if patched:
        print(f"  已修补 {patched} 个 threecb Dockerfile (使用预构建基础镜像)")


def get_venv_path(benchmark_name: str) -> Path:
    """获取 benchmark 的虚拟环境路径"""
    return VENVS_DIR / benchmark_name


def get_venv_python(benchmark_name: str) -> Path:
    """获取 benchmark 虚拟环境的 Python 路径"""
    return get_venv_path(benchmark_name) / "bin" / "python"


def get_venv_inspect(benchmark_name: str) -> Path:
    """获取 benchmark 虚拟环境的 inspect 命令路径"""
    return get_venv_path(benchmark_name) / "bin" / "inspect"


def setup_benchmark_env(benchmark_name: str, config: dict, force: bool = False,
                        no_update: bool = False) -> bool:
    """
    为 benchmark 设置独立虚拟环境

    返回 True 表示成功，False 表示失败
    Uses per-benchmark file lock to prevent concurrent venv creation races.
    """
    venv_path = get_venv_path(benchmark_name)
    python_version = config.get("python", "3.10")
    extras = config.get("extras", [])
    source = config.get("source", "upstream")

    # Per-benchmark file lock to prevent concurrent venv creation
    VENVS_DIR.mkdir(parents=True, exist_ok=True)
    lock_file_path = VENVS_DIR / f"{benchmark_name}.setup.lock"
    lock_fd = open(lock_file_path, "w")
    try:
        print(f"  Acquiring setup lock for {benchmark_name}...")
        fcntl.flock(lock_fd, fcntl.LOCK_EX)

        # 检查是否已存在 (re-check under lock — another process may have created it)
        if venv_path.exists() and not force:
            inspect_path = get_venv_inspect(benchmark_name)
            if inspect_path.exists():
                # Auto-update is disabled by default — use --update-all to upgrade
                print(f"  环境已存在: {venv_path}")
                marker = _read_marker(venv_path)
                if not marker:
                    _write_marker(venv_path, source, extras)
                return True

        print(f"  创建环境: {venv_path} (Python {python_version})")

        # 创建虚拟环境 (--clear to allow recreating existing venvs)
        venv_cmd = ["uv", "venv", str(venv_path), "--python", python_version]
        if venv_path.exists():
            venv_cmd.append("--clear")
        result = subprocess.run(venv_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  错误: 创建虚拟环境失败")
            print(result.stderr)
            return False

        # 安装 inspect_ai (from PyPI)
        print(f"  安装 inspect_ai...")
        result = subprocess.run(
            ["uv", "pip", "install", "-p", str(venv_path), "inspect-ai"],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"  错误: 安装 inspect_ai 失败")
            print(result.stderr)
            return False

        # 安装 inspect_evals (from PyPI)
        install_spec = "inspect-evals"
        if extras:
            extras_str = ",".join(extras)
            install_spec = f"inspect-evals[{extras_str}]"

        extras_display = f"[{','.join(extras)}]" if extras else ""
        print(f"  安装 inspect_evals{extras_display}...")
        result = subprocess.run(
            ["uv", "pip", "install", "-p", str(venv_path), install_spec],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"  错误: 安装 inspect_evals 失败")
            print(result.stderr)
            return False

        # Always install eval_benchmarks package in every venv.
        # Some upstream benchmarks have tasks that use local wrappers
        # (e.g. assistant_bench uses eval_benchmarks/assistant_bench_web_browser_tavily).
        print(f"  安装 eval_benchmarks package...")
        benchmarks_dir = PROJECT_ROOT / "benchmarks"
        result = subprocess.run(
            ["uv", "pip", "install", "-p", str(venv_path), "-e", str(benchmarks_dir)],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"  错误: 安装 eval_benchmarks package 失败")
            print(result.stderr)
            return False

        # Local benchmark: 安装 benchmark 特有依赖 (requirements.txt)
        if source == "local":
            module_name = config.get("module", "").split("/")[-1]
            local_benchmark_dir = LOCAL_BENCH_DIR / module_name
            requirements_file = local_benchmark_dir / "requirements.txt"

            if requirements_file.exists():
                print(f"  安装 {module_name} 依赖...")
                result = subprocess.run(
                    ["uv", "pip", "install", "-p", str(venv_path), "-r", str(requirements_file)],
                    capture_output=True,
                    text=True
                )
                if result.returncode != 0:
                    print(f"  警告: 安装 {module_name} 依赖失败")
                    print(result.stderr)

        # 安装 openai (必需)
        print(f"  安装 openai...")
        result = subprocess.run(
            ["uv", "pip", "install", "-p", str(venv_path), "openai"],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"  错误: 安装 openai 失败")
            print(result.stderr)
            return False

        # Sanity check: verify inspect_evals is importable
        python_path = get_venv_python(benchmark_name)
        check = subprocess.run(
            [str(python_path), "-c", "import inspect_evals"],
            capture_output=True, text=True
        )
        if check.returncode != 0:
            print(f"  错误: inspect_evals 安装验证失败，删除 venv 重试")
            shutil.rmtree(venv_path, ignore_errors=True)
            return False

        # Apply post-install patches (fixes upstream bugs like SSL errors)
        _apply_patches(benchmark_name, venv_path)

        print(f"  环境设置完成")
        _write_marker(venv_path, source, extras)
        return True
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def get_index_path(benchmark_name: str, task_name: str) -> Path:
    """获取索引文件路径"""
    return INDEXES_DIR / benchmark_name / f"{task_name}.yaml"


def expand_sample_ranges(samples: list[str]) -> list[str]:
    """
    展开范围语法，如 "1-10" -> ["1", "2", ..., "10"]

    支持格式:
    - "5"      -> ["5"]
    - "1-10"   -> ["1", "2", ..., "10"]
    - "sample-*"  -> 保持原样 (通配符)
    """
    result = []
    for s in samples:
        # 跳过通配符
        if "*" in s or "?" in s:
            result.append(s)
            continue

        # 尝试解析范围语法
        match = re.match(r"^(\d+)-(\d+)$", s)
        if match:
            start, end = int(match.group(1)), int(match.group(2))
            result.extend(str(i) for i in range(start, end + 1))
        else:
            result.append(s)
    return result


def load_index_file(index_path: Path) -> tuple[str, list[str]] | None:
    """
    加载索引文件 (兼容新旧格式)

    返回 (mode, sample_ids) 或 None (如果文件不存在)
    mode: "include" 或 "exclude"

    支持两种格式:
    - 旧格式: samples 是 list ["1", "2-5", ...]
    - 新格式: samples 是 dict {"1": {sources, added}, ...}
    """
    if not index_path.exists():
        return None

    with open(index_path, "r") as f:
        data = yaml.safe_load(f)

    if not data:
        return None

    mode = data.get("mode", "include")
    samples_data = data.get("samples", [])

    if not samples_data:
        return None

    # 新格式: dict {id: {sources, added}}
    if isinstance(samples_data, dict):
        # keys 可能包含范围语法 (旧格式迁移后)，需要展开
        sample_ids = expand_sample_ranges(list(samples_data.keys()))
    # 旧格式: list ["1", "2-5", ...]
    elif isinstance(samples_data, list):
        sample_ids = expand_sample_ranges(samples_data)
    else:
        return None

    return mode, sample_ids


def match_sample_id(sample_id: str, patterns: list[str]) -> bool:
    """检查样本 ID 是否匹配任一模式"""
    for pattern in patterns:
        if "*" in pattern or "?" in pattern:
            if fnmatch.fnmatch(sample_id, pattern):
                return True
        elif sample_id == pattern:
            return True
    return False


def list_samples(benchmark_name: str, task_spec: str) -> list[str]:
    """
    调用辅助脚本获取样本 ID 列表

    在 benchmark 的虚拟环境中运行 list_samples.py
    """
    python_path = get_venv_python(benchmark_name)
    list_samples_script = TOOLS_DIR / "list_samples.py"

    if not python_path.exists():
        raise RuntimeError(f"虚拟环境不存在: {benchmark_name}，请先运行 --setup")

    result = subprocess.run(
        [str(python_path), str(list_samples_script), task_spec],
        capture_output=True,
        text=True,
        cwd=str(PROJECT_ROOT),
    )

    if result.returncode != 0:
        stderr = result.stderr.strip()
        raise RuntimeError(f"获取样本列表失败: {stderr}")

    try:
        data = json.loads(result.stdout)
        if "error" in data:
            raise RuntimeError(data["error"])
        return data["ids"]
    except json.JSONDecodeError as e:
        raise RuntimeError(f"解析样本列表失败: {e}")


def generate_index_file(
    benchmark_name: str,
    task_name: str,
    task_spec: str,
    output_path: Path | None = None,
) -> Path:
    """
    生成初始索引文件

    包含所有样本 ID，默认 mode 为 include
    """
    sample_ids = list_samples(benchmark_name, task_spec)

    if output_path is None:
        output_path = get_index_path(benchmark_name, task_name)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    header = f"""# {benchmark_name}:{task_name} 样本索引
# 生成时间: {datetime.now().strftime("%Y-%m-%d")}
# 总样本数: {len(sample_ids)}
#
# mode: include = 只跑列出的样本
# mode: exclude = 跳过列出的样本
#
# 支持语法:
#   - "5"       单个样本
#   - "1-10"    范围 (展开为 1, 2, ..., 10)
#   - "sample-*" 通配符

"""

    content = {
        "mode": "include",
        "samples": sample_ids,
    }

    with open(output_path, "w") as f:
        f.write(header)
        yaml.dump(content, f, default_flow_style=False, allow_unicode=True)

    return output_path


def resolve_task(benchmark_spec: str, catalog: dict) -> tuple[str, str, dict, dict]:
    """
    解析 benchmark 规格，返回 (benchmark_name, task_spec, config, task_config)
    """
    if ":" in benchmark_spec:
        benchmark_name, task_name = benchmark_spec.split(":", 1)
    else:
        benchmark_name = benchmark_spec
        task_name = None

    benchmarks = catalog.get("benchmarks", {})
    if benchmark_name not in benchmarks:
        available = ", ".join(benchmarks.keys())
        print(f"错误: 未知的 benchmark '{benchmark_name}'")
        print(f"可用的 benchmarks: {available}")
        sys.exit(1)

    config = benchmarks[benchmark_name]
    tasks = config.get("tasks", [])

    if not tasks:
        print(f"错误: benchmark '{benchmark_name}' 没有定义任何 task")
        sys.exit(1)

    def find_task(name: str):
        for t in tasks:
            if isinstance(t, dict):
                if t.get("name") == name:
                    return t
            elif t == name:
                return {"name": t, "path": config["module"]}
        return None

    if task_name:
        task = find_task(task_name)
        if not task:
            available = ", ".join(
                t.get("name") if isinstance(t, dict) else t
                for t in tasks
            )
            print(f"错误: benchmark '{benchmark_name}' 中没有 task '{task_name}'")
            print(f"可用的 tasks: {available}")
            sys.exit(1)
    else:
        first_task = tasks[0]
        if isinstance(first_task, dict):
            task = first_task
        else:
            task = {"name": first_task, "path": config["module"]}

    task_spec = task["path"]
    return benchmark_name, task_spec, config, task


def run_eval(benchmark_name: str, task_spec: str, config: dict,
             model: str, limit: int = None, judge_model: str = None,
             extra_args: list = None, dry_run: bool = False,
             task_config: dict = None,
             no_index: bool = False, index_file: Path = None,
             api_base: str = None, api_key: str = None,
             models: dict = None,
             max_connections: int = None, max_samples: int = None,
             system_message: str = None,
             reasoning_effort: str = None,
             reasoning_tokens: int = None) -> int:
    """运行评估"""

    # 确保环境存在
    inspect_path = get_venv_inspect(benchmark_name)
    if not inspect_path.exists():
        print(f"设置 {benchmark_name} 环境...")
        if not setup_benchmark_env(benchmark_name, config):
            return 1

    # 规范化模型名称
    model_for_inspect = normalize_model_name(model)

    # 设置结果目录
    sanitized_model = sanitize_model_name(model)
    results_dir = PROJECT_ROOT / "results" / sanitized_model / benchmark_name / "logs"
    results_dir.mkdir(parents=True, exist_ok=True)

    # 设置环境变量
    env = os.environ.copy()
    env["INSPECT_LOG_DIR"] = str(results_dir)

    # Proxy: inherit from environment (set by docker-compose EVAL_PROXY or host shell).
    # No hardcoded fallback — servers without proxy use China mirrors directly.
    # Ensure lowercase and uppercase variants are both set if either exists,
    # because httpx (huggingface_hub) reads HTTPS_PROXY (uppercase only).
    for lower, upper in [("http_proxy", "HTTP_PROXY"), ("https_proxy", "HTTPS_PROXY")]:
        val = env.get(upper) or env.get(lower)
        if val:
            env[lower] = val
            env[upper] = val

    # 清除可能影响 inspect_ai 缓存路径的 VSCode 扩展环境变量
    for key in ["INSPECT_WORKSPACE_ID", "INSPECT_VSCODE_EXT_VERSION"]:
        env.pop(key, None)

    # 自动注入 benchmark 专用环境变量
    _BENCHMARK_ENV_DEFAULTS = {
        "MSSBENCH_DATA_ROOT": str(PROJECT_ROOT / "data" / "mssbench"),
        # MM_SAFETY_BENCH_ROOT: resolved automatically via ~/.cache/inspect_evals/mm_safety_bench/
        "SAFERAG_ROOT": str(PROJECT_ROOT / "vendor" / "SafeRAG"),
        "CYBENCH_ACKNOWLEDGE_RISKS": "1",
    }
    for env_key, env_default in _BENCHMARK_ENV_DEFAULTS.items():
        if not env.get(env_key):
            env[env_key] = env_default

    # 确定 judge model (通过 models: 字典解析短名称 → 完整 inspect_ai 模型名)
    models = models or {}
    # Treat "default" as unset — fall back to catalog config
    if judge_model and judge_model.lower() == "default":
        judge_model = None
    effective_judge = judge_model or config.get("judge_model")
    if effective_judge:
        model_def = models.get(effective_judge, {})
        if model_def:
            # 从 models: 定义构建完整模型名
            provider = model_def.get("provider", "openai")
            effective_judge = f"{provider}/{effective_judge}"
            # 设置 JUDGE_BASE_URL / JUDGE_API_KEY 供 scorer 读取
            if model_def.get("base_url"):
                env["JUDGE_BASE_URL"] = model_def["base_url"]
            api_key_env_name = model_def.get("api_key_env")
            if api_key_env_name:
                jk_val = os.environ.get(api_key_env_name, "")
                if jk_val:
                    env["JUDGE_API_KEY"] = jk_val
        else:
            # 未在 models: 中定义，回退到自动 provider 前缀
            effective_judge = normalize_model_name(effective_judge)
        # 始终设置 JUDGE_MODEL_NAME 供本地 scorer (读取 env var) 使用
        # 本地 scorer 自行添加 "openai/" 前缀，因此这里只传裸模型名
        env["JUDGE_MODEL_NAME"] = effective_judge.split("/", 1)[-1] if "/" in effective_judge else effective_judge

    # 处理索引文件
    sample_ids = None
    index_mode = None
    if not no_index:
        # 确定索引文件路径
        if index_file:
            idx_path = index_file
        else:
            task_name = task_config.get("name") if task_config else None
            if task_name:
                idx_path = get_index_path(benchmark_name, task_name)
            else:
                idx_path = None

        # 加载索引文件
        if idx_path:
            index_data = load_index_file(idx_path)
            if index_data:
                index_mode, sample_ids = index_data
                print(f"Index file: {idx_path}")
                print(f"Index mode: {index_mode}, {len(sample_ids)} samples")

    # 如果显式传了 api_key，覆盖子进程环境变量
    if api_key:
        env["OPENAI_API_KEY"] = api_key

    # 同时设置 OPENAI_BASE_URL，让 grader/judge 等非主模型也能使用正确的 API 端点
    if api_base:
        env["OPENAI_BASE_URL"] = api_base

    # 构建命令
    cmd = [str(inspect_path), "eval", task_spec, "--model", model_for_inspect]

    # 显式传递 model base URL（优先级高于 .env 中的 OPENAI_BASE_URL）
    if api_base:
        cmd.extend(["--model-base-url", api_base])

    # 添加样本 ID 过滤 (仅支持 include 模式)
    # 注意: inspect_ai 不允许同时指定 --sample-id 和 --limit
    has_sample_ids = False
    if sample_ids and index_mode == "include":
        # inspect_ai --sample-id 接受逗号分隔的 ID 列表
        # 需要过滤掉通配符模式 (inspect_ai 不支持)
        literal_ids = [sid for sid in sample_ids if "*" not in sid and "?" not in sid]
        if literal_ids:
            # 如果同时指定了 limit，截取前 N 个 sample_id 而非传 --limit
            if limit and len(literal_ids) > limit:
                literal_ids = literal_ids[:limit]
                print(f"Index + limit: 从 {len(sample_ids)} 个样本中取前 {limit} 个")
            cmd.extend(["--sample-id", ",".join(literal_ids)])
            has_sample_ids = True
    elif sample_ids and index_mode == "exclude":
        # exclude 模式需要先获取所有样本 ID，然后排除
        print("警告: exclude 模式需要先获取完整样本列表，这可能较慢...")
        try:
            all_ids = list_samples(benchmark_name, task_spec)
            included_ids = [
                sid for sid in all_ids
                if not match_sample_id(sid, sample_ids)
            ]
            if included_ids:
                if limit and len(included_ids) > limit:
                    included_ids = included_ids[:limit]
                    print(f"Exclude + limit: 取前 {limit} 个样本")
                cmd.extend(["--sample-id", ",".join(included_ids)])
                has_sample_ids = True
                print(f"Exclude 后剩余样本数: {len(included_ids)}")
        except Exception as e:
            print(f"警告: 获取样本列表失败，跳过索引过滤: {e}")

    if limit and not has_sample_ids:
        cmd.extend(["--limit", str(limit)])
        # When limit is specified (quick testing), override hardcoded epochs
        # to prevent multiplication (e.g., b3 epochs=5 → limit 3 becomes 15)
        cmd.extend(["--epochs", "1"])

    if effective_judge:
        cmd.extend(["--model-role", f"grader={effective_judge}"])
        # 通过 -T 直接覆盖 task 函数的 judge model 参数
        # (解决 task 硬编码默认值导致 --model-role 被忽略的问题)
        judge_param = config.get("judge_param")
        if judge_param:
            cmd.extend(["-T", f"{judge_param}={effective_judge}"])

    # 添加额外的 model_roles（来自 catalog.yaml）
    # 用于为 benchmark 中非 grader 的角色指定模型（如 make_me_pay 的 mark 角色）
    model_roles = config.get("model_roles", {})
    if task_config:
        # task 级别的 model_roles 覆盖 benchmark 级别
        model_roles.update(task_config.get("model_roles", {}))
    for role, role_model in model_roles.items():
        # 通过 models: 字典解析短名称
        role_model_def = models.get(role_model, {})
        if role_model_def:
            role_provider = role_model_def.get("provider", "openai")
            role_model = f"{role_provider}/{role_model}"
        else:
            role_model = normalize_model_name(role_model)
        cmd.extend(["--model-role", f"{role}={role_model}"])

    # 添加 task_args (来自 catalog.yaml)
    if task_config:
        task_args = task_config.get("task_args", {})
        for key, value in task_args.items():
            cmd.extend(["-T", f"{key}={value}"])

    # Agent system prompt and thinking config
    if system_message:
        cmd.extend(["--system-message", system_message])
    if reasoning_effort:
        cmd.extend(["--reasoning-effort", reasoning_effort])
    if reasoning_tokens:
        cmd.extend(["--reasoning-tokens", str(reasoning_tokens)])

    # 并行参数
    if max_connections:
        cmd.extend(["--max-connections", str(max_connections)])
    if max_samples:
        cmd.extend(["--max-samples", str(max_samples)])

    if extra_args:
        cmd.extend(extra_args)

    # 打印信息
    print(f"Benchmark: {benchmark_name}")
    print(f"Task: {task_spec}")
    print(f"Model: {model_for_inspect}")
    print(f"Results dir: {results_dir}")
    if effective_judge:
        print(f"Judge model: {effective_judge}")
    print(f"Command: {' '.join(cmd)}")
    print()

    if dry_run:
        print("[Dry run - 不实际执行]")
        return 0

    # 执行命令
    # Docker-requiring benchmarks: 如果当前 shell 未加入 docker group，用 sg docker 包装
    # Root user (e.g. inside Docker container) can access Docker socket directly — skip sg
    needs_docker = config.get("needs_docker", False)

    # Pre-cleanup for Docker benchmarks to avoid container name conflicts
    # and network address pool exhaustion (Bug #98)
    task_name_for_cleanup = task_config.get("name") if task_config else None
    if needs_docker:
        _docker_pre_cleanup(benchmark_name, task_name=task_name_for_cleanup)

    # SafeAgentBench: auto-start AI2-THOR container if not running (Bug #107)
    if benchmark_name == "safeagentbench":
        _ensure_thor_server()
    if needs_docker and os.getuid() != 0 and "docker" not in os.popen("groups").read():
        # 构建 env 导出 + 命令字符串，通过 sg docker -c 运行
        env_exports = " ".join(f"{k}={v}" for k, v in env.items()
                               if k not in os.environ or os.environ[k] != v)
        cmd_str = " ".join(cmd)
        wrapped = f"sg docker -c '{env_exports} {cmd_str}'"
        print(f"[Docker] Wrapping with sg docker")
        result = subprocess.run(
            ["sg", "docker", "-c", f"{env_exports} {cmd_str}"],
            env=env,
        )
    else:
        result = subprocess.run(cmd, env=env)

    # Cleanup stale Docker networks after needs_docker tasks to prevent
    # address pool exhaustion (Bug #91).  inspect_ai creates a new bridge
    # network per compose run but does not always remove it on exit.
    if needs_docker:
        _cleanup_docker_networks()

    return result.returncode


def _docker_pre_cleanup(benchmark_name: str, task_name: str = None):
    """Clean up stale Docker containers and networks BEFORE running a Docker benchmark.

    Aggressively removes ALL stopped inspect-* containers (not just task-matching ones)
    to prevent resource accumulation from previous failed runs (E146).
    """
    # 1. Remove ALL stopped inspect-* containers (exited, dead, created)
    try:
        result = subprocess.run(
            ["docker", "ps", "-a", "--format", "{{.ID}}\t{{.Names}}",
             "--filter", "name=inspect-",
             "--filter", "status=exited"],
            capture_output=True, text=True, timeout=10,
        )
        # Also get dead and created containers
        for status in ["dead", "created"]:
            extra = subprocess.run(
                ["docker", "ps", "-a", "--format", "{{.ID}}\t{{.Names}}",
                 "--filter", "name=inspect-",
                 "--filter", f"status={status}"],
                capture_output=True, text=True, timeout=10,
            )
            result = type(result)(result.args, result.returncode,
                                  result.stdout + extra.stdout, result.stderr)

        if result.stdout.strip():
            to_remove = []
            for line in result.stdout.strip().split('\n'):
                parts = line.strip().split('\t', 1)
                if len(parts) < 2:
                    continue
                cid, cname = parts[0].strip(), parts[1].strip()
                if cid and cname.startswith("inspect-"):
                    to_remove.append((cid, cname))
            if to_remove:
                # Deduplicate by container ID
                seen = set()
                unique = []
                for cid, cname in to_remove:
                    if cid not in seen:
                        seen.add(cid)
                        unique.append((cid, cname))
                ids = [c[0] for c in unique]
                subprocess.run(
                    ["docker", "rm", "-f"] + ids,
                    capture_output=True, text=True, timeout=30,
                )
                print(f"  [Docker pre-cleanup] Removed {len(ids)} stopped container(s)")
    except Exception as e:
        print(f"  [Docker pre-cleanup] Container cleanup failed: {e}")

    # 2. Remove unused inspect-* networks to free address pool
    try:
        result = subprocess.run(
            ["docker", "network", "ls", "--filter", "name=inspect-",
             "--format", "{{.ID}} {{.Name}}"],
            capture_output=True, text=True, timeout=10,
        )
        if result.stdout.strip():
            removed = 0
            for line in result.stdout.strip().split('\n'):
                parts = line.strip().split(None, 1)
                if not parts:
                    continue
                nid = parts[0]
                rm = subprocess.run(
                    ["docker", "network", "rm", nid],
                    capture_output=True, text=True, timeout=10,
                )
                if rm.returncode == 0:
                    removed += 1
            if removed:
                print(f"  [Docker pre-cleanup] Removed {removed} stale network(s)")
    except Exception as e:
        print(f"  [Docker pre-cleanup] Network cleanup failed: {e}")


def _cleanup_docker_networks():
    """Remove stale inspect-* Docker networks to prevent address pool exhaustion."""
    try:
        ls = subprocess.run(
            ["docker", "network", "ls", "--format", "{{.Name}}", "--filter", "name=inspect-"],
            capture_output=True, text=True, timeout=10,
        )
        if ls.returncode != 0:
            return
        networks = [n.strip() for n in ls.stdout.splitlines() if n.strip()]
        if not networks:
            return
        removed = 0
        for net in networks:
            rm = subprocess.run(
                ["docker", "network", "rm", net],
                capture_output=True, text=True, timeout=10,
            )
            if rm.returncode == 0:
                removed += 1
        if removed:
            print(f"[Docker cleanup] Removed {removed} stale inspect-* network(s)")
    except Exception:
        pass  # Best-effort cleanup — don't fail the task


def _ensure_thor_server(port: int = 9100, timeout: float = 120.0):
    """Ensure the AI2-THOR Docker container is running for SafeAgentBench (Bug #107).

    If the container is not responding on localhost:port, start it via docker compose.
    """
    import urllib.request
    url = f"http://localhost:{port}/health"

    # Quick check if already running
    try:
        resp = urllib.request.urlopen(url, timeout=5)
        if resp.status == 200:
            print(f"  [AI2-THOR] Server already running on port {port}")
            return
    except Exception:
        pass

    # Start the container
    docker_dir = PROJECT_ROOT / "benchmarks" / "eval_benchmarks" / "safeagentbench" / "docker"
    print(f"  [AI2-THOR] Starting container from {docker_dir}...")
    result = subprocess.run(
        ["docker", "compose", "up", "-d", "--build"],
        cwd=str(docker_dir),
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0:
        print(f"  [AI2-THOR] Failed to start: {result.stderr[:500]}")
        return

    # Wait for readiness
    import time
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            resp = urllib.request.urlopen(url, timeout=5)
            if resp.status == 200:
                print(f"  [AI2-THOR] Server ready on port {port}")
                return
        except Exception:
            pass
        time.sleep(3.0)

    print(f"  [AI2-THOR] WARNING: Server not ready after {timeout}s, proceeding anyway")


def main():
    parser = argparse.ArgumentParser(
        description="统一 Eval 入口脚本 (独立虚拟环境)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        "benchmark",
        nargs="?",
        help="Benchmark 名称，格式: benchmark_name 或 benchmark_name:task_name"
    )
    parser.add_argument(
        "--model", "-m",
        help="模型名称 (例如: doubao-seed-1-8-251228)"
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="限制样本数量"
    )
    parser.add_argument(
        "--judge-model",
        help="Judge 模型 (覆盖 catalog 中的默认值)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印命令，不实际执行"
    )
    parser.add_argument(
        "--setup",
        metavar="BENCHMARK",
        help="仅设置指定 benchmark 的环境"
    )
    parser.add_argument(
        "--setup-all",
        action="store_true",
        help="设置所有 benchmark 的环境"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="强制重新创建环境"
    )
    parser.add_argument(
        "--no-update",
        action="store_true",
        help="(已弃用) 自动更新已默认关闭，此参数不再需要"
    )
    parser.add_argument(
        "--check-venvs",
        action="store_true",
        help="审计所有 venvs，报告可用更新 (只读)"
    )
    parser.add_argument(
        "--update-all",
        action="store_true",
        help="升级所有 venvs 到最新 PyPI 版本"
    )
    parser.add_argument(
        "--preflight",
        action="store_true",
        help="运行预检查，检测环境依赖"
    )
    parser.add_argument(
        "--run-all",
        action="store_true",
        help="运行所有 benchmark (一键测评)"
    )
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="跳过预检查 (不推荐)"
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="自动确认权限 (用于非交互式运行)"
    )
    # 索引相关参数
    parser.add_argument(
        "--no-index",
        action="store_true",
        help="禁用索引，跑全量样本"
    )
    parser.add_argument(
        "--index-file",
        type=Path,
        help="指定索引文件路径"
    )
    parser.add_argument(
        "--generate-index",
        action="store_true",
        help="生成初始索引文件（不运行评测）"
    )
    parser.add_argument(
        "--list-samples",
        action="store_true",
        help="列出所有样本 ID（不运行评测）"
    )
    parser.add_argument(
        "--api-base",
        help="模型 API 的 Base URL（覆盖 .env 中的 OPENAI_BASE_URL）"
    )
    parser.add_argument(
        "--api-key",
        help="模型 API Key（覆盖 .env 中的 OPENAI_API_KEY）"
    )
    parser.add_argument(
        "--max-connections",
        type=int,
        default=None,
        help="inspect_ai 最大并发 API 连接数（默认 10，增大可加速）"
    )
    parser.add_argument(
        "--max-samples",
        type=int,
        default=None,
        help="inspect_ai 最大并行样本数"
    )
    parser.add_argument(
        "--system-message",
        default=None,
        help="Agent system prompt (passed to inspect eval --system-message)"
    )
    parser.add_argument(
        "--reasoning-effort",
        default=None,
        help="Reasoning effort level (passed to inspect eval --reasoning-effort)"
    )
    parser.add_argument(
        "--reasoning-tokens",
        type=int,
        default=None,
        help="Reasoning token budget (passed to inspect eval --reasoning-tokens)"
    )
    parser.add_argument(
        "extra_args",
        nargs="*",
        help="传递给 inspect eval 的额外参数"
    )

    args = parser.parse_args()
    catalog = load_catalog()
    benchmarks = catalog.get("benchmarks", {})

    # 仅运行预检查
    if args.preflight:
        benchmark_list = list(benchmarks.keys())
        judge_config = JudgeModelConfig(
            model_name=args.judge_model or catalog.get("benchmarks", {}).get("cyberseceval_2", {}).get("judge_model", "")
        )
        results = run_preflight_checks(benchmark_list, judge_config)
        passed = print_preflight_report(results)

        # 显示权限确认
        permissions = get_required_permissions(benchmark_list)
        if permissions:
            print("\n需要用户确认的权限:")
            for perm in permissions:
                print(f"  • {perm}")
            print()

        return 0 if passed else 1

    # Audit all venvs (read-only)
    if args.check_venvs:
        print("Checking all benchmark venvs...\n")
        VENVS_DIR.mkdir(parents=True, exist_ok=True)
        total = outdated = missing = broken = 0
        for name, config in benchmarks.items():
            total += 1
            venv_path = get_venv_path(name)
            inspect_path = get_venv_inspect(name)
            if not venv_path.exists():
                print(f"  [{name}] MISSING — no venv")
                missing += 1
                continue
            if not inspect_path.exists():
                print(f"  [{name}] BROKEN — no inspect binary")
                broken += 1
                continue
            marker = _read_marker(venv_path)
            if not marker:
                # Write marker for future checks
                _write_marker(venv_path, config.get("source", "upstream"), config.get("extras", []))
                marker = _read_marker(venv_path)
                print(f"  [{name}] OK (marker written) — inspect-ai={marker.get('inspect_ai', '?')}, inspect-evals={marker.get('inspect_evals', '?')}")
            else:
                has_updates = _check_pypi_updates(venv_path, marker)
                status = "UPDATES AVAILABLE" if has_updates else "up to date"
                if has_updates:
                    outdated += 1
                print(f"  [{name}] {status} — inspect-ai={marker.get('inspect_ai', '?')}, inspect-evals={marker.get('inspect_evals', '?')}")

        print(f"\nSummary: {total} benchmarks, {missing} missing, {broken} broken, {outdated} with updates available")
        return 0

    # Upgrade all venvs
    if args.update_all:
        print("Upgrading all benchmark venvs...\n")
        VENVS_DIR.mkdir(parents=True, exist_ok=True)
        upgraded = skipped = failed = 0
        for name, config in benchmarks.items():
            venv_path = get_venv_path(name)
            inspect_path = get_venv_inspect(name)
            if not venv_path.exists() or not inspect_path.exists():
                print(f"  [{name}] skipped (no venv)")
                skipped += 1
                continue
            extras = config.get("extras", [])
            source = config.get("source", "upstream")
            marker = _read_marker(venv_path)
            if marker and not _check_pypi_updates(venv_path, marker):
                print(f"  [{name}] already up to date")
                skipped += 1
                continue
            print(f"  [{name}] upgrading...")
            if _upgrade_venv(venv_path, extras):
                _apply_patches(name, venv_path)
                _write_marker(venv_path, source, extras)
                upgraded += 1
                print(f"  [{name}] done")
            else:
                failed += 1
                print(f"  [{name}] FAILED")

        print(f"\nSummary: {upgraded} upgraded, {skipped} skipped, {failed} failed")
        return 0

    # 一键测评
    if args.run_all:
        if not args.model:
            print("错误: --run-all 必须指定 --model 参数")
            return 1

        benchmark_list = list(benchmarks.keys())

        # 预检查
        if not args.skip_preflight:
            judge_config = JudgeModelConfig(
                model_name=args.judge_model or benchmarks.get("cyberseceval_2", {}).get("judge_model", "")
            )
            results = run_preflight_checks(benchmark_list, judge_config)
            passed = print_preflight_report(results)

            # 显示并确认权限
            permissions = get_required_permissions(benchmark_list)
            if permissions:
                print("\n需要用户确认的权限:")
                for perm in permissions:
                    print(f"  • {perm}")
                print()

                if not args.confirm:
                    try:
                        response = input("是否同意上述权限? [y/N]: ").strip().lower()
                        if response not in ("y", "yes"):
                            print("用户取消")
                            return 1
                    except (EOFError, KeyboardInterrupt):
                        print("\n用户取消")
                        return 1

            if not passed and not args.skip_preflight:
                print("\n预检查未通过。使用 --skip-preflight 可跳过检查（不推荐）")
                return 1

        # 运行所有 benchmark 的所有 tasks
        total_tasks = sum(
            len(config.get("tasks", [])) for config in benchmarks.values()
        )
        print(f"\n开始一键测评: {args.model}")
        print(f"共 {len(benchmarks)} 个 benchmark, {total_tasks} 个 tasks\n")
        print("=" * 60)

        VENVS_DIR.mkdir(parents=True, exist_ok=True)

        results_summary = []
        for name, config in benchmarks.items():
            tasks = config.get("tasks", [])
            if not tasks:
                print(f"\n[{name}]")
                print(f"  跳过: 没有定义 task")
                results_summary.append((name, None, "skipped", "no tasks"))
                continue

            # 遍历每个 task
            for task in tasks:
                if isinstance(task, dict):
                    task_name = task.get("name")
                    task_spec = task["path"]
                    task_config = task
                else:
                    task_name = task
                    task_spec = config["module"]
                    task_config = {"name": task, "path": task_spec}

                print(f"\n[{name}:{task_name}]")

                returncode = run_eval(
                    benchmark_name=name,
                    task_spec=task_spec,
                    config=config,
                    model=args.model,
                    limit=args.limit,
                    judge_model=args.judge_model,
                    extra_args=args.extra_args,
                    dry_run=args.dry_run,
                    task_config=task_config,
                    no_index=args.no_index,
                    index_file=args.index_file,
                    api_base=args.api_base,
                    api_key=args.api_key,
                    models=catalog.get("models", {}),
                    max_connections=args.max_connections,
                    max_samples=args.max_samples,
                    system_message=args.system_message,
                    reasoning_effort=args.reasoning_effort,
                    reasoning_tokens=args.reasoning_tokens,
                )

                if returncode == 0:
                    results_summary.append((name, task_name, "success", ""))
                else:
                    results_summary.append((name, task_name, "failed", f"exit code {returncode}"))

        # 打印汇总
        print("\n" + "=" * 60)
        print("测评结果汇总")
        print("=" * 60)
        success_count = sum(1 for _, _, status, _ in results_summary if status == "success")
        for name, task_name, status, msg in results_summary:
            icon = "✅" if status == "success" else "❌" if status == "failed" else "⏭️"
            display_name = f"{name}:{task_name}" if task_name else name
            print(f"  {icon} {display_name}: {status} {msg}")

        print(f"\n通过: {success_count}/{len(results_summary)}")
        return 0 if success_count == len(results_summary) else 1

    # 设置所有环境
    if args.setup_all:
        print("设置所有 benchmark 环境...")
        VENVS_DIR.mkdir(parents=True, exist_ok=True)
        success = True
        for name, config in benchmarks.items():
            print(f"\n[{name}]")
            if not setup_benchmark_env(name, config, args.force, args.no_update):
                success = False
        return 0 if success else 1

    # 设置单个环境
    if args.setup:
        if args.setup not in benchmarks:
            print(f"错误: 未知的 benchmark '{args.setup}'")
            return 1
        print(f"设置 {args.setup} 环境...")
        VENVS_DIR.mkdir(parents=True, exist_ok=True)
        return 0 if setup_benchmark_env(args.setup, benchmarks[args.setup], args.force, args.no_update) else 1

    # 列出样本 ID
    if args.list_samples:
        if not args.benchmark:
            print("错误: --list-samples 必须指定 benchmark")
            return 1

        benchmark_name, task_spec, config, task_config = resolve_task(args.benchmark, catalog)

        # 确保环境存在
        VENVS_DIR.mkdir(parents=True, exist_ok=True)
        inspect_path = get_venv_inspect(benchmark_name)
        if not inspect_path.exists():
            print(f"设置 {benchmark_name} 环境...")
            if not setup_benchmark_env(benchmark_name, config):
                return 1

        try:
            sample_ids = list_samples(benchmark_name, task_spec)
            print(f"Task: {args.benchmark}")
            print(f"Total samples: {len(sample_ids)}")
            print()
            for sid in sample_ids:
                print(sid)
            return 0
        except Exception as e:
            print(f"错误: {e}")
            return 1

    # 生成索引文件
    if args.generate_index:
        if not args.benchmark:
            print("错误: --generate-index 必须指定 benchmark")
            return 1

        benchmark_name, task_spec, config, task_config = resolve_task(args.benchmark, catalog)
        task_name = task_config.get("name")

        # 确保环境存在
        VENVS_DIR.mkdir(parents=True, exist_ok=True)
        inspect_path = get_venv_inspect(benchmark_name)
        if not inspect_path.exists():
            print(f"设置 {benchmark_name} 环境...")
            if not setup_benchmark_env(benchmark_name, config):
                return 1

        try:
            output_path = args.index_file or get_index_path(benchmark_name, task_name)
            path = generate_index_file(benchmark_name, task_name, task_spec, output_path)
            print(f"索引文件已生成: {path}")
            return 0
        except Exception as e:
            print(f"错误: {e}")
            return 1

    # 运行评估
    if not args.benchmark:
        parser.print_help()
        return 1

    if not args.model:
        print("错误: 必须指定 --model 参数")
        return 1

    benchmark_name, task_spec, config, task_config = resolve_task(args.benchmark, catalog)

    # 确保 .venvs 目录存在
    VENVS_DIR.mkdir(parents=True, exist_ok=True)

    return run_eval(
        benchmark_name=benchmark_name,
        task_spec=task_spec,
        config=config,
        model=args.model,
        limit=args.limit,
        judge_model=args.judge_model,
        extra_args=args.extra_args,
        dry_run=args.dry_run,
        task_config=task_config,
        no_index=args.no_index,
        index_file=args.index_file,
        api_base=args.api_base,
        api_key=args.api_key,
        models=catalog.get("models", {}),
        max_connections=args.max_connections,
        max_samples=args.max_samples,
        system_message=args.system_message,
        reasoning_effort=args.reasoning_effort,
        reasoning_tokens=args.reasoning_tokens,
    )


if __name__ == "__main__":
    sys.exit(main())
