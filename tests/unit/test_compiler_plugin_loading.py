"""`aiui build` loads few legacy plugins, from cacheable URLs.

The React docs app renders code, mermaid, tabs, the TOC and the header tabs
itself. The old default plugin list loaded eight plugins that skip React docs
pages, two of them pulling ~40 files from cdn.jsdelivr.net and
cdnjs.cloudflare.com, and plugin-loader imported each as ``?v=<Date.now()>``,
so nothing was ever cached. Every extra origin and uncached request is another
chance for one stalled connection to hold up a docs page.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from praisonaiui.compiler import Compiler
from praisonaiui.schema.models import Config, SiteConfig

PLUGINS = Path("src/praisonaiui/templates/frontend/plugins")
CDN_PLUGINS = ("mermaid", "syntax-highlight")
INERT_ON_REACT_DOCS = ("mkdocs-compat", "content-loader", "homepage", "toc", "topnav", "code-copy")


def _compile(tmp_path: Path, **site) -> Path:
    docs = tmp_path / "docs"
    docs.mkdir(parents=True, exist_ok=True)
    (docs / "guide.md").write_text("# Guide\n", encoding="utf-8")
    config = Config(site=SiteConfig(title="Plugins", **site), content={"docs": {"dir": "./docs"}})
    out = tmp_path / "site"
    result = Compiler(config, base_path=tmp_path).compile(out)
    assert result.success, result.error
    return out


def test_default_site_loads_only_plugins_that_act_on_react_docs():
    plugins = SiteConfig(title="x").plugins
    assert plugins == ["nav-intercept"]
    assert not set(plugins) & set(CDN_PLUGINS + INERT_ON_REACT_DOCS)


def test_a_site_can_still_opt_into_a_legacy_plugin(tmp_path):
    out = _compile(tmp_path, plugins=["fetch-retry", "mermaid"])
    assert json.loads((out / "plugins" / "plugins.json").read_text())["plugins"] == ["fetch-retry", "mermaid"]
    assert (out / "plugins" / "mermaid.js").is_file()


def test_loader_url_carries_the_plugins_version_on_every_page(tmp_path):
    out = _compile(tmp_path)
    version = json.loads((out / "plugins" / "plugins.json").read_text())["version"]
    assert re.fullmatch(r"[0-9a-f]{10}", version)
    pages = [out / "index.html", out / "404.html", *out.glob("docs/**/*.html")]
    assert len(pages) >= 3
    for page in pages:
        html = page.read_text(encoding="utf-8")
        assert f'src="/plugins/plugin-loader.js?v={version}"' in html, page.name
        assert html.count("plugin-loader.js") == 1, page.name


def test_plugins_version_follows_the_plugin_files(tmp_path):
    first = _compile(tmp_path / "a")
    again = _compile(tmp_path / "b")
    other = _compile(tmp_path / "c", plugins=["fetch-retry"])
    version = lambda out: json.loads((out / "plugins" / "plugins.json").read_text())["version"]  # noqa: E731
    assert version(first) == version(again), "the same plugins keep their URL (cacheable)"
    assert version(first) != version(other), "different plugin files get a new URL"


def test_plugin_loader_imports_with_a_stable_version_not_the_clock():
    source = (PLUGINS / "plugin-loader.js").read_text(encoding="utf-8")
    assert "Date.now()" not in source
    assert "document.currentScript" in source  # its own ?v=
    assert "config.version" in source  # else plugins.json's


def test_syntax_highlight_does_not_request_a_missing_html_grammar():
    source = (PLUGINS / "syntax-highlight.js").read_text(encoding="utf-8")
    langs = re.search(r"const langs = \[([^\]]*)\]", source).group(1)
    assert "'html'" not in langs  # html is the xml grammar; languages/html.min.js 404s
    assert "'xml'" in langs
