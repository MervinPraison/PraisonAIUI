"""Docs versions (``navigation.versions``): folders, ui-config.json, the sidebar,
canonical links, sitemap / llms.txt / search, and the 7018 checks."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config
from praisonaiui.schema.validators import find_unknown_keys, nav_warnings

DOCS = {
    "index.md": "# Home\n\nWelcome.\n",
    "quickstart.md": "# Quickstart\n\nInstall v2.\n",
    "guide/setup.md": "# Setup\n\nNew setup.\n",
    "v1/index.md": "# Home v1\n\nOld welcome.\n",
    "v1/quickstart.md": "# Quickstart v1\n\nInstall v1.\n",
    "v1/guide/setup.md": "# Setup v1\n\nOld setup.\n",
    "v1/legacy.md": "# Legacy\n\nOnly in v1.\n",
}

YAML = """
site: {title: T}
seo: {siteUrl: "https://docs.example.com"}
content:
  docs: {dir: docs}
navigation:
  versions:
    - {version: v2, default: true, tag: Latest}
    - {version: v1, tag: Deprecated}
templates: {docs: {layout: Default, slots: {}}}
routes: [{match: "/docs/**", template: docs}]
"""


def _write(tmp_path: Path) -> None:
    for rel, body in DOCS.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)


def _build(tmp_path: Path, text: str = YAML) -> tuple[dict, dict, Path]:
    _write(tmp_path)
    out = tmp_path / "site"
    assert Compiler(Config.model_validate(yaml.safe_load(text)), base_path=tmp_path).compile(output_dir=out).success
    return json.loads((out / "ui-config.json").read_text()), json.loads((out / "docs-nav.json").read_text()), out


def _pages(items: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for item in items:
        if item.get("path"):
            out[item["path"]] = item
        out.update(_pages(item.get("children") or []))
    return out


def test_ui_config_lists_versions_with_prefix_default_and_tag(tmp_path: Path) -> None:
    ui, _, _ = _build(tmp_path)
    v2, v1 = ui["navigation"]["versions"]
    assert (v2["version"], v2["prefix"], v2.get("default"), v2["tag"]) == ("v2", "/docs", True, "Latest")
    assert (v1["version"], v1["prefix"], v1.get("default"), v1["tag"]) == ("v1", "/docs/v1", None, "Deprecated")


def test_a_version_folder_is_its_own_top_level_sidebar(tmp_path: Path) -> None:
    _, nav, _ = _build(tmp_path)
    top = [i.get("path") or i["title"] for i in nav["items"]]
    # docs/v1/ is not one "V1" section: its pages and folders are top-level entries, like the default's.
    assert "V1" not in top
    assert {"/docs/v1", "/docs/v1/quickstart", "/docs/v1/legacy"} <= set(top)
    guide = [i for i in nav["items"] if i["title"] == "Guide"]
    assert sorted(c["path"] for g in guide for c in g["children"]) == ["/docs/guide/setup", "/docs/v1/guide/setup"]


def test_older_version_canonical_robots_sitemap_llms_and_search(tmp_path: Path) -> None:
    _, nav, out = _build(tmp_path)
    pages = _pages(nav["items"])
    # The same page in the default version is the canonical; a v1-only page keeps its own.
    assert pages["/docs/v1/quickstart"]["seo"]["canonical"] == "/docs/quickstart"
    assert pages["/docs/v1/guide/setup"]["seo"]["canonical"] == "/docs/guide/setup"
    assert "canonical" not in pages["/docs/v1/legacy"]["seo"]
    assert pages["/docs/v1/legacy"]["seo"]["robots"] == "noindex"
    assert "seo" not in pages["/docs/quickstart"] or "robots" not in pages["/docs/quickstart"]["seo"]
    html = (out / "docs" / "v1" / "quickstart" / "index.html").read_text()
    assert 'rel="canonical" href="https://docs.example.com/docs/quickstart"' in html
    assert 'name="robots" content="noindex' in html
    sitemap = (out / "sitemap.xml").read_text()
    assert "/docs/quickstart" in sitemap and "/docs/v1/" not in sitemap
    assert "/v1/" not in (out / "llms.txt").read_text()
    # Search keeps every version (the browser filters by the open one).
    searched = {p["p"] for p in json.loads((out / "search-index.json").read_text())["pages"]}
    assert {"/docs/quickstart", "/docs/v1/quickstart", "/docs/v1/legacy"} <= searched


def test_index_true_publishes_an_older_version(tmp_path: Path) -> None:
    _, nav, out = _build(tmp_path, YAML.replace("tag: Deprecated}", "tag: Deprecated, index: true}"))
    assert "robots" not in _pages(nav["items"])["/docs/v1/legacy"].get("seo", {})
    assert "/docs/v1/legacy" in (out / "sitemap.xml").read_text()


def test_manual_versions_list_their_own_groups_and_tabs(tmp_path: Path) -> None:
    text = YAML.replace("docs: {dir: docs}", "docs: {dir: docs, nav: {mode: manual}}").replace(
        "- {version: v2, default: true, tag: Latest}",
        "- {version: v2, default: true, tag: Latest, groups: [{group: Start, pages: [index, quickstart]}]}",
    ).replace(
        "- {version: v1, tag: Deprecated}",
        "- {version: v1, tabs: [{tab: Guides, groups: [{group: Old, pages: [v1/index, v1/quickstart]}]}]}",
    )
    ui, nav, _ = _build(tmp_path, text)
    v2, v1 = ui["navigation"]["versions"]
    assert v2["groups"][0]["pages"] == ["index", "quickstart"]
    assert v1["tabs"][0]["tab"] == "Guides" and v1["tabs"][0]["groups"][0]["pages"] == ["v1/index", "v1/quickstart"]
    titles = [i["title"] for i in nav["items"] if not i.get("hidden")]
    assert titles[:2] == ["Start", "Old"]


def test_checks_duplicate_default_and_misplaced_pages(tmp_path: Path) -> None:
    _write(tmp_path)
    data = yaml.safe_load(YAML)
    assert find_unknown_keys(Config, data) == []
    # A folder-backed version needs no pages or groups (no 2102).
    assert not [w for w in nav_warnings(Config.model_validate(data), tmp_path) if w.code == 2102]
    data["navigation"]["versions"] += [
        {"version": "V1", "default": True},
        {"version": "v0", "pages": ["quickstart"]},
    ]
    issues = Compiler(Config.model_validate(data), base_path=tmp_path).lint_content()
    found = [i.message for i in issues if i.code == 7018]
    assert "2 versions use the folder 'v1'" in found
    assert "more than one version is marked default: true" in found
    assert "version 'v0' lists 'quickstart', a page of version 'v2'" in found
