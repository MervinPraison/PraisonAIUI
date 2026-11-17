"""Docs page footer facts (compiler/page_meta.py) and their place in ``aiui build``."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from praisonaiui.compiler import page_meta
from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
)


def _git(cwd: Path, *args: str, date: str | None = None) -> None:
    env = {"GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date} if date else {}
    import os

    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=cwd, check=True, capture_output=True, env={**os.environ, **env},
    )


def test_edit_url_replaces_path():
    assert page_meta.edit_url("https://g/edit/main/docs/:path", "guide/a.md") == "https://g/edit/main/docs/guide/a.md"
    assert page_meta.edit_url("https://g/:path?plain=1", "/a.md") == "https://g/a.md?plain=1"


def test_nothing_is_added_when_not_configured(tmp_path: Path):
    nav = {"items": [{"title": "A", "path": "/docs/a"}]}
    page_meta.annotate_nav(nav, lambda p: tmp_path / "a.md", tmp_path)
    assert nav == {"items": [{"title": "A", "path": "/docs/a"}]}


def _site(tmp_path: Path, **docs_kwargs) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
    (docs / "index.md").write_text("# Home\n", encoding="utf-8")
    (docs / "guide" / "first.md").write_text("# First\n", encoding="utf-8")
    return docs


def _build(tmp_path: Path, **docs_kwargs) -> tuple[dict, dict]:
    config = Config(
        site=SiteConfig(title="Docs"),
        content=ContentConfig(docs=ContentSourceConfig(dir=str(tmp_path / "docs"), **docs_kwargs)),
        templates={"docs": TemplateConfig(layout="ThreeColumnLayout", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(out).success
    nav = json.loads((out / "docs-nav.json").read_text(encoding="utf-8"))
    ui = json.loads((out / "ui-config.json").read_text(encoding="utf-8"))
    return nav, ui


def _pages(nav: dict) -> dict[str, dict]:
    found: dict[str, dict] = {}

    def walk(items):
        for item in items:
            if item.get("path"):
                found[item["path"]] = item
            walk(item.get("children") or [])

    walk(nav["items"])
    return found


@pytest.mark.skipif(subprocess.run(["git", "--version"], capture_output=True).returncode != 0, reason="git not installed")
def test_build_adds_commit_dates_edit_links_and_footer_text(tmp_path: Path):
    _site(tmp_path)
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", "docs/index.md")
    _git(tmp_path, "commit", "-qm", "home", date="2026-01-02T10:00:00+00:00")
    _git(tmp_path, "add", "docs/guide/first.md")
    _git(tmp_path, "commit", "-qm", "first", date="2026-03-04T10:00:00+00:00")
    page_meta.git_root.cache_clear()

    nav, ui = _build(
        tmp_path,
        editLink={"pattern": "https://github.com/acme/site/edit/main/docs/:path", "text": "Improve this page"},
        lastUpdated=True,
        feedback={"issues": "https://github.com/acme/site/issues/new"},
    )
    first = next(v for k, v in _pages(nav).items() if k.endswith("/guide/first"))
    assert first["lastUpdated"] == "2026-03-04"
    assert first["editUrl"] == "https://github.com/acme/site/edit/main/docs/guide/first.md"
    home = next(v for k, v in _pages(nav).items() if k.endswith("/index") or k == "/docs")
    assert home["lastUpdated"] == "2026-01-02"
    assert ui["pageFooter"] == {"editText": "Improve this page", "feedbackIssues": "https://github.com/acme/site/issues/new"}


def test_no_git_means_no_dates_but_edit_links_stay(tmp_path: Path, monkeypatch):
    _site(tmp_path)
    monkeypatch.setattr(page_meta, "git_root", lambda start: None)
    nav, ui = _build(tmp_path, editLink={"pattern": "https://g/edit/:path"}, lastUpdated=True)
    first = next(v for k, v in _pages(nav).items() if k.endswith("/guide/first"))
    assert "lastUpdated" not in first
    assert first["editUrl"] == "https://g/edit/guide/first.md"
    assert ui["pageFooter"] == {"editText": "Edit this page"}


def test_a_shallow_clone_shows_no_dates(tmp_path: Path, monkeypatch):
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)

        class R:
            stdout = "true\n" if "--is-shallow-repository" in args else str(tmp_path) + "\n"

        return R()

    monkeypatch.setattr(page_meta.subprocess, "run", fake_run)
    page_meta.git_root.cache_clear()
    assert page_meta.git_root(str(tmp_path)) is None
    page_meta.git_root.cache_clear()
