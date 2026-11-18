"""The PyPI release workflow publishes only a verified commit, and only after
its version bump is on main.

The step scripts are read from ``.github/workflows/pypi-release.yml`` and run
for real against a temporary bare "origin", with ``uv``, ``gh`` and ``curl``
stubbed on ``PATH``. Nothing here talks to GitHub or PyPI.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = REPO / ".github" / "workflows" / "pypi-release.yml"
GATE_JS = REPO / ".github" / "scripts" / "release-gate.js"

needs_git = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def _steps() -> list[dict]:
    return _workflow()["jobs"]["release"]["steps"]


def _step(name_prefix: str) -> dict:
    for step in _steps():
        if step.get("name", "").startswith(name_prefix):
            return step
    raise AssertionError(f"no step named {name_prefix!r} in pypi-release.yml")


def _index(name_prefix: str) -> int:
    return _steps().index(_step(name_prefix))


# --- structure ---------------------------------------------------------------


def test_checks_out_the_trigger_sha_not_main():
    checkout = _step("Checkout")
    assert "inputs.trigger_sha" in checkout["with"]["ref"]


def test_verifies_the_commit_before_building():
    verify = _index("Verify the release commit")
    assert verify < _index("Bump version files") < _index("Build aiui")
    assert "verify-sha" in _step("Verify the release commit")["run"]
    # A dry run reports whether the release would go, so no dry_run guard.
    assert "if" not in _step("Verify the release commit")


def test_pushes_the_bump_before_publishing():
    assert _index("Build aiui") < _index("Commit and tag") < _index("Publish aiui to PyPI")
    assert (
        _index("Publish aiui to PyPI") < _index("Wait for aiui on PyPI") < _index("GitHub release")
    )
    publish = _step("Publish aiui to PyPI")["run"]
    assert "uv publish" in publish and "uv build" not in publish


def test_never_rebases_onto_unverified_commits():
    for step in _steps():
        assert not re.search(r"git\s+(pull|rebase)\b", step.get("run", "")), step["name"]


def test_side_effects_skip_on_dry_run():
    for name in (
        "Bump version files",
        "Build aiui",
        "Commit and tag",
        "Publish aiui",
        "GitHub release",
    ):
        assert _step(name)["if"] == "inputs.dry_run != true", name


def test_run_name_carries_the_gate_dry_run_marker():
    marker = re.search(r"const DRY_RUN_MARKER = '([^']+)'", GATE_JS.read_text()).group(1)
    run_name = _workflow()["run-name"]
    dry_branch = run_name.split("||")[0]
    assert "inputs.dry_run" in dry_branch and marker in dry_branch
    assert marker not in run_name.split("||")[1]


# --- the step scripts, run for real --------------------------------------------


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


def _stub(bin_dir: Path, name: str, body: str) -> None:
    path = bin_dir / name
    path.write_text("#!/usr/bin/env bash\n" + body)
    path.chmod(0o755)


@pytest.fixture
def release_repo(tmp_path: Path):
    """A clone of a bare origin whose main holds aiui 1.2.3 and green CI."""
    origin = tmp_path / "origin.git"
    work = tmp_path / "work"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    _git(tmp_path, "clone", "-q", str(origin), str(work))
    for key, val in (
        ("user.name", "t"),
        ("user.email", "t@example.com"),
        ("commit.gpgsign", "false"),
    ):
        _git(work, "config", key, val)
    (work / "pyproject.toml").write_text('[project]\nname = "aiui"\nversion = "1.2.3"\n')
    (work / "uv.lock").write_text("lock\n")
    ver = work / "src" / "praisonaiui"
    ver.mkdir(parents=True)
    (ver / "__version__.py").write_text('__version__ = "1.2.3"\n')
    gate_dir = work / ".github" / "scripts"
    gate_dir.mkdir(parents=True)
    shutil.copy(GATE_JS, gate_dir / "release-gate.js")
    shutil.copy(GATE_JS.with_name("gate-config.js"), gate_dir / "gate-config.js")
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", "base")
    _git(work, "push", "-q", "origin", "HEAD:main")

    log = tmp_path / "events.log"
    # `uv publish` records whether the release tag was already on origin.
    _stub(
        bin_dir,
        "uv",
        f'echo "uv $*" >> "{log}"\n'
        'if [ "$1" = publish ]; then\n'
        f'  if git ls-remote --tags "{origin}" | grep -q "refs/tags/v"; then\n'
        f'    echo "publish:tag-on-origin" >> "{log}"\n'
        f'  else echo "publish:tag-missing" >> "{log}"; fi\n'
        "fi\n",
    )
    ci = tmp_path / "ci.json"
    ci.write_text(json.dumps([{"status": "completed", "conclusion": "success"}]))
    _stub(bin_dir, "gh", f'cat "{ci}"\n')
    env = {
        # BASH_ENV would let a developer's shell profile reset PATH (and the stubs).
        **{k: v for k, v in os.environ.items() if k not in ("BASH_ENV", "ENV")},
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "GITHUB_REPOSITORY": "o/r",
        "CURRENT": "1.2.3",
        "NEW_VERSION": "1.2.4",
        "VERSION": "1.2.4",
    }
    return {"origin": origin, "work": work, "env": env, "log": log, "ci": ci, "tmp": tmp_path}


def _run_step(repo: dict, name: str, **extra_env: str) -> subprocess.CompletedProcess:
    script = _step(name)["run"]
    assert "${{" not in script, f"{name} uses an expression; pass it through env"
    return subprocess.run(
        ["bash", "-e", "-c", script],
        cwd=repo["work"],
        env={**repo["env"], **extra_env},
        capture_output=True,
        text=True,
    )


def _release(repo: dict) -> list[str]:
    """Run bump, build, commit+tag, publish in order; stop at the first failure."""
    ran = []
    for name in ("Bump version files", "Build aiui", "Commit and tag", "Publish aiui to PyPI"):
        if _run_step(repo, name).returncode != 0:
            break
        ran.append(name)
    return ran


@needs_git
def test_release_pushes_commit_and_tag_before_publish(release_repo):
    ran = _release(release_repo)
    assert ran[-1] == "Publish aiui to PyPI"
    origin = release_repo["origin"]
    assert _git(origin, "log", "-1", "--format=%s", "main") == "Release v1.2.4"
    assert 'version = "1.2.4"' in _git(origin, "show", "main:pyproject.toml")
    assert _git(origin, "rev-parse", "v1.2.4^{commit}") == _git(origin, "rev-parse", "main")
    assert "publish:tag-on-origin" in release_repo["log"].read_text()


@needs_git
def test_main_moved_means_nothing_is_published(release_repo):
    # Someone merges while the release waits: the fast-forward push is rejected.
    other = release_repo["tmp"] / "other"
    _git(release_repo["tmp"], "clone", "-q", str(release_repo["origin"]), str(other))
    for key, val in (
        ("user.name", "o"),
        ("user.email", "o@example.com"),
        ("commit.gpgsign", "false"),
    ):
        _git(other, "config", key, val)
    (other / "NEW.md").write_text("merged meanwhile\n")
    _git(other, "add", "-A")
    _git(other, "commit", "-q", "-m", "unverified merge")
    _git(other, "push", "-q", "origin", "HEAD:main")
    moved = _git(release_repo["origin"], "rev-parse", "main")

    ran = _release(release_repo)
    assert "Publish aiui to PyPI" not in ran
    assert "uv publish" not in release_repo["log"].read_text()
    assert _git(release_repo["origin"], "rev-parse", "main") == moved
    assert "v1.2.4" not in _git(release_repo["origin"], "tag")


@needs_git
def test_republish_of_a_pushed_version_does_not_need_a_new_commit(release_repo):
    """Recovery path: the push landed but `uv publish` failed; re-dispatch with version=X."""
    assert _release(release_repo)[-1] == "Publish aiui to PyPI"
    head = _git(release_repo["origin"], "rev-parse", "main")
    _git(release_repo["work"], "fetch", "-q", "origin")
    _git(release_repo["work"], "reset", "-q", "--hard", "origin/main")
    again = {**release_repo, "env": {**release_repo["env"], "CURRENT": "1.2.4"}}
    for name in ("Bump version files", "Build aiui", "Commit and tag"):
        result = _run_step(again, name)
        assert result.returncode == 0, result.stderr
    assert _git(release_repo["origin"], "rev-parse", "main") == head


@needs_git
@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
@pytest.mark.parametrize(
    "case, ci, expect_ok",
    [
        ("trigger is main, CI green", [{"status": "completed", "conclusion": "success"}], True),
        ("CI red", [{"status": "completed", "conclusion": "failure"}], False),
        ("CI running", [{"status": "in_progress", "conclusion": ""}], False),
        ("main moved", [{"status": "completed", "conclusion": "success"}], False),
        ("wrong checkout", [{"status": "completed", "conclusion": "success"}], False),
    ],
)
def test_verify_step(release_repo, case, ci, expect_ok):
    release_repo["ci"].write_text(json.dumps(ci))
    trigger = _git(release_repo["work"], "rev-parse", "HEAD")
    if case == "main moved":
        _git(release_repo["work"], "commit", "-q", "--allow-empty", "-m", "later")
        _git(release_repo["work"], "push", "-q", "origin", "HEAD:main")
        _git(release_repo["work"], "checkout", "-q", trigger)
    if case == "wrong checkout":
        trigger = "f" * 40
    result = _run_step(release_repo, "Verify the release commit", TRIGGER_SHA=trigger)
    assert (result.returncode == 0) is expect_ok, result.stdout + result.stderr
