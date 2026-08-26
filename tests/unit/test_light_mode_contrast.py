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

    def test_content_uses_foreground_for_body_and_tables(self):
        source = Path("src/frontend/src/Content.tsx").read_text(encoding="utf-8")
        assert 'p className="my-3 text-foreground' in source
        assert 'td className="px-4 py-2 text-foreground' in source
