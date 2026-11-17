"""Sidebar icons: a group's `icon:` in the navigation YAML and a page's
frontmatter `icon:` reach docs-nav.json; anything that is not an icon name is dropped."""

from __future__ import annotations

import json
from pathlib import Path

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.compiler.nav_builder import icon_name
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    NavConfig,
    NavGroupConfig,
    NavigationConfig,
    NavTabConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
)


def test_icon_names_are_plain_lucide_names() -> None:
    assert icon_name("rocket") == "rocket"
    assert icon_name(" Book-Open ") == "book-open"
    for bad in ("", None, 3, "<svg>", "a b", "x" * 41, "fa-solid fa-rocket"):
        assert icon_name(bad) == "", bad


def _build(tmp_path: Path, manual: bool) -> list[dict]:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
    (docs / "index.md").write_text("# Home\n")
    (docs / "guide" / "start.md").write_text("---\ntitle: Start\nicon: terminal\n---\n# Start\n")
    (docs / "guide" / "plain.md").write_text("---\ntitle: Plain\nicon: '<b>'\n---\n# Plain\n")
    navigation = NavigationConfig(
        tabs=[NavTabConfig(tab="Docs", groups=[NavGroupConfig(group="Guide", icon="rocket", pages=["guide/start", "guide/plain"])])]
    )
    config = Config(
        site=SiteConfig(title="T"),
        content=ContentConfig(docs=ContentSourceConfig(dir="docs", nav=NavConfig(mode="manual" if manual else "auto"))),
        navigation=navigation if manual else None,
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return json.loads((out / "docs-nav.json").read_text())["items"]


def _find(items: list[dict], title: str) -> dict:
    for item in items:
        if item["title"] == title:
            return item
        found = _find(item.get("children", []), title) if item.get("children") else None
        if found:
            return found
    return {}


def test_manual_nav_carries_group_and_page_icons(tmp_path: Path) -> None:
    items = _build(tmp_path, manual=True)
    assert _find(items, "Guide")["icon"] == "rocket"
    assert _find(items, "Start")["icon"] == "terminal"
    assert "icon" not in _find(items, "Plain")


def test_auto_nav_carries_page_icons(tmp_path: Path) -> None:
    items = _build(tmp_path, manual=False)
    assert _find(items, "Start")["icon"] == "terminal"
    assert "icon" not in _find(items, "Plain")
