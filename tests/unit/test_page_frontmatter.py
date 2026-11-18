"""Docs page frontmatter (docs/features/writing-docs.md "Front matter"):
sidebarTitle, icon (name, emoji, image URL), tag, deprecated, mode,
hideFooterPagination, noAnchor, description as the lede, custom keys as `meta`,
external `url:` pages and `{label, href}` nav links, per-page dates."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from praisonaiui.compiler import page_meta
from praisonaiui.compiler.compiler import Compiler
from praisonaiui.compiler.nav_builder import icon_value
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    NavConfig,
    NavGroupConfig,
    NavigationConfig,
    NavLinkConfig,
    NavTabConfig,
    RouteConfig,
    SEOConfig,
    SiteConfig,
    TemplateConfig,
)

PAGES = {
    "index.md": "# Home\n",
    "guide/start.md": (
        "---\ntitle: Getting started with the CLI\nsidebarTitle: Start\ndescription: Install it and run it.\n"
        "icon: 🚀\ntag: NEW\nmode: wide\nhideFooterPagination: true\nnoAnchor: true\n"
        "product: cloud\nversion: 2\nbeta: true\nlong: [1, 2]\n'og:image': x.png\n---\nBody text here.\n"
    ),
    "guide/old.md": "---\ntitle: Old API\ndeprecated: true\nicon: /img/old.svg\nmode: bogus\n---\n# Old API\n",
    "guide/npm.md": "---\ntitle: npm package\nurl: https://www.npmjs.com/package/aiui\nicon: package\n---\n",
}


def _build(tmp_path: Path, navigation: NavigationConfig | None = None, **docs) -> Path:
    for name, text in PAGES.items():
        (tmp_path / "docs" / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "docs" / name).write_text(text, encoding="utf-8")
    config = Config(
        site=SiteConfig(title="T"),
        seo=SEOConfig(siteUrl="https://docs.example.com"),
        content=ContentConfig(docs=ContentSourceConfig(
            dir="docs", nav=NavConfig(mode="manual" if navigation else "auto"), **docs)),
        navigation=navigation,
        templates={"docs": TemplateConfig(layout="ThreeColumnLayout", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def _items(out: Path) -> dict[str, dict]:
    found: dict[str, dict] = {}

    def walk(items: list[dict]) -> None:
        for item in items:
            found[item.get("pageTitle") or item["title"]] = item
            walk(item.get("children") or [])

    walk(json.loads((out / "docs-nav.json").read_text())["items"])
    return found


def test_frontmatter_switches_reach_docs_nav(tmp_path: Path) -> None:
    items = _items(_build(tmp_path))
    start = items["Getting started with the CLI"]
    assert start["title"] == "Start"  # sidebarTitle, in the generated (auto) sidebar too
    assert start["path"] == "/docs/guide/start"
    assert start["description"] == "Install it and run it." and start["lede"] is True
    assert start["icon"] == "🚀" and start["tag"] == "NEW" and start["mode"] == "wide"
    assert start["hidePager"] is True and start["noAnchor"] is True
    # Custom scalar keys only; known keys, lists and keys that are not plain names stay out.
    assert start["meta"] == {"product": "cloud", "version": 2, "beta": True}

    old = items["Old API"]
    assert old["deprecated"] is True and old["icon"] == "/img/old.svg"
    assert "mode" not in old and "lede" not in old and "meta" not in old  # an unknown mode is the default


def test_icon_values() -> None:
    assert icon_value("rocket") == "rocket"
    assert icon_value("⚡") == "⚡"
    assert icon_value("https://cdn.example.com/a.svg") == "https://cdn.example.com/a.svg"
    for bad in ("<svg>", "javascript:alert(1)", "/a b.svg", "x" * 41, None, 3):
        assert icon_value(bad) == "", bad


def test_an_external_url_page_is_only_a_sidebar_link(tmp_path: Path) -> None:
    out = _build(tmp_path)
    npm = _items(out)["npm package"]
    assert npm["href"] == "https://www.npmjs.com/package/aiui" and "path" not in npm
    assert npm["icon"] == "package"
    for name in ("sitemap.xml", "llms.txt", "llms-full.txt", "search-index.json"):
        text = (out / name).read_text()
        assert "npm" not in text, name
        assert "guide/start" in text, name  # the other pages are there
    assert not (out / "docs/guide/npm.html").exists()
    assert not (out / "docs/guide/npm.md").exists() and not (out / "docs/guide/npm.source.md").exists()


def test_nav_groups_take_label_href_links(tmp_path: Path) -> None:
    group = NavGroupConfig(group="Guide", pages=[
        "guide/start",
        {"label": "GitHub", "href": "https://github.com/acme/site", "icon": "code", "tag": "OSS"},
        "guide/npm",
    ])
    assert group.page_slugs() == ["guide/start", "guide/npm"]
    out = _build(tmp_path, NavigationConfig(tabs=[NavTabConfig(tab="Docs", groups=[group])]))
    guide = next(i for i in json.loads((out / "docs-nav.json").read_text())["items"] if i["title"] == "Guide")
    assert [c["title"] for c in guide["children"]] == ["Start", "GitHub", "npm package"]
    assert guide["children"][1] == {"title": "GitHub", "href": "https://github.com/acme/site", "icon": "code", "tag": "OSS"}
    assert "GitHub" not in (out / "llms.txt").read_text()


def test_nav_links_refuse_script_urls() -> None:
    with pytest.raises(ValidationError):
        NavLinkConfig(label="x", href="javascript:alert(1)")


def test_page_dates_from_frontmatter(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(page_meta, "git_last_updated", lambda path: "2026-01-01")
    PAGES_WITH_DATES = {
        "guide/start.md": "---\ntitle: S\nlastUpdatedDate: 2025-12-24\n---\n# S\n",
        "guide/old.md": "---\ntitle: O\ntimestamp: false\n---\n# O\n",
    }
    monkeypatch.setitem(globals(), "PAGES", {**PAGES, **PAGES_WITH_DATES})
    items = _items(_build(tmp_path, lastUpdated=True))
    assert items["S"]["lastUpdated"] == "2025-12-24"  # the frontmatter date wins over git
    assert "lastUpdated" not in items["O"]  # timestamp: false
    assert items["Home"]["lastUpdated"] == "2026-01-01"

    # timestamp: true shows a date with content.docs.lastUpdated off.
    monkeypatch.setitem(globals(), "PAGES", {**PAGES, "guide/old.md": "---\ntitle: O\ntimestamp: true\n---\n# O\n"})
    items = _items(_build(tmp_path / "b"))
    assert items["O"]["lastUpdated"] == "2026-01-01" and "lastUpdated" not in items["Home"]


def test_validate_knows_the_new_keys() -> None:
    from praisonaiui.compiler.content_lint import check_body, check_frontmatter

    good = "---\nsidebarTitle: S\ndeprecated: true\nlastUpdatedDate: 2026-05-01\ntimestamp: false\n---\n# X\n\nBody.\n"
    assert check_frontmatter(good, "a.md") == []
    bad = check_frontmatter("---\ndeprecated: \"yes\"\nlastUpdatedDate: May 1\n---\n# X\n", "a.md")
    assert [(i.code, i.line) for i in bad] == [(7001, 2), (7001, 3)]
    assert bad[1].hint == "Write lastUpdatedDate: 2026-05-01"
    assert check_body("---\nurl: https://x.dev\n---\n", "a.md", {"url": "https://x.dev"}) == []  # a link, not empty
