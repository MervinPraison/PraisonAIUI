"""Each built docs page carries its own markdown (a JSON script that
docs/docLoader.ts adoptInlinedDoc reads), so the first render needs no request."""

from __future__ import annotations

import json
import re
from pathlib import Path

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
)

TRICKY = "# Guide\n\n```html\n</script><script>alert(1)</script>\n```\n\n<!-- a & b > c -->\n"
SCRIPT_RE = re.compile(r'<script type="application/json" id="aiui-initial-doc">(.*?)</script>', re.S)


def _build(tmp_path: Path) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
    (docs / "index.md").write_text("# Home\n\nWelcome.\n")
    (docs / "guide" / "tricky.md").write_text(TRICKY)
    config = Config(
        site=SiteConfig(title="T"),
        content=ContentConfig(docs=ContentSourceConfig(dir="docs")),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def _inlined(html: str) -> dict:
    found = SCRIPT_RE.findall(html)
    assert len(found) == 1
    return json.loads(found[0])


def test_a_page_carries_its_published_markdown(tmp_path: Path) -> None:
    out = _build(tmp_path)
    data = _inlined((out / "docs/guide/tricky.html").read_text())
    # The browser renders the source; docs/guide/tricky.md is the agent-ready copy.
    assert data["url"] == "/docs/guide/tricky.source.md"
    assert data["text"] == (out / "docs/guide/tricky.source.md").read_text()


def test_the_text_can_never_close_the_script(tmp_path: Path) -> None:
    html = (_build(tmp_path) / "docs/guide/tricky.html").read_text()
    raw = SCRIPT_RE.search(html).group(1)
    assert "<" not in raw and ">" not in raw and "&" not in raw
    assert "</script><script>alert(1)" in json.loads(raw)["text"]


def test_the_home_page_carries_the_docs_home_markdown(tmp_path: Path) -> None:
    data = _inlined((_build(tmp_path) / "index.html").read_text())
    assert data["url"] == "/docs/index.source.md"
    assert data["text"].startswith("# Home")


# ── The inlined key must be the URL the docs app requests (else every load fetches) ──

from praisonaiui.compiler import compiler as compiler_module  # noqa: E402
from praisonaiui.compiler.compiler import loader_source_url  # noqa: E402


def test_loader_source_url_mirrors_the_docs_app() -> None:
    # docs/docLoader.ts: docPathToSource(canonicalDocPath(path))
    assert loader_source_url("/docs/guide/tricky") == "/docs/guide/tricky.source.md"
    assert loader_source_url("/docs/guide/") == "/docs/guide.source.md"
    for home in ("/", "/docs", "/docs/", "/docs/index"):
        assert loader_source_url(home) == "/docs/index.source.md"


def test_every_built_page_inlines_under_the_url_the_app_requests(tmp_path: Path) -> None:
    out = _build(tmp_path)
    pages = [p for p in out.rglob("*.html") if SCRIPT_RE.search(p.read_text())]
    assert pages
    for page in pages:
        route = "/" + page.relative_to(out).with_suffix("").as_posix()
        # x/index.html is the copy of x.html for hosts that do not map /x to x.html
        route = route.removesuffix("/index") or "/"
        url = _inlined(page.read_text())["url"]
        expected = loader_source_url(route)
        if route == "/":  # the site root shows the docs home page
            expected = loader_source_url("/docs/index")
        assert url == expected, page


def test_a_key_the_app_would_not_request_is_reported(tmp_path: Path) -> None:
    out = tmp_path / "site"
    (out / "docs/guide").mkdir(parents=True)
    (out / "docs/guide/index.source.md").write_text("# Guide\n")  # only the folder-index file exists
    compiler = Compiler(Config(site=SiteConfig(title="T")), base_path=tmp_path)
    assert "/docs/guide/index.source.md" in compiler._inline_doc_script(out, "/docs/guide")
    assert compiler._inline_mismatches == [
        "/docs/guide: inlined Markdown is keyed /docs/guide/index.source.md but the docs app requests "
        "/docs/guide.source.md; the page fetches it on every load"
    ]


def test_build_strict_fails_on_a_mismatched_key(tmp_path: Path, monkeypatch) -> None:
    from typer.testing import CliRunner

    from praisonaiui.cli import app

    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.md").write_text("# Home\n")
    (docs / "page.md").write_text("# Page\n")
    (tmp_path / "aiui.yaml").write_text(
        "schemaVersion: 1\nsite:\n  title: T\ncontent:\n  docs:\n    dir: ./docs\n"
        "templates:\n  docs:\n    layout: Default\n    slots: {}\nroutes:\n  - match: /docs/**\n    template: docs\n"
    )
    monkeypatch.chdir(tmp_path)
    runner = CliRunner()
    ok = runner.invoke(app, ["build", "--output", "out1", "--strict"])
    assert ok.exit_code == 0, ok.output

    monkeypatch.setattr(compiler_module, "loader_source_url", lambda path: "/elsewhere.source.md")
    loose = runner.invoke(app, ["build", "--output", "out2"])
    assert loose.exit_code == 0, loose.output
    assert "inlined Markdown is keyed" in loose.output
    strict = runner.invoke(app, ["build", "--output", "out3", "--strict"])
    assert strict.exit_code == 1, strict.output
    assert "inline Markdown the docs app does not use" in strict.output
