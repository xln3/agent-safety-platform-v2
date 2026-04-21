"""
Local cve_bench task — clean adapter for cvebench 0.2.0+ API.

The upstream inspect_evals/cve_bench wrapper is incompatible with cvebench 0.2.0:
  - Passes removed `sandbox_type` parameter
  - Only sets 3 env vars (needs 6+)
  - Doesn't pass `challenges_dir` parameter

This local implementation interfaces directly with the cvebench package.
"""
from __future__ import annotations

import logging
import os
from enum import Enum
from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.solver import Solver

logger = logging.getLogger(__name__)

TASK_VERSION = "1.0.0-local"


class Variant(str, Enum):
    ZERO_DAY = "zero_day"
    ONE_DAY = "one_day"


# K8s-supported CVEs (29 of 40)
K8S_SUPPORTED_CVES = [
    "CVE-2023-37999", "CVE-2023-51483", "CVE-2024-22120", "CVE-2024-2359",
    "CVE-2024-2771", "CVE-2024-30542", "CVE-2024-31611", "CVE-2024-32167",
    "CVE-2024-3234", "CVE-2024-32511", "CVE-2024-32980", "CVE-2024-32986",
    "CVE-2024-34070", "CVE-2024-3408", "CVE-2024-34359", "CVE-2024-3495",
    "CVE-2024-35187", "CVE-2024-3552", "CVE-2024-36412", "CVE-2024-36779",
    "CVE-2024-37388", "CVE-2024-37831", "CVE-2024-37849", "CVE-2024-4223",
    "CVE-2024-4323", "CVE-2024-4442", "CVE-2024-4443", "CVE-2024-5084",
    "CVE-2024-5452",
]

# Docker-only CVEs (not available on K8s)
K8S_UNSUPPORTED_CVES = {
    "CVE-2024-36858": "Docker image is not public.",
    "CVE-2024-34716": "Issues with Prestashop startup on K8s.",
    "CVE-2024-32964": "Issues with hostNetwork: true on K8s",
}

# Work-in-progress CVEs
WIP_CVES = [
    "CVE-2024-25641", "CVE-2024-34340", "CVE-2024-4320", "CVE-2024-5315",
    "CVE-2024-36675", "CVE-2024-4701", "CVE_2024_5314", "CVE_2024_2624",
]

# All 40 CVEs
ALL_CVES = list(K8S_UNSUPPORTED_CVES.keys()) + K8S_SUPPORTED_CVES + WIP_CVES

DEFAULT_VARIANT = Variant.ONE_DAY
DEFAULT_MAX_MESSAGES = 50


def _setup_docker_env() -> str:
    """Set all required env vars for cvebench 0.2.0+ Docker mode.

    Returns:
        str: Absolute path to the challenges directory.
    """
    import cvebench  # type: ignore

    cve_bench_dir = Path(cvebench.__file__).parent

    # Core directories
    challenges_dir = str((cve_bench_dir / "challenges").resolve())
    os.environ["CVEBENCH_METADATA_DIR"] = str((cve_bench_dir / "metadata").resolve())
    os.environ["CVEBENCH_CHALLENGE_DIR"] = challenges_dir
    os.environ["CVEBENCH_NVD_DIR"] = str((cve_bench_dir / "nvd").resolve())

    # Docker-related directories (required by cvebench 0.2.0+)
    os.environ["CVEBENCH_DOCKER_DIR"] = str((cve_bench_dir / "docker").resolve())
    os.environ["CVEBENCH_SANDBOXES_DIR"] = str((cve_bench_dir / "sandboxes").resolve())
    os.environ["CVEBENCH_EVALUATIONS_DIR"] = str((cve_bench_dir / "evaluations").resolve())

    # Version info
    os.environ["CVEBENCH_TAG"] = getattr(cvebench, "__version__", "0.2.0")
    os.environ["CVEBENCH_VERSION"] = "critical"

    return challenges_dir


@task
def cve_bench(
    challenges: str | list[str] | None = "CVE-2023-37999",
    variants: str | list[str] = DEFAULT_VARIANT,
    agent: Solver | None = None,
    max_messages: int = DEFAULT_MAX_MESSAGES,
    sandbox_type: str = "docker",
) -> Task:
    """
    CVE Bench — evaluate model ability to exploit known CVE vulnerabilities.

    Args:
        challenges: CVEs to run. None = all 40 CVEs. Default: CVE-2023-37999.
        variants: 'one_day' or 'zero_day' prompt variant.
        agent: Custom agent solver (optional).
        max_messages: Max messages per CVE (default: 50).
        sandbox_type: 'docker' or 'k8s' (default: docker).
    """
    from cvebench.cvebench import cvebench as _cvebench  # type: ignore[import]

    challenges_dir: str | None = None

    if sandbox_type == "k8s":
        if challenges is None:
            challenges = list(K8S_SUPPORTED_CVES)
        elif isinstance(challenges, str):
            challenges = [challenges]
        for cve in challenges:
            if cve in K8S_UNSUPPORTED_CVES:
                raise ValueError(
                    f"CVE {cve} is not supported on K8s: {K8S_UNSUPPORTED_CVES[cve]}"
                )
        logger.warning(
            "Running on Kubernetes. Ensure cluster conforms with requirements. "
            "See: https://k8s-sandbox.aisi.org.uk/"
        )
    elif sandbox_type == "docker":
        challenges_dir = _setup_docker_env()
        if challenges is None:
            challenges = ALL_CVES

    if agent is not None:
        logger.warning(
            "Ensure the provided agent is compatible with CVEBench Agent signature. "
            "See: https://github.com/Scott-Simmons/cve-bench/blob/main/src/cvebench/agent.py"
        )

    # Build kwargs — cvebench 0.2.0 does NOT accept sandbox_type
    kwargs = {
        "challenges": challenges,
        "variants": variants,
        "agent": agent,
        "max_messages": max_messages,
    }
    if challenges_dir is not None:
        kwargs["challenges_dir"] = challenges_dir

    result_task: Task = _cvebench(**kwargs)  # type: ignore
    result_task.version = TASK_VERSION
    return result_task
