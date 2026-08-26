"""SEO build and frontend guardrails."""

from pathlib import Path

import yaml

from praisonaiui.compiler import Compiler
from praisonaiui.schema.models import Config, ContentConfig, ContentSourceConfig, RouteConfig, SEOConfig, SiteConfig, TemplateConfig


class TestSeoBuild:
    def test_build_generates_absolute_canonical_and_sitemap(self, tmp_path: Path):
        docs_dir = tmp_path / "docs"
        docs_dir.mkdir()
        (docs_dir / "guide.md").write_text(
            "---\ntitle: Guide\ndescription: Guide description\n---\n\n# Guide\n",
            encoding="utf-8",
        )
        (tmp_path / "CNAME").write_text("ui.praison.ai\n", encoding="utf-8")

        config = Config(
            site=SiteConfig(title="Test Docs", description="Site description"),
            seo=SEOConfig(title_template="%s | %s", site_url="https://ui.praison.ai"),
            content=ContentConfig(docs=ContentSourceConfig(dir=str(docs_dir))),
            templates={"docs": TemplateConfig(layout="Default", slots={})},
            routes=[RouteConfig(match="/docs/**", template="docs")],
        )

        compiler = Compiler(config, base_path=tmp_path)
        result = compiler.compile(tmp_path / "output")
        assert result.success is True
        assert "sitemap.xml" in result.files
        assert "robots.txt" in result.files
        assert ".nojekyll" in result.files

        page = (tmp_path / "output" / "docs" / "guide.html").read_text(encoding="utf-8")
        assert '<link rel="canonical" href="https://ui.praison.ai/docs/guide" />' in page
        assert '<meta property="og:url" content="https://ui.praison.ai/docs/guide" />' in page
        assert "application/ld+json" in page
        assert "Guide description" in page

        sitemap = (tmp_path / "output" / "sitemap.xml").read_text(encoding="utf-8")
        assert "https://ui.praison.ai/docs/guide" in sitemap

        robots = (tmp_path / "output" / "robots.txt").read_text(encoding="utf-8")
        assert "Sitemap: https://ui.praison.ai/sitemap.xml" in robots

        nav = yaml.safe_load((tmp_path / "output" / "docs-nav.json").read_text(encoding="utf-8"))
        assert nav["items"][0]["description"] == "Guide description"

    def test_sidebar_uses_crawlable_anchor_links(self):
        source = Path("src/frontend/src/Sidebar.tsx").read_text(encoding="utf-8")
        assert "href={href}" in source
        assert "data-nav-path" in source
        assert "event.preventDefault()" in source

    def test_content_normalises_internal_doc_links(self):
        source = Path("src/frontend/src/Content.tsx").read_text(encoding="utf-8")
        assert "normalizeDocHref" in source
        assert "isInternalDocHref" in source
        assert 'key={currentPath}' in source

    def test_nav_intercept_handles_main_doc_links(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/nav-intercept.js").read_text(encoding="utf-8")
        assert 'main a[href^="/docs"]' in source

    def test_app_uses_absolute_site_url_for_canonical(self):
        source = Path("src/frontend/src/App.tsx").read_text(encoding="utf-8")
        assert "siteUrl" in source
        assert "og:description" in source
        assert "twitter:description" in source
