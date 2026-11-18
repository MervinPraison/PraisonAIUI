"""The docs home page (docs/index.md) is published at the site root: the
sitemap, llms.txt, llms-full.txt, canonical links and crawl links name `/`,
never `/docs/index`."""

from __future__ import annotations

from pathlib import Path

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SEOConfig,
    SiteConfig,
    TemplateConfig,
)

SITE = "https://docs.example.com"


def _build(tmp_path: Path) -> Path:
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
    (docs / "index.md").write_text("# Home\n\nWelcome to the example docs site.\n")
    (docs / "guide" / "setup.md").write_text("# Setup\n\nHow to set it up, step by step.\n")
    config = Config(
        site=SiteConfig(title="Example"),
        seo=SEOConfig.model_validate({"siteUrl": SITE}),
        content=ContentConfig(docs=ContentSourceConfig(dir="docs")),
        templates={"docs": TemplateConfig(layout="Default", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "site"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def test_sitemap_lists_the_home_once_at_the_root(tmp_path: Path) -> None:
    sitemap = (_build(tmp_path) / "sitemap.xml").read_text()
    assert sitemap.count(f"<loc>{SITE}/</loc>") == 1
    assert "/docs/index" not in sitemap
    assert f"<loc>{SITE}/docs/guide/setup</loc>" in sitemap


def test_llms_files_name_the_root(tmp_path: Path) -> None:
    out = _build(tmp_path)
    llms = (out / "llms.txt").read_text()
    assert f"[Home]({SITE}/docs/index.md)" in llms  # llms.txt links each page's Markdown
    assert f"Source: {SITE}/\n" in (out / "llms-full.txt").read_text()


def test_canonical_links_name_the_root(tmp_path: Path) -> None:
    out = _build(tmp_path)
    for page in (out / "index.html", out / "docs" / "index.html"):
        html = page.read_text()
        assert f'<link rel="canonical" href="{SITE}/"' in html, page
        assert f'href="{SITE}/docs/index"' not in html, page
    assert f'<link rel="canonical" href="{SITE}/docs/guide/setup"' in (out / "docs" / "guide" / "setup.html").read_text()
