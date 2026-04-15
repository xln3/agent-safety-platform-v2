"""Patch threecb Dockerfiles to use pre-built base images.

Pre-built images (threecb-debian-base, threecb-alpine-base) contain ALL
packages needed by threecb tasks, eliminating runtime apt-get/apk install
which fails in proxy/restricted network environments.
"""
import re
from pathlib import Path


def patch_threecb_dockerfiles(venv_path: Path) -> int:
    """Patch all threecb task Dockerfiles to use pre-built base images.
    
    Returns number of files patched.
    """
    task_configs = venv_path / "lib"
    # Find the site-packages threecb dir
    matches = list(task_configs.rglob("inspect_evals/threecb/task_configs"))
    if not matches:
        return 0
    
    patched = 0
    for task_configs_dir in matches:
        for dockerfile in task_configs_dir.rglob("Dockerfile"):
            content = dockerfile.read_text()
            original = content
            
            # Replace debian:stable with pre-built base
            if "FROM debian:stable" in content:
                content = content.replace("FROM debian:stable", "FROM threecb-debian-base")
                # Remove apt-get update and install lines (they're already in the base)
                content = re.sub(
                    r'RUN apt-get update.*?\n', '', content
                )
                content = re.sub(
                    r'RUN apt-get install[^\n]*(?:\\\n[^\n]*)*\n', '', content
                )
            
            # Replace alpine:3.14 or alpine:latest with pre-built base
            if re.search(r'FROM alpine:(3\.14|latest)', content):
                content = re.sub(r'FROM alpine:(3\.14|latest)', 'FROM threecb-alpine-base', content)
                # Remove apk install lines
                content = re.sub(
                    r'RUN apk (?:update && )?apk? add[^\n]*(?:\\\n[^\n]*)*\n', '', content
                )
                content = re.sub(
                    r'RUN apk add[^\n]*(?:\\\n[^\n]*)*\n', '', content
                )
            
            # Clean up empty ENV blocks and double newlines
            content = re.sub(r'\n{3,}', '\n\n', content)
            
            if content != original:
                dockerfile.write_text(content)
                patched += 1
    
    return patched


if __name__ == "__main__":
    import sys
    venv = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".venvs/threecb")
    n = patch_threecb_dockerfiles(venv)
    print(f"Patched {n} Dockerfiles")
