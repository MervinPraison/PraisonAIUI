"""`content.docs.nav.mode: manual`: the docs sidebar comes from the YAML tab
groups (sections and nested sections, in the listed order); unlisted pages
stay routable; the default (auto) nav is unchanged."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config

DOCS = {
    "index.md": "---\ntitle: Home\n---\n# Home\n",
    "guide/setup.md": "# Setup\n",
    "guide/layouts.md": "# Layouts\n",
    "guide/layouts/chat.md": "---\nnav_title: Chat layout\n---\n# Chat and Canvas\n",
    "adr/0001-decision.md": "# Decision\n",
    "notes.md": "# Internal notes\n",
}


def _config(mode: str) -> Config:
    return Config.model_validate(
        yaml.safe_load(
            f"""
site: {{title: T}}
content:
  docs: {{dir: docs, nav: {{mode: {mode}}}}}
navigation:
  tabs:
    - tab: Start
      groups:
        - group: Get started
          pages: [index, guide/setup.md]
    - tab: Guides
      groups:
        - group: Guides
          pages:
            - group: Layouts
              pages: [guide/layouts, guide/layouts/chat]
            - adr/0001-decision
            - guide/setup
            - missing/page
templates: {{docs: {{layout: Default, slots: {{}}}}}}
routes: [{{match: "/docs/**", template: docs}}]
"""
        )
    )


def _nav(tmp_path: Path, mode: str) -> dict:
    for rel, text in DOCS.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
    out = tmp_path / "site"
    assert Compiler(_config(mode), base_path=tmp_path).compile(output_dir=out).success
    return json.loads((out / "docs-nav.json").read_text())


def test_manual_nav_follows_the_yaml_groups(tmp_path: Path) -> None:
    items = _nav(tmp_path, "manual")["items"]
    assert items[0] == {
        "title": "Get started",
        "children": [
            {"title": "Home", "path": "/docs/index"},
            {"title": "Setup", "path": "/docs/guide/setup"},
        ],
    }
    guides = items[1]
    assert guides["title"] == "Guides" and "path" not in guides
    layouts, decision = guides["children"]  # setup listed twice: kept once; missing page dropped
    assert layouts["title"] == "Layouts"
    assert [c["title"] for c in layouts["children"]] == ["Layouts", "Chat layout"]
    assert decision == {"title": "Decision", "path": "/docs/adr/decision"}
    # Unlisted: still a page (routable, searchable), outside every section.
    assert items[2:] == [{"title": "Internal notes", "path": "/docs/notes"}]


def test_manual_nav_pages_get_routes_and_flat_tab_pages(tmp_path: Path) -> None:
    _nav(tmp_path, "manual")
    out = tmp_path / "site"
    for route in ("docs/index", "docs/guide/layouts", "docs/guide/layouts/chat", "docs/notes"):
        assert (out / f"{route}.html").exists(), route
    ui = json.loads((out / "ui-config.json").read_text())
    pages = ui["navigation"]["tabs"][1]["groups"][0]["pages"]
    assert pages == ["guide/layouts", "guide/layouts/chat", "adr/0001-decision", "guide/setup", "missing/page"]


def test_auto_nav_is_unchanged(tmp_path: Path) -> None:
    items = _nav(tmp_path, "auto")["items"]
    assert all("path" in item for item in items)
    assert {"title": "Home", "path": "/docs/index"} in items


def test_nav_title_is_for_the_sidebar_only(tmp_path: Path) -> None:
    items = _nav(tmp_path, "manual")["items"]
    chat = items[1]["children"][0]["children"][1]
    assert chat == {"title": "Chat layout", "path": "/docs/guide/layouts/chat", "pageTitle": "Chat and Canvas"}
    # The page's <title> and the crawl / llms files keep the page's own title.
    html = (tmp_path / "site" / "docs" / "guide" / "layouts" / "chat.html").read_text()
    assert "<title>Chat and Canvas | T</title>" in html
