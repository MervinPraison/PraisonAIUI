"""Guardrails for light-mode docs contrast regressions."""

from pathlib import Path


class TestLightModeContrast:
    def test_mermaid_heading_fix_scoped_to_dark(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/mermaid.js").read_text(encoding="utf-8")
        assert ".dark article.prose h1" in source
        assert ":root:not(.dark) article.prose h1" in source
        # Must not force near-white headings globally
        assert "article.prose h1, article.prose h2" not in source.replace(".dark article.prose h1", "")

    def test_prose_pre_code_uses_foreground_token(self):
        css = Path("src/frontend/src/index.css").read_text(encoding="utf-8")
        assert "--tw-prose-pre-code" in css
        assert "hsl(var(--foreground))" in css

    def test_syntax_highlight_uses_hsl_wrappers(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/syntax-highlight.js").read_text(encoding="utf-8")
        assert "hsl(var(--foreground))" in source
        assert "hsl(var(--muted))" in source
        assert "color: inherit !important" not in source
        assert "aiui:content-loaded" in source

    def test_content_uses_foreground_for_body_and_tables(self):
        source = Path("src/frontend/src/Content.tsx").read_text(encoding="utf-8")
        assert 'p className="my-3 text-foreground' in source
        assert 'td className="px-4 py-2 text-foreground' in source

    def test_content_loader_plugin_matches_react_prose_classes(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/content-loader.js").read_text(encoding="utf-8")
        assert "prose-neutral" in source
        assert "PROSE_ARTICLE_CLASS" in source
        assert 'class="my-2 text-foreground"' in source
        assert 'class="px-4 py-2 text-foreground"' in source

    def test_homepage_plugin_matches_react_prose_classes(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/homepage.js").read_text(encoding="utf-8")
        assert "prose-neutral" in source
        assert 'class="my-2 text-foreground"' in source

    def test_server_anti_flicker_uses_theme_tokens(self):
        source = Path("src/praisonaiui/server.py").read_text(encoding="utf-8")
        assert "hsl(var(--background))" in source
        assert "#0f172a" not in source.split("anti_flicker")[1].split("react_script")[0]

    def test_prose_contrast_rules_apply_without_prose_neutral(self):
        css = Path("src/frontend/src/index.css").read_text(encoding="utf-8")
        assert "article.prose :where(p, li, td, th" in css
