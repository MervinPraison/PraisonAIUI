"""`aiui build --base-path`: a static docs build served under a path prefix.

A GitHub project site lives at ``user.github.io/repo`` and docs behind a proxy
at ``example.com/docs``. Every URL the built HTML asks for must carry the
prefix, and the app learns it from ``<meta name="aiui-base">``
(src/frontend/src/lib/url.ts).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from starlette.testclient import TestClient
from typer.testing import CliRunner

from praisonaiui.cli import _static_site_app, app
from praisonaiui.compiler import Compiler
from praisonaiui.compiler.base_path import normalize_base_path, resolve_base_path
from praisonaiui.schema.models import Config, SiteConfig

URL_ATTR = re.compile(r"""\s(src|href|content)=["']([^"']*)["']""")
GH = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "Acme/widgets"}


def _project(tmp_path: Path) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True, exist_ok=True)
    (docs / "index.md").write_text(
        "---\nlayout: home\nhero:\n  name: Sub\n  image: /hero.png\n---\n"
        "# Home\n\nSee [the guide](guide/start.md).\n",
        encoding="utf-8",
    )
    (docs / "guide" / "start.md").write_text("# Start\n", encoding="utf-8")
    return tmp_path


def _build(tmp_path: Path, url_base: str | None = None, seo: dict | None = None, **site) -> Path:
    config = Config(
        site=SiteConfig(title="Sub", **site),
        content={"docs": {"dir": "./docs"}},
        **({"seo": seo} if seo else {}),
    )
    out = tmp_path / "site"
    result = Compiler(config, base_path=_project(tmp_path), url_base=url_base).compile(out)
    assert result.success, result.error
    return out


def _pages(out: Path) -> list[Path]:
    pages = sorted(out.rglob("*.html"))
    assert len(pages) >= 4
    return pages


def test_normalize_base_path():
    assert normalize_base_path("repo") == normalize_base_path("/repo/") == "/repo"
    assert normalize_base_path("/a/b") == "/a/b"
    for root in (None, "", "/", " / "):
        assert normalize_base_path(root) == ""
    for bad in ("https://x.dev/a", "/a b", "/a/../b", "/a?x=1", '/a"><script>'):
        with pytest.raises(ValueError):
            normalize_base_path(bad)


def test_the_first_setting_wins(tmp_path):
    assert resolve_base_path("/cli", "/yaml", "https://x.dev/seo", tmp_path, {}) == ("/cli", None)
    assert resolve_base_path(None, "/yaml", "https://x.dev/seo", tmp_path, {}) == ("/yaml", None)
    assert resolve_base_path(None, None, "https://x.dev/seo/", tmp_path, {}) == ("/seo", None)
    assert resolve_base_path("/", "/yaml", None, tmp_path, {}) == ("", None)
    assert resolve_base_path(None, None, None, tmp_path, GH) == ("", None), "auto only when asked"


def test_auto_detects_a_github_project_site(tmp_path):
    assert resolve_base_path("auto", None, None, tmp_path, GH) == (
        "/widgets",
        "https://acme.github.io/widgets",
    )
    user_site = {**GH, "GITHUB_REPOSITORY": "Acme/acme.github.io"}
    assert resolve_base_path("auto", None, None, tmp_path, user_site) == ("", None)
    assert resolve_base_path("auto", None, None, tmp_path, {}) == ("", None), "outside Actions"
    (tmp_path / "CNAME").write_text("docs.acme.dev\n", encoding="utf-8")
    assert resolve_base_path(None, "auto", None, tmp_path, GH) == ("", None), "custom domain"


def test_no_root_absolute_url_remains_under_a_base_path(tmp_path):
    out = _build(tmp_path, "/repo", seo={"defaultImage": "/icon.svg"})
    for page in _pages(out):
        html = page.read_text(encoding="utf-8")
        assert '<meta name="aiui-base" content="/repo" />' in html, page.name
        for attr, url in URL_ATTR.findall(html):
            if url.startswith("/") and not url.startswith("//"):
                assert url == "/repo" or url.startswith("/repo/"), (page.name, attr, url)
        assert re.search(r'src="/repo/assets/index-[0-9a-f]{10}\.js"', html)
        assert 'src="/repo/plugins/plugin-loader.js?v=' in html
    assert 'rel="preload" as="image" href="/repo/hero.png"' in (out / "index.html").read_text()
    # The inlined markdown keeps its app path: the loader's cache key (docLoader.ts).
    assert '"url": "/docs/guide/start.source.md"' in (out / "docs" / "guide" / "start.html").read_text()


def test_site_urls_carry_the_base_path(tmp_path):
    out = _build(tmp_path, seo={"siteUrl": "https://acme.github.io/widgets"})
    sitemap = (out / "sitemap.xml").read_text(encoding="utf-8")
    locs = re.findall(r"<loc>([^<]+)</loc>", sitemap)
    assert locs and all(loc.startswith("https://acme.github.io/widgets/") for loc in locs)
    page = (out / "docs" / "guide" / "start.html").read_text(encoding="utf-8")
    assert 'rel="canonical" href="https://acme.github.io/widgets/docs/guide/start"' in page
    assert re.search(r'src="/widgets/assets/index-[0-9a-f]{10}\.js"', page), "the base comes from seo.siteUrl"
    assert '"siteUrl": "https://acme.github.io/widgets"' in (out / "ui-config.json").read_text()


def test_the_default_build_is_unchanged(tmp_path):
    out = _build(tmp_path)
    root = _build(tmp_path / "root", "/")
    for page in _pages(out):
        html = page.read_text(encoding="utf-8")
        assert "aiui-base" not in html
        assert page.read_bytes() == (root / page.relative_to(out)).read_bytes()
    assert re.search(r'src="/assets/index-[0-9a-f]{10}\.js"', (out / "index.html").read_text(encoding="utf-8"))


def test_serve_previews_the_build_under_its_base_path(tmp_path):
    out = _build(tmp_path, "/repo")
    client = TestClient(_static_site_app(out), follow_redirects=False)
    root = client.get("/")
    assert root.status_code in (302, 307) and root.headers["location"] == "/repo/"
    assert client.get("/repo/").status_code == 200
    assert client.get("/repo").status_code == 200
    page = client.get("/repo/docs/guide/start")
    assert page.status_code == 200 and 'content="/repo"' in page.text
    assert client.get("/repo/assets/index.js").status_code == 200
    assert client.get("/repo/docs/guide/start.md").text.startswith("# Start")
    assert client.get("/assets/index.js").status_code == 404


def test_cli_flag_and_validation(tmp_path):
    project = _project(tmp_path)
    cfg = project / "aiui.yaml"
    cfg.write_text(
        "schemaVersion: 1\nsite:\n  title: Sub\n  basePath: /from-yaml\ncontent:\n  docs:\n    dir: ./docs\n",
        encoding="utf-8",
    )
    runner = CliRunner()
    out = project / "out"
    result = runner.invoke(app, ["build", "-c", str(cfg), "-o", str(out), "--base-path", "/cli"])
    assert result.exit_code == 0, result.output
    assert 'content="/cli"' in (out / "index.html").read_text(encoding="utf-8")
    result = runner.invoke(app, ["build", "-c", str(cfg), "-o", str(out)])
    assert 'content="/from-yaml"' in (out / "index.html").read_text(encoding="utf-8")
    result = runner.invoke(app, ["build", "-c", str(cfg), "-o", str(out), "--base-path", "/a b"])
    assert result.exit_code == 3 and "Invalid base path" in result.output
