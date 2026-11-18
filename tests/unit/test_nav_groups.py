"""Sidebar groups, folding flags, listings, breadcrumbs and nav checks (docs/features/navigation.md)."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config
from praisonaiui.schema.validators import validate_config

DOCS = {
    "index.md": "# Home\n",
    "api/overview.md": "---\ntitle: API overview\n---\n# API overview\n",
    "api/auth.md": "---\ndescription: Tokens and keys for every call.\n---\n# Auth\n",
    "api/errors.md": "# Errors\n",
    "guide/zeta.md": "---\ndate: 2026-01-01\n---\n# Alpha guide\n",
    "guide/alpha.md": "---\ndate: 2026-03-01\n---\n# Zeta guide\n",
    "notes/_index.md": "# Notes home\n",
    "notes/one.md": "# One\n",
}


def _build(tmp_path: Path, extra: str) -> tuple[Path, Compiler]:
    for rel, text in DOCS.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
    cfg = Config.model_validate(yaml.safe_load("site: {title: T}\n" + extra))
    out = tmp_path / "site"
    compiler = Compiler(cfg, base_path=tmp_path)
    result = compiler.compile(output_dir=out)
    assert result.success, result.error
    compiler.result = result
    return out, compiler


def _json(out: Path, name: str) -> dict:
    return json.loads((out / name).read_text())


ROOT_NAV = """
content: {docs: {dir: docs}}
navigation:
  pages:
    - index
    - group: API
      root: api/overview
      tag: New
      directory: card
      pages:
        - api/auth
        - group: More
          expanded: false
          pages: [api/errors]
  groups:
    - group: Guides
      directory: accordion
      pages: [guide/zeta, guide/alpah]
"""


def test_root_level_groups_root_pages_listings_and_breadcrumb_json_ld(tmp_path: Path) -> None:
    out, _ = _build(tmp_path, ROOT_NAV)
    items = _json(out, "docs-nav.json")["items"]
    assert items[0] == {"title": "Home", "path": "/docs/index"}  # no tabs or nav.mode needed
    api, guides = items[1], items[2]
    # The root page is the group's own path (listed once); its page title stays for <title>.
    assert api["path"] == "/docs/api/overview" and api["pageTitle"] == "API overview"
    assert (api["tag"], api["directory"]) == ("New", "card")
    assert [c["title"] for c in api["children"]] == ["Auth", "More"] and api["children"][1]["expanded"] is False
    assert not any(i.get("path") == "/docs/api/overview" for i in items[3:])
    # `directory` lists the pages on the root page (humans: cards; agents: links) ...
    source = (out / "docs/api/overview.source.md").read_text()
    assert '<Card title="Auth" href="/docs/api/auth">Tokens and keys for every call.</Card>' in source
    assert "- [Auth](/docs/api/auth.md): Tokens and keys for every call." in (out / "docs/api/overview.md").read_text()
    # ... or on a generated page at the group's slug when it has no root.
    assert guides["path"] == "/docs/guides" and [c["title"] for c in guides["children"]] == ["Alpha guide"]
    assert '<Accordion title="Alpha guide">' in (out / "docs/guides.source.md").read_text()
    assert (out / "docs/guides.html").exists()
    # BreadcrumbList: groups with a page of their own, then the page.
    html = (out / "docs/api/errors.html").read_text()
    assert '"@type": "BreadcrumbList"' in html and '"name": "API"' in html and '"name": "More"' not in html


def test_missing_page_warns_with_a_suggestion_and_fails_strict(tmp_path: Path) -> None:
    _, compiler = _build(tmp_path, ROOT_NAV)
    result = validate_config(compiler.config, tmp_path)
    [issue] = [w for w in result.warnings if w.code == 2101]
    assert "guide/alpah" in issue.message and issue.suggestion == "Did you mean 'guide/alpha'?"
    assert any("guide/alpah" in w for w in compiler.result.warnings)  # aiui build says so too
    strict = validate_config(compiler.config, tmp_path, strict=True)
    assert not strict.valid and strict.errors[0].code == 2101


def test_ignored_keys_warn_and_unset_keys_do_not(tmp_path: Path) -> None:
    _, compiler = _build(tmp_path, "content: {docs: {dir: docs, nav: {maxDepth: 2}}}\ni18n: {fallbackLocale: en}\n")
    codes = [(w.code, w.message.split(" is ")[0]) for w in validate_config(compiler.config, tmp_path).warnings]
    assert (1004, "content.docs.nav.maxDepth") in codes and (1004, "i18n.fallbackLocale") in codes
    _, plain = _build(tmp_path, "content: {docs: {dir: docs}}\n")
    assert not [w for w in validate_config(plain.config, tmp_path).warnings if w.code in (1004, 2101)]


def test_auto_nav_sort_index_files_directory_and_flags(tmp_path: Path) -> None:
    docs = "{dir: docs, indexFiles: [index.md, _index.md], nav: {sort: date, collapsible: false, directory: card}}"
    extra = "interaction: {drilldown: true}\nstyling: {eyebrows: breadcrumbs}\n"
    out, _ = _build(tmp_path, f"content: {{docs: {docs}}}\n{extra}")
    nav = _json(out, "docs-nav.json")
    assert nav["collapsible"] is False and nav["drilldown"] is True
    assert _json(out, "ui-config.json")["styling"] == {"eyebrows": "breadcrumbs"}
    by_title = {i["title"]: i for i in nav["items"]}
    # sort: date puts the newest page first (file names say the opposite).
    guide = by_title["Guide"]
    assert [c["title"] for c in guide["children"]] == ["Zeta guide", "Alpha guide"]
    # nav.directory: a folder without an index page gets a generated listing page.
    assert guide["path"] == "/docs/guide" and (out / "docs/guide.source.md").exists()
    # indexFiles: _index.md names its folder.
    assert by_title["Notes home"]["path"] == "/docs/notes"


def test_sort_alpha_orders_by_title(tmp_path: Path) -> None:
    out, _ = _build(tmp_path, "content: {docs: {dir: docs, nav: {sort: alpha}}}\n")
    guide = next(i for i in _json(out, "docs-nav.json")["items"] if i["title"] == "Guide")
    assert [c["title"] for c in guide["children"]] == ["Alpha guide", "Zeta guide"]
    assert "collapsible" not in _json(out, "docs-nav.json")


def test_review_fixes_index_merge_escaping_nested_listing_and_tab_membership(tmp_path: Path) -> None:
    (tmp_path / "docs/guide").mkdir(parents=True)
    (tmp_path / "docs/guide/index.md").write_text("# Guide home\n")  # sorts after its pages by title
    extra = """
