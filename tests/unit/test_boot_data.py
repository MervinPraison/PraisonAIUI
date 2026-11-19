"""Fewer requests before a built docs page draws (compiler/boot_data.py).

Every page ``aiui build`` writes carries ``docs-nav.json`` and
``route-manifest.json`` as one JSON script and preloads ``ui-config.json``; the
plugin loader's tag names the plugins (no ``plugins.json`` request) and the
default plugins are only those that act on React docs pages.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from praisonaiui.compiler import Compiler, boot_data
from praisonaiui.http_guard import strip_page_content
from praisonaiui.schema.models import Config, SiteConfig
from praisonaiui.utils import json_for_html

BLOCK = re.compile(r'<script type="application/json" id="aiui-boot-data">(.*?)</script>', re.S)
AUTH = {"password": "env:DOCS_PASSWORD"}


def _build(tmp_path: Path, auth: dict | None = None, base: str | None = None, **site) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True, exist_ok=True)
    (docs / "index.md").write_text("---\ntitle: Home\n---\n\nWelcome.\n", encoding="utf-8")
    (docs / "guide" / "first.md").write_text("---\ntitle: First\n---\n\n# First\n\nText.\n", encoding="utf-8")
    data = {"site": {"title": "Boot", **site}, "style": "docs",
            "content": {"docs": {"dir": "docs", **({"auth": auth} if auth else {})}}}
    out = tmp_path / "out"
    result = Compiler(Config.model_validate(data), base_path=tmp_path, url_base=base).compile(out)
    assert result.success, result.error
    return out


def _pages(out: Path) -> list[Path]:
    pages = [out / "index.html", out / "404.html", *out.glob("docs/**/*.html")]
    assert len(pages) >= 4
    return pages


def _inlined(html: str) -> dict:
    found = BLOCK.findall(html)
    assert len(found) == 1
    return json.loads(found[0])


def test_every_page_carries_the_nav_and_route_manifest_exactly_as_written(tmp_path):
    out = _build(tmp_path)
    files = {f"/{name}": json.loads((out / name).read_text(encoding="utf-8")) for name in boot_data.FILES}
    for page in _pages(out):
        html = page.read_text(encoding="utf-8")
        assert _inlined(html) == files, page
        assert "/ui-config.json" not in _inlined(html)  # a live server answers it with more
        assert html.count('<link rel="preload" href="/ui-config.json" as="fetch" crossorigin>') == 1, page
        # Inside <body> after the root, and the page's own markdown still follows the noscript copy.
        assert html.index('<div id="root">') < html.index('id="aiui-boot-data"') < html.index("</body>")


def test_the_block_is_json_that_cannot_close_its_script(tmp_path):
    out = _build(tmp_path)
    nav = json.loads((out / "docs-nav.json").read_text(encoding="utf-8"))
    nav["items"].append({"title": "</script><script>alert(1)</script>", "path": "/docs/x"})
    (out / "docs-nav.json").write_text(json.dumps(nav), encoding="utf-8")
    block = boot_data.script(out)
    assert block.count("</script>") == 1 and "<script>alert" not in block
    assert json.loads(BLOCK.search(block).group(1))["/docs-nav.json"] == nav


def test_a_site_with_sign_in_keeps_its_nav_out_of_the_pages(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCS_PASSWORD", "pass")
    out = _build(tmp_path, auth=AUTH)
    for page in _pages(out):
        inlined = _inlined(page.read_text(encoding="utf-8"))
        assert "/docs-nav.json" not in inlined  # cut per reader by docs_auth.py
        assert "/route-manifest.json" in inlined


def test_a_file_over_the_limit_is_fetched_instead(tmp_path, monkeypatch):
    out = _build(tmp_path)
    size = {name: len(json_for_html(json.loads((out / name).read_text(encoding="utf-8"))).encode()) for name in boot_data.FILES}
    assert size["docs-nav.json"] > size["route-manifest.json"]
    monkeypatch.setattr(boot_data, "MAX_BYTES", size["route-manifest.json"])
    assert list(_inlined(boot_data.script(out))) == ["/route-manifest.json"]  # the nav is fetched
    monkeypatch.setattr(boot_data, "MAX_BYTES", 1)
    assert boot_data.script(out) == ""


def test_under_a_base_path_the_preload_carries_it_and_the_keys_stay_app_paths(tmp_path):
    out = _build(tmp_path, base="/repo")
    html = (out / "docs" / "guide" / "first.html").read_text(encoding="utf-8")
    assert '<link rel="preload" href="/repo/ui-config.json" as="fetch" crossorigin>' in html
    assert set(_inlined(html)) == {"/docs-nav.json", "/route-manifest.json"}


def test_a_page_served_without_its_content_loses_the_block_and_the_preload(tmp_path):
    out = _build(tmp_path, base="/repo")
    stripped = strip_page_content((out / "docs" / "guide" / "first.html").read_text(encoding="utf-8"))
    assert "aiui-boot-data" not in stripped and "ui-config.json" not in stripped
    assert '<div id="root"></div>' in stripped


def test_the_loader_tag_names_the_plugins_so_plugins_json_is_not_fetched(tmp_path):
    out = _build(tmp_path, plugins=["nav-intercept", "mermaid"])
    listed = json.loads((out / "plugins" / "plugins.json").read_text(encoding="utf-8"))["plugins"]
    for page in _pages(out):
        tag = re.search(r"<script [^>]*plugin-loader\.js[^>]*>", page.read_text(encoding="utf-8")).group(0)
        assert f'data-plugins="{",".join(listed)}"' in tag, page
    loader = (out / "plugins" / "plugin-loader.js").read_text(encoding="utf-8")
    assert "data-plugins" in loader and "plugins.json" in loader  # the fallback for servers and old pages


def test_the_default_plugins_leave_out_fetch_retry():
    # The app fetches its manifests with its own retry or reads them from the page,
    # so fetch-retry would only wrap window.fetch on every page for nothing.
    assert SiteConfig(title="x").plugins == ["nav-intercept"]


def test_nav_intercept_reads_the_inlined_nav_before_fetching_it():
    source = Path("src/praisonaiui/templates/frontend/plugins/nav-intercept.js").read_text(encoding="utf-8")
    assert source.index("aiui-boot-data") < source.index("fetch(BASE + '/docs-nav.json')")
