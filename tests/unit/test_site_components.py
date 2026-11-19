"""The site's own React components as docs tags: ``site.components`` and plugin ``blocks()``."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from praisonaiui.compiler import Compiler
from praisonaiui.plugin_registry import get_plugin_registry
from praisonaiui.schema.models import Config

MODULE = """import { jsx } from 'react/jsx-runtime'
import { registerBlock } from '@aiui/sdk'
registerBlock('Pricing', ({ plan, children }) => jsx('section', { children: [plan, children] }))
export function PlanChart() { return null }
export const helper = 1
"""
PAGE = '# Plans\n\n<Pricing plan="pro" seats={3}>\nFree to start.\n</Pricing>\n\nSee <PlanChart /> and <Gadget />.\n'


def _build(tmp_path: Path, components=None, page: str = PAGE, **extra) -> tuple[Path, Compiler, list[str]]:
    (tmp_path / "docs").mkdir(exist_ok=True)
    (tmp_path / "docs" / "index.md").write_text("# Home\n", encoding="utf-8")
    (tmp_path / "docs" / "plans.md").write_text(page, encoding="utf-8")
    (tmp_path / "components").mkdir(exist_ok=True)
    (tmp_path / "components" / "index.js").write_text(MODULE, encoding="utf-8")
    site = {"title": "Acme", **extra, **({"components": components} if components is not None else {})}
    compiler = Compiler(Config.model_validate({"site": site, "content": {"docs": {"dir": "docs"}}}), base_path=tmp_path)
    out = tmp_path / "out"
    result = compiler.compile(out)
    assert result.success, result.error
    return out, compiler, result.warnings


def _ui(out: Path) -> dict:
    return json.loads((out / "ui-config.json").read_text(encoding="utf-8"))


def test_a_module_path_publishes_the_module_its_tags_shims_and_import_map(tmp_path):
    out, _, warnings = _build(tmp_path, "./components/index.js")
    tags = _ui(out)["site"]["components"]
    assert sorted(tags) == ["PlanChart", "Pricing"]  # found in the module; `helper` is no tag
    assert re.fullmatch(r"/components/index\.js\?v=[0-9a-f]{10}", tags["Pricing"])
    assert (out / "components" / "index.js").read_text(encoding="utf-8") == MODULE
    sdk = (out / "_aiui" / "externals" / "sdk.js").read_text(encoding="utf-8")
    assert "window.__AIUI_SDK__" in sdk and "registerBlock" in sdk
    for name in ("index.html", "404.html", "docs/plans.html"):
        page = (out / name).read_text(encoding="utf-8")
        imports = json.loads(re.search(r'<script type="importmap">(.*?)</script>', page).group(1))["imports"]
        assert set(imports) == {"react", "react/jsx-runtime", "react-dom", "react-dom/client", "@aiui/sdk"}
        assert re.fullmatch(r"/_aiui/externals/sdk\.js\?v=[0-9a-f]{10}", imports["@aiui/sdk"])
        assert page.index('type="importmap"') < page.index('type="module"')  # before any module loads
    # The build no longer warns about the site's tags, only about the unknown one.
    shown = [w for w in warnings if "is not a docs component" in w]
    assert len(shown) == 1 and "<Gadget>" in shown[0]


def test_the_import_map_is_allowed_by_the_content_security_policy(tmp_path):
    out, _, _ = _build(tmp_path, "./components/index.js")
    headers = (out / "_headers").read_text(encoding="utf-8")
    page = (out / "index.html").read_text(encoding="utf-8")
    script = re.search(r'<script type="importmap">(.*?)</script>', page).group(1)
    import base64
    import hashlib

    assert f"'sha256-{base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()}'" in headers
    assert "script-src 'self'" in headers


def test_declared_tags_are_the_only_tags_and_the_base_path_reaches_the_import_map(tmp_path):
    out, _, _ = _build(tmp_path, {"src": "components/index.js", "tags": ["Pricing"]}, basePath="/acme")
    assert list(_ui(out)["site"]["components"]) == ["Pricing"]  # the browser adds the base itself
    page = (out / "docs" / "plans.html").read_text(encoding="utf-8")
    assert '"@aiui/sdk":"/acme/_aiui/externals/sdk.js?v=' in page
    with pytest.raises(ValidationError, match="not a component name"):
        Config.model_validate({"site": {"title": "x", "components": {"src": "a.js", "tags": ["pricing"]}}})


def test_a_missing_module_is_a_7021_issue_and_nothing_is_added(tmp_path):
    out, compiler, warnings = _build(tmp_path, "./components/missing.js")
    assert any("site.components" in w and "not a .js or .mjs file" in w for w in warnings)
    assert "components" not in _ui(out)["site"]
    assert any(i.code == 7021 for i in compiler.lint_content())


def test_a_site_without_components_is_unchanged(tmp_path):
    out, _, _ = _build(tmp_path, page="# Plans\n")
    assert "components" not in _ui(out)["site"]
    assert not (out / "_aiui").exists()
    assert 'type="importmap"' not in (out / "index.html").read_text(encoding="utf-8")


class _CardsPlugin:
    name = "cards"

    def __init__(self, static: Path) -> None:
        self._static = static

    def static_dir(self):
        return self._static

    def blocks(self):
        return [{"type": "HelloCard", "module": "cards.js"}, {"type": "hello_badge", "module": "cards.js"}]


def test_a_plugin_block_with_a_component_name_is_a_tag_when_a_page_uses_it(tmp_path):
    static = tmp_path / "plugin-static"
    static.mkdir()
    (static / "cards.js").write_text("export function HelloCard() { return null }\n", encoding="utf-8")
    registry = get_plugin_registry()
    plugin = _CardsPlugin(static)
    registry.register(plugin)
    try:
        out, _, warnings = _build(tmp_path, page="# Plans\n\n<HelloCard title=\"Hi\" />\n")
    finally:
        registry._manual.remove(plugin)
        registry._records = None
    assert _ui(out)["site"]["components"] == {"HelloCard": "/_plugins/cards/cards.js"}
    assert (out / "_plugins" / "cards" / "cards.js").is_file()
    assert (out / "_aiui" / "externals" / "react.js").is_file()
    assert not [w for w in warnings if "is not a docs component" in w]