content: {docs: {dir: docs, nav: {sort: alpha, directory: card}}}
i18n: {translationsDir: ./t}
navigation:
  groups:
    - {group: "Auth & keys", directory: card, pages: [api/auth]}
    - {group: Deep, directory: card, pages: [{group: Inner, pages: [api/errors]}]}
"""
    out, compiler = _build(tmp_path, extra)
    items = _json(out, "docs-nav.json")["items"]
    # A group with only pathless nested groups gets no generated page.
    assert "path" not in next(i for i in items if i["title"] == "Deep")
    # Titles reach the card once-escaped; quotes cannot end the attribute.
    assert '<Card title="Auth' in (out / "docs/auth-keys.source.md").read_text()
    assert "&amp;" not in (out / "docs/auth-keys.source.md").read_text()
    # i18n keys that do nothing are reported by the build too.
    assert any("i18n.translationsDir" in w for w in compiler.result.warnings)
    # The generated listing page belongs to its tab.
    cfg = Config.model_validate(yaml.safe_load("site: {title: T}\nnavigation:\n  tabs:\n    - {tab: B, groups: [{group: Guides, directory: card, pages: [x]}]}\n"))
    assert cfg.navigation.tabs[0].groups[0].page_slugs() == ["guides", "x"]
    # Auto nav: a folder index scanned after its pages still becomes the section's own page.
    auto, _ = _build(tmp_path, "content: {docs: {dir: docs, nav: {sort: alpha}}}\n")
    guide = [i for i in _json(auto, "docs-nav.json")["items"] if i.get("path") == "/docs/guide"]
    assert len(guide) == 1 and guide[0]["title"] == "Guide home" and len(guide[0]["children"]) == 2
