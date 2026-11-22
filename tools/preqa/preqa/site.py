"""Build the docs site from a git ref, the way the Pages deploy does.

Layout under ``PREQA_HOME`` (default ``~/preqa``)::

    repo/                 read-only https clone (fetch only, never pushed)
    venv-build/           Python env with the ref's ``aiui`` installed
    builds/<name>-<sha>/  one built site per ref and commit (last 3 kept)
    sites/<name>          symlink to the live build of that name ("main", "pr-123", ...)
    history/builds.jsonl  one line per build attempt

Refs: ``main`` (default), any branch name, or ``pr/<number>``.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

from . import history

REPO_URL = os.environ.get("PREQA_REPO", "https://github.com/MervinPraison/PraisonAIUI.git")
KEEP_BUILDS = 3


def home() -> Path:
    return Path(os.environ.get("PREQA_HOME", Path.home() / "preqa"))


def _git(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def name_for(ref: str) -> str:
    return ref.replace("pr/", "pr-").replace("/", "-")


def fetch(ref: str) -> str:
    """Fetch ``ref`` into the local clone and return its commit sha."""
    repo = home() / "repo"
    if not (repo / ".git").is_dir():
        repo.parent.mkdir(parents=True, exist_ok=True)
        _git("clone", "--filter=blob:none", "--no-checkout", REPO_URL, str(repo))
    src = f"pull/{ref[3:]}/head" if ref.startswith("pr/") else ref
    _git("fetch", "--quiet", "--force", "origin", f"{src}:refs/preqa/{name_for(ref)}", cwd=repo)
    return _git("rev-parse", f"refs/preqa/{name_for(ref)}", cwd=repo)


def remote_sha(ref: str = "main") -> str:
    out = _git("ls-remote", REPO_URL, f"refs/heads/{ref}")
    return out.split()[0] if out else ""


def current(name: str = "main") -> dict:
    meta = home() / "sites" / name / "preqa-build.json"
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _uv() -> str:
    return shutil.which("uv") or str(Path.home() / ".local/bin/uv")


def build(ref: str = "main") -> dict:
    """Build ``ref`` and switch ``sites/<name>`` to it. Returns the build record."""
    h, name, t0 = home(), name_for(ref), time.time()
    rec: dict = {"ts": history.utc_now(), "ref": ref, "name": name, "ok": False}
    try:
        sha = rec["sha"] = fetch(ref)
        out = h / "builds" / f"{name}-{sha[:12]}"
        src = h / "work" / f"{name}-{sha[:12]}"
        shutil.rmtree(src, ignore_errors=True)
        src.mkdir(parents=True)
        archive = h / "work" / f"{name}.tar"
        _git("archive", "--format=tar", "-o", str(archive), sha, cwd=h / "repo")
        with tarfile.open(archive) as tf:
            tf.extractall(src, filter="data")
        archive.unlink()
        venv = h / "venv-build"
        if not (venv / "bin/python").exists():
            subprocess.run([_uv(), "venv", "--quiet", "--python", "3.11", str(venv)], check=True)
        env = {**os.environ, "VIRTUAL_ENV": str(venv), "AIUI_NO_BROWSER": "1", "BROWSER": "true"}
        subprocess.run([_uv(), "pip", "install", "--quiet", "--reinstall-package", "aiui", str(src)],
                       check=True, env=env, cwd=src)
        aiui = str(venv / "bin/aiui")
        tmp = out.with_name(out.name + ".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        log = subprocess.run([aiui, "build", "--output", str(tmp), "--minify"], cwd=src, env=env,
                             capture_output=True, text=True)
        if log.returncode != 0:
            raise RuntimeError(f"aiui build failed: {(log.stderr or log.stdout)[-800:]}")
        subprocess.run([aiui, "schema", "--output", str(tmp / "aiui.schema.json")], cwd=src, env=env,
                       check=True, capture_output=True)
        prev = h / "sites" / name
        carry = src / "src/frontend/scripts/carry-forward-assets.mjs"
        if prev.exists() and carry.is_file() and shutil.which("node"):
            subprocess.run(["node", str(carry), str(prev.resolve()), str(tmp)], check=True, capture_output=True)
        rec.update(ok=True, build_s=round(time.time() - t0, 1),
                   pages=sum(1 for _ in tmp.rglob("*.html")))
        (tmp / "preqa-build.json").write_text(json.dumps(rec), encoding="utf-8")
        shutil.rmtree(out, ignore_errors=True)
        tmp.rename(out)
        link = h / "sites" / name
        link.parent.mkdir(parents=True, exist_ok=True)
        new_link = link.with_name(name + ".new")
        if new_link.is_symlink():
            new_link.unlink()
        new_link.symlink_to(out)
        new_link.replace(link)
        shutil.rmtree(src, ignore_errors=True)
        _prune(h / "builds", name, keep=out)
    except (subprocess.CalledProcessError, RuntimeError, OSError) as exc:
        detail = getattr(exc, "stderr", None) or str(exc)
        rec["error"] = str(detail)[-800:]
    rec["build_s"] = round(time.time() - t0, 1)
    (h / "history").mkdir(parents=True, exist_ok=True)
    with open(h / "history" / "builds.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
    return rec


def _prune(builds: Path, name: str, keep: Path) -> None:
    old = sorted((p for p in builds.glob(f"{name}-*") if p.is_dir() and not p.name.endswith(".tmp")),
                 key=lambda p: p.stat().st_mtime, reverse=True)
    for p in old[KEEP_BUILDS:]:
        if p != keep:
            shutil.rmtree(p, ignore_errors=True)
