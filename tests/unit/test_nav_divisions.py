"""Tabs with links, icons, loose pages and menus; sidebar anchors (and global ones);
the dropdown (product) switcher: the config, ui-config.json, the manual sidebar and checks."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.compiler.links import check_site_links
from praisonaiui.schema.models import Config
from praisonaiui.schema.validators import find_unknown_keys, nav_warnings

DOCS = {
    "index.md": "# Home\n",
    "guide/start.md": "# Start\n",
    "rest/users.md": "# Users\n",
    "sdk/python.md": "# Python\n",
    "blog/launch.md": "# Launch\n",
    "cloud/deploy.md": "# Deploy\n",
    "secret/x.md": "# Secret\n",
}

YAML = """
site: {title: T}
content:
  docs: {dir: docs, nav: {mode: manual}}
navigation:
  global:
    anchors:
      - {anchor: Community, icon: users, href: "https://example.com/chat"}
  anchors:
    - {anchor: Blog, icon: newspaper, pages: [blog/launch]}
  tabs:
    - {tab: Guides, icon: book-open, pages: [index, guide/start]}
    - {tab: GitHub, url: "https://github.com/example"}
    - tab: API
      menu:
        - {item: REST, description: HTTP endpoints, groups: [{group: REST, pages: [rest/users]}]}
        - {item: SDK, groups: [{group: SDK, pages: [sdk/python]}]}
        - {item: Status, href: "https://status.example.com"}
        - {item: Secret, hidden: true, pages: [secret/x]}
  products:
    - product: Cloud
      description: Hosted
      tabs: [{tab: Deploy, groups: [{group: Cloud, pages: [cloud/deploy]}]}]
templates: {docs: {layout: Default, slots: {}}}
routes: [{match: "/docs/**", template: docs}]
"""


def _build(tmp_path: Path, text: str = YAML) -> tuple[dict, dict]:
    for rel, body in DOCS.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)
    out = tmp_path / "site"
    assert Compiler(Config.model_validate(yaml.safe_load(text)), base_path=tmp_path).compile(output_dir=out).success
    return json.loads((out / "ui-config.json").read_text()), json.loads((out / "docs-nav.json").read_text())


def test_ui_config_carries_tabs_menus_anchors_and_dropdowns(tmp_path: Path) -> None:
    ui, _ = _build(tmp_path)
    nav = ui["navigation"]
    guides, github, api = nav["tabs"]
    assert guides["icon"] == "book-open"
    assert guides["groups"] == [{"group": "", "icon": None, "prefix": None, "pages": ["index", "guide/start"]}]
    assert github["url"] == "https://github.com/example" and github["groups"] == []
    # The hidden menu item is left out; the others keep their description and href.
    assert [m["item"] for m in api["menu"]] == ["REST", "SDK", "Status"]
    assert api["menu"][0]["description"] == "HTTP endpoints"
    assert api["menu"][2]["href"] == "https://status.example.com"
    # Global anchors come first, then the sidebar anchors.
    assert [(a["anchor"], a.get("href")) for a in nav["anchors"]] == [
        ("Community", "https://example.com/chat"), ("Blog", None)]
    (cloud,) = nav["dropdowns"]  # `products` / `product` spell the same thing
    assert cloud["dropdown"] == "Cloud" and cloud["description"] == "Hosted"
    assert cloud["tabs"][0]["groups"][0]["pages"] == ["cloud/deploy"]


def test_manual_sidebar_holds_every_division(tmp_path: Path) -> None:
    _, docs_nav = _build(tmp_path)
    shown = {i.get("path") or i["title"]: i for i in docs_nav["items"]}
    for key in ("/docs/index", "/docs/guide/start", "REST", "SDK", "/docs/blog/launch", "Cloud"):
        assert key in shown, key
    # A hidden menu item's pages stay routable but leave the sidebar.
    assert all(c.get("hidden") for c in shown["Secret"]["children"])


def test_config_keys_and_checks(tmp_path: Path) -> None:
    data = yaml.safe_load(YAML)
    assert find_unknown_keys(Config, data) == []
    data["navigation"]["tabs"].append({"tab": "Empty"})
    data["navigation"]["anchors"].append({"anchor": "Lost", "pages": ["no/such-page"]})
    _build(tmp_path)
    cfg = Config.model_validate(data)
    found = {(w.code, w.message) for w in nav_warnings(cfg, tmp_path)}
    assert (2102, "navigation tab 'Empty' has no pages, groups or href") in found
    assert any(code == 2101 and "no/such-page" in msg for code, msg in found)


def test_check_links_reads_division_pages(tmp_path: Path) -> None:
    text = YAML.replace("pages: [sdk/python]", "pages: [sdk/pyton]")
    _build(tmp_path)
    report = check_site_links(Config.model_validate(yaml.safe_load(text)), tmp_path / "aiui.yaml")
    assert any("sdk/pyton" in str(b) for b in report.broken)
