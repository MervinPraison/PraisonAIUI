"""CI's push-to-main ``bundle-sync`` job fails when the committed bundle is stale.

A stale bundle on main used to open a bot PR and still conclude ``success``,
and the release gate publishes any SHA whose CI is green: the wheel would
ship the old bundle. The step script is read from ``.github/workflows/ci.yml``
and run for real in a temp repo with ``gh`` stubbed and a local bare origin.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
CI = REPO / ".github" / "workflows" / "ci.yml"
BUNDLE = Path("src/praisonaiui/templates/frontend")

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


def _step_script() -> str:
    steps = yaml.safe_load(CI.read_text())["jobs"]["bundle-sync"]["steps"]
    script = next(s["run"] for s in steps if s.get("name", "").startswith("Open a pull request"))
    assert "${{" not in script
    return script


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path):
    origin = tmp_path / "origin.git"
    work = tmp_path / "work"
    _git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    _git(tmp_path, "clone", "-q", str(origin), str(work))
    _git(work, "config", "commit.gpgsign", "false")
    (work / BUNDLE / "assets").mkdir(parents=True)
    (work / BUNDLE / "assets" / "index.js").write_text("built\n")
    _git(work, "add", "-A")
    _git(work, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "base")
    _git(work, "push", "-q", "origin", "HEAD:main")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "gh.log"
    gh = bin_dir / "gh"
    gh.write_text(f'#!/usr/bin/env bash\necho "gh $*" >> "{log}"\n')
    gh.chmod(0o755)
    env = {
        **{k: v for k, v in os.environ.items() if k not in ("BASH_ENV", "ENV")},
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "GITHUB_SHA": _git(work, "rev-parse", "HEAD"),
    }
    return {"work": work, "origin": origin, "env": env, "log": log}


def _run(repo) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-eo", "pipefail", "-c", _step_script()],
        cwd=repo["work"],
        env=repo["env"],
        capture_output=True,
        text=True,
    )


def test_in_sync_bundle_passes(repo):
    result = _run(repo)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "matches the build" in result.stdout
    assert not repo["log"].exists()


def test_stale_bundle_opens_the_sync_pr_and_fails(repo):
    # What `npm run build && npm run sync` leaves when main's bundle is stale.
    (repo["work"] / BUNDLE / "assets" / "index.js").write_text("rebuilt from newer source\n")
    result = _run(repo)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "::error title=Stale frontend bundle::" in result.stdout
    assert "gh pr create" in repo["log"].read_text()
    pushed = _git(
        repo["origin"], "show", "bot/frontend-bundle-sync:" + str(BUNDLE / "assets" / "index.js")
    )
    assert pushed == "rebuilt from newer source"
