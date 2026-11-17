"""Docs home page layout: frontmatter `layout: home` on docs/index.md becomes
ui-config.json `docsHome` (hero + features, strings only, capped)."""

from __future__ import annotations

import json
from pathlib import Path

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.compiler.docs_home import (
    MAX_FEATURES,
    docs_home_from_frontmatter,
    hero_preload_tags,
)
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
    ThemeConfig,
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


# ── Hero preload: the home page's HTML starts the hero image download ─────────

HERO = {"hero": {"image": "images/shot.webp", "imageDark": "images/shot-dark.webp"}}
LIGHT_MEDIA = 'media="not all and (prefers-color-scheme: dark)"'
DARK_MEDIA = 'media="(prefers-color-scheme: dark)"'


def test_system_mode_preloads_each_image_for_its_colour_scheme() -> None:
    tags = hero_preload_tags(HERO, "/docs/index", "system").splitlines()
    assert len(tags) == 2
    assert 'href="/docs/images/shot.webp"' in tags[0] and LIGHT_MEDIA in tags[0]
    assert 'href="/docs/images/shot-dark.webp"' in tags[1] and DARK_MEDIA in tags[1]
    assert all('rel="preload" as="image"' in t and 'fetchpriority="high"' in t for t in tags)


def test_a_fixed_mode_or_one_image_preloads_one_without_a_media_query() -> None:
    assert hero_preload_tags(HERO, "/docs/index", "dark").count("<link") == 1
    assert "shot-dark.webp" in hero_preload_tags(HERO, "/docs/index", "dark")
    assert "shot-dark.webp" not in hero_preload_tags(HERO, "/docs/index", "light")
    one = hero_preload_tags({"hero": {"image": "images/shot.webp"}}, "/docs/index", "system")
    assert one.count("<link") == 1 and "media=" not in one
    assert hero_preload_tags({"hero": {"name": "No image"}}, "/docs/index", "system") == ""
    assert hero_preload_tags(None, "/docs/index", "system") == ""


def test_urls_resolve_like_the_app_and_unsafe_ones_are_dropped() -> None:
    def href(src: str, home: str = "/docs/index") -> str:
        return hero_preload_tags({"hero": {"image": src}}, home, "system")

    assert 'href="/docs/x.png"' in href("../x.png", "/docs/guide/index")
    assert 'href="/static/a.png"' in href("/static/a.png")
    assert 'href="https://cdn.example.com/a.png"' in href("https://cdn.example.com/a.png")
    assert href("javascript:alert(1)") == "" and href("data:image/png;base64,AAAA") == ""
    assert 'href="/docs/a&quot;&gt;&lt;b.png"' in href('a"><b.png')


def _build_home(tmp_path: Path, mode: str | None = None) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
    (docs / "index.md").write_text(INDEX)
    (docs / "guide" / "start.md").write_text("# Start\n")
    config = Config(
        site=SiteConfig(title="T", theme=ThemeConfig(mode=mode) if mode else None),
        content=ContentConfig(docs=ContentSourceConfig(dir="docs")),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def test_build_preloads_the_hero_on_the_home_pages_only(tmp_path: Path) -> None:
    out = _build_home(tmp_path, "system")
    for page in ("index.html", "docs/index.html"):
        html = (out / page).read_text()
        assert html.count('rel="preload" as="image"') == 2, page
        assert html.index('href="/docs/images/shot.webp"') < html.index("</head>")
    assert 'rel="preload" as="image"' not in (out / "docs/guide/start.html").read_text()


def test_build_preloads_one_image_for_a_fixed_mode(tmp_path: Path) -> None:
    html = (_build_home(tmp_path, "dark") / "index.html").read_text()
    assert html.count('rel="preload" as="image"') == 1
    assert 'href="/docs/images/shot-dark.webp"' in html
