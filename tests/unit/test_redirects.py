"""Redirects and the 404 page (compiler/redirects.py, docs/features/redirects.md)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient

from praisonaiui.cli import _static_site_app
from praisonaiui.compiler import Compiler
from praisonaiui.compiler import redirects as rd
from praisonaiui.compiler.links import check_links
from praisonaiui.schema.models import Config, RedirectConfig

RULES = [
    {"source": "/docs/old-start", "destination": "/docs/guide/start"},
    {"source": "/docs/beta/:slug*", "destination": "/docs/guide/:slug*"},
    {"source": "/blog/:year/:post", "destination": "/news/:post?y=:year", "permanent": False},
    {"source": "/away", "destination": "https://example.com/x"},
    {"source": "/docs/guide/start", "destination": "/docs/index"},  # a page: the page wins
]


def _build(tmp_path: Path, url_base: str | None = None, rules=RULES, **extra) -> tuple[Compiler, Path]:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True, exist_ok=True)
    (docs / "index.md").write_text("# Home\n\nHello.\n", encoding="utf-8")
    (docs / "guide" / "start.md").write_text("# Start\n\nGo.\n", encoding="utf-8")
    config = Config.model_validate(
        {"site": {"title": "R"}, "content": {"docs": {"dir": "./docs"}}, "redirects": rules, **extra}
    )
    compiler = Compiler(config, base_path=tmp_path, url_base=url_base)
    out = tmp_path / "site"
    result = compiler.compile(out)
    assert result.success, result.error
    return compiler, out


def test_wildcards_and_params_match_and_expand():
    rules = [RedirectConfig.model_validate(r) for r in RULES]
    assert rd.match(rules, "/docs/beta/a/b/")[1] == "/docs/guide/a/b"
    assert rd.match(rules, "/docs/beta")[1] == "/docs/guide"
    assert rd.match(rules, "/blog/2024/hello")[1] == "/news/hello?y=2024"
    assert rd.match(rules, "/blog/2024") is None
    assert rd.match(rules, "/docs/betamax") is None
    assert rd.netlify_lines(rules[:3], "/repo") == [
        "/repo/docs/old-start /repo/docs/guide/start 301",
        "/repo/docs/beta/* /repo/docs/guide/:splat 301",
        "/repo/blog/:year/:post /repo/news/:post?y=:year 302",
    ]


@pytest.mark.parametrize("source", ["docs/x", "/a/:rest*/b"])
def test_bad_sources_are_config_errors(source):
    with pytest.raises(ValidationError):
        RedirectConfig(source=source, destination="/")


def test_build_writes_stubs_redirects_file_and_ui_config(tmp_path):
    _, out = _build(tmp_path, "/repo", seo={"siteUrl": "https://acme.dev/repo"})
    stub = (out / "docs/old-start.html").read_text(encoding="utf-8")
    assert (out / "docs/old-start/index.html").read_text(encoding="utf-8") == stub
    assert 'http-equiv="refresh" content="0; url=/repo/docs/guide/start"' in stub
    assert '<link rel="canonical" href="https://acme.dev/repo/docs/guide/start">' in stub
    assert 'location.replace("/repo/docs/guide/start"+location.search+location.hash)' in stub
    assert 'url=https://example.com/x"' in (out / "away.html").read_text(encoding="utf-8")
    # the page at /docs/guide/start keeps its file; its rule is dropped everywhere
    assert "Redirecting" not in (out / "docs/guide/start.html").read_text(encoding="utf-8")
    lines = (out / "_redirects").read_text(encoding="utf-8").splitlines()
    assert "/repo/docs/beta/* /repo/docs/guide/:splat 301" in lines
    assert not any(line.startswith("/repo/docs/guide/start ") for line in lines)
    ui = json.loads((out / "ui-config.json").read_text(encoding="utf-8"))
    assert [r["source"] for r in ui["redirects"]] == [r["source"] for r in RULES[:4]]


def test_serve_answers_301_and_302(tmp_path):
    _, out = _build(tmp_path, "/repo")
    client = TestClient(_static_site_app(out), follow_redirects=False)

    def hop(path: str) -> tuple[int, str]:
        r = client.get(path)
        return r.status_code, r.headers.get("location", "")

    assert hop("/repo/docs/old-start?q=1") == (301, "/repo/docs/guide/start?q=1")
    assert hop("/repo/docs/beta/start") == (301, "/repo/docs/guide/start")
    assert hop("/repo/blog/2024/hi") == (302, "/repo/news/hi?y=2024")
    assert hop("/repo/away") == (301, "https://example.com/x")
    assert client.get("/repo/docs/guide/start").status_code == 200  # the page wins


def test_validate_flags_loops_dead_ends_and_hidden_rules(tmp_path):
    compiler, _ = _build(tmp_path)
    compiler.config.redirects += [
        RedirectConfig(source="/docs/a", destination="/docs/b"),
        RedirectConfig(source="/docs/b", destination="/docs/a"),
        RedirectConfig(source="/docs/c", destination="/docs/gone"),
        RedirectConfig(source="/docs/d", destination="/docs/old-start"),  # a chain to a page: fine
    ]
    found = {(i.code, i.message) for i in compiler.lint_content("aiui.yaml") if i.code in (7010, 7011)}
    assert found == {
        (7011, "redirect /docs/guide/start: a page is published there, so the redirect never runs"),
        (7010, "redirect /docs/a loops back to /docs/a"),
        (7010, "redirect /docs/b loops back to /docs/b"),
        (7010, "redirect /docs/c leads to /docs/gone, which is not a docs page"),
    }


def test_link_check_accepts_wildcard_sources(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.md").write_text("[x](/docs/beta/deep/page)\n", encoding="utf-8")
    assert not check_links(docs).ok
    assert check_links(docs, redirects=["/docs/beta/:slug*"]).ok


def test_errors_404_reaches_the_app_and_no_redirects_writes_nothing(tmp_path):
    errors = {404: {"title": "Lost?", "description": "Try **search**.", "redirect": False}}
    _, out = _build(tmp_path, rules=[], errors=errors)
    ui = json.loads((out / "ui-config.json").read_text(encoding="utf-8"))
    assert "redirects" not in ui and not (out / "_redirects").exists()
    assert ui["errors"] == {"notFound": {"title": "Lost?", "description": "Try **search**.", "redirect": False}}
    assert Config.model_validate({"site": {"title": "x"}, "errors": {"notFound": {"redirect": True}}}).errors.not_found.redirect
