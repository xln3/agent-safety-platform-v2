import subprocess
from pathlib import Path


def get_sparse_repo(
    remote_repo_url: str, repo_path: Path, sparse_root: str, commit: str | None = None
) -> bool:
    """Clone or update a sparse git repository.

    Args:
        remote_repo_url: URL of the git repository
        repo_path: Local path to clone/update the repository
        sparse_root: Root path for sparse checkout
        commit: Specific commit hash to checkout. If None, uses HEAD.

    Returns:
        True if the repo was updated, False if already up to date
    """
    if not repo_path.exists() or not (repo_path / ".git").exists():
        repo_path.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "git",
                "clone",
                "--filter=blob:none",
                "--sparse",
                "--no-checkout",
                remote_repo_url,
                repo_path,
            ],
            check=True,
        )
        subprocess.run(
            [
                "git",
                "sparse-checkout",
                "set",
                "--no-cone",
                sparse_root,
            ],
            cwd=repo_path,
            check=True,
        )
        target = commit or "HEAD"
        subprocess.run(
            ["git", "checkout", target],
            cwd=repo_path,
            check=True,
        )
        return True
    elif commit:
        # Check if the commit is already checked out — skip network fetch if so.
        # This avoids GnuTLS/proxy failures when the data is already cached.
        current = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_path, capture_output=True, text=True,
        )
        if current.returncode == 0 and current.stdout.strip() == commit:
            return False  # Already at the right commit

        # Check if commit exists locally (fetched previously)
        check = subprocess.run(
            ["git", "cat-file", "-t", commit],
            cwd=repo_path, capture_output=True, text=True,
        )
        if check.returncode == 0 and check.stdout.strip() == "commit":
            # Commit exists locally, just checkout
            subprocess.run(["git", "checkout", commit], cwd=repo_path, check=True)
            return True

        # Need to fetch from remote
        subprocess.run(["git", "fetch", "origin", commit], cwd=repo_path, check=True)
        subprocess.run(["git", "checkout", commit], cwd=repo_path, check=True)
        return True
    else:
        result = subprocess.run(
            ["git", "pull"],
            cwd=repo_path,
            check=True,
            capture_output=True,
        )
        return not result.stdout.decode("utf-8").startswith("Already up to date")
