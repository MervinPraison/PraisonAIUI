"""Docs home page layout: frontmatter `layout: home` on docs/index.md becomes
ui-config.json `docsHome` (hero + features, strings only, capped)."""

from __future__ import annotations

import json
from pathlib import Path

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.compiler.docs_home import MAX_FEATURES, docs_home_from_frontmatter
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
)

INDEX = """---
title: Acme
layout: home
hero:
  name: Acme
  text: Ship faster
  tagline: The tagline.
  image: images/shot.webp
  image_dark: images/shot-dark.webp
  actions:
    - {text: Start, link: guide/start.md}
    - {text: GitHub, link: "https://github.com/acme", theme: alt}
    - {text: No link}
features:
  - {title: Fast, details: Very., icon: zap, link: guide/fast.md, linkText: Read}
  - {details: no title}
---

## Body
"""


def test_only_layout_home_has_a_home() -> None:
    assert docs_home_from_frontmatter({"title": "x"}) is None
    assert docs_home_from_frontmatter({"layout": "doc", "hero": {"name": "x"}}) is None
    assert docs_home_from_frontmatter({"layout": "home"}) == {}


def test_fields_are_strings_and_lists_are_capped() -> None:
    home = docs_home_from_frontmatter(
        {
            "layout": "home",
            "hero": {"name": "N", "text": {"nested": 1}, "onclick": "x", "actions": "nope"},
            "features": [{"title": f"F{i}", "html": "<b>"} for i in range(20)],
        }
    )
    assert home["hero"] == {"name": "N"}
    assert len(home["features"]) == MAX_FEATURES
    assert home["features"][0] == {"title": "F0"}


def test_build_writes_docs_home(tmp_path: Path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.md").write_text(INDEX)
    config = Config(
        site=SiteConfig(title="T"),
        content=ContentConfig(docs=ContentSourceConfig(dir="docs")),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    home = json.loads((out / "ui-config.json").read_text())["docsHome"]
    assert home["hero"] == {
        "name": "Acme",
        "text": "Ship faster",
        "tagline": "The tagline.",
        "image": "images/shot.webp",
        "imageDark": "images/shot-dark.webp",
        "actions": [
            {"text": "Start", "link": "guide/start.md", "theme": "brand"},
            {"text": "GitHub", "link": "https://github.com/acme", "theme": "alt"},
        ],
    }
    assert home["features"] == [
        {"title": "Fast", "details": "Very.", "icon": "zap", "link": "guide/fast.md", "linkText": "Read"}
    ]


def test_no_home_without_the_layout(tmp_path: Path) -> None:
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.md").write_text("# Plain\n")
    config = Config(
        site=SiteConfig(title="T"),
        content=ContentConfig(docs=ContentSourceConfig(dir="docs")),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    assert "docsHome" not in json.loads((out / "ui-config.json").read_text())
