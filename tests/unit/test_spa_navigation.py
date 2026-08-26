"""Guardrails for SPA navigation path consistency and stale content fixes."""

from pathlib import Path


class TestSpaNavigation:
    def test_nav_intercept_uses_canonical_urls_without_trailing_slash(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/nav-intercept.js").read_text(encoding="utf-8")
        assert "target + '/'" not in source
        assert "data-nav-path" in source or "dataset.navPath" in source
        assert "mainHasVisibleContent" in source

    def test_sidebar_buttons_expose_nav_path(self):
        source = Path("src/frontend/src/Sidebar.tsx").read_text(encoding="utf-8")
        assert "data-nav-path" in source

    def test_content_fetches_from_current_path(self):
        source = Path("src/frontend/src/Content.tsx").read_text(encoding="utf-8")
        assert "currentPath" in source
        assert "docPathToMarkdown" in source
        assert "cancelled = true" in source

    def test_app_syncs_react_state_on_plugin_navigate(self):
        source = Path("src/frontend/src/App.tsx").read_text(encoding="utf-8")
        assert "aiui:navigate" in source
        assert "normalizeDocPath" in source

    def test_content_loader_teardowns_plugin_hide_mode(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/content-loader.js").read_text(encoding="utf-8")
        assert "teardownPluginContent" in source
        assert "setContentMode(false)" in source
        assert "mainHasVisibleContent" in source

    def test_mkdocs_compat_does_not_target_main_container(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/mkdocs-compat.js").read_text(encoding="utf-8")
        assert "main.flex-1" not in source

    def test_path_utils_normalizes_trailing_slash(self):
        source = Path("src/frontend/src/pathUtils.ts").read_text(encoding="utf-8")
        assert "normalizeDocPath" in source
        assert "docPathToMarkdown" in source

    def test_doc_index_maps_to_docs_index_md_not_docs_md(self):
        source = Path("src/frontend/src/pathUtils.ts").read_text(encoding="utf-8")
        assert "replace(/\\/index$/, '')" not in source
        loader = Path("src/praisonaiui/templates/frontend/plugins/content-loader.js").read_text(encoding="utf-8")
        assert "replace(/\\/index$/, '')" not in loader
