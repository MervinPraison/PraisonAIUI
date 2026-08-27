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

    def test_content_fetch_clears_loading_on_cancel(self):
        source = Path("src/frontend/src/Content.tsx").read_text(encoding="utf-8")
        assert "setLoadingContent(false)" in source
        assert "cancelled = true" in source
        # Cleanup must reset loading — not only the finally block
        assert source.index("cancelled = true") < source.rindex("setLoadingContent(false)")

    def test_app_syncs_react_state_on_plugin_navigate(self):
        source = Path("src/frontend/src/App.tsx").read_text(encoding="utf-8")
        assert "aiui:navigate" in source
        assert "normalizeDocPath" in source

    def test_content_loader_teardowns_plugin_hide_mode(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/content-loader.js").read_text(encoding="utf-8")
        assert "teardownPluginContent" in source
        assert "mainHasVisibleContent" in source
        assert "repairIfEmpty" not in source
        assert "setContentMode" not in source

    def test_mkdocs_enhance_clones_tabs_instead_of_moving_nodes(self):
        source = Path("src/frontend/src/markdown/mkdocsEnhance.ts").read_text(encoding="utf-8")
        assert "insertBefore" not in source
        assert "cloneNode" not in source
        assert "appendChild" not in source

    def test_plugin_loader_uses_content_events_not_mutation_observer(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/plugin-loader.js").read_text(encoding="utf-8")
        assert "new MutationObserver" not in source
        assert "aiui:content-loaded" in source
        assert "aiui:navigate" in source

    def test_code_copy_skips_react_article_blocks(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/code-copy.js").read_text(encoding="utf-8")
        assert "isReactArticleBlock" in source
        assert "insertBefore(wrapper, pre)" not in source

    def test_syntax_highlight_skips_react_article_blocks(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/syntax-highlight.js").read_text(encoding="utf-8")
        assert "isReactArticleBlock" in source

    def test_plugin_loader_skips_react_docs_dom(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/plugin-loader.js").read_text(encoding="utf-8")
        assert "isReactDocsActive" in source
        assert "isReactDocsRoot" in source

    def test_docs_plugins_exclude_dom_mutators(self):
        source = Path("src/praisonaiui/server.py").read_text(encoding="utf-8")
        docs_block = source.split('elif style == "docs":')[1].split("else:")[0]
        assert '"mkdocs-compat"' not in docs_block
        assert '"toc"' not in docs_block

    def test_mkdocs_compat_skips_react_managed_articles(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/mkdocs-compat.js").read_text(encoding="utf-8")
        assert "isReactManagedArticle" in source

    def test_path_utils_normalizes_trailing_slash(self):
        source = Path("src/frontend/src/pathUtils.ts").read_text(encoding="utf-8")
        assert "normalizeDocPath" in source
        assert "docPathToMarkdown" in source

    def test_doc_index_maps_to_docs_index_md_not_docs_md(self):
        source = Path("src/frontend/src/pathUtils.ts").read_text(encoding="utf-8")
        assert "replace(/\\/index$/, '')" not in source
        loader = Path("src/praisonaiui/templates/frontend/plugins/content-loader.js").read_text(encoding="utf-8")
        assert "replace(/\\/index$/, '')" not in loader

    def test_route_pages_use_flat_html_not_directories(self):
        source = Path("src/praisonaiui/compiler/compiler.py").read_text(encoding="utf-8")
        assert 'f"{relative}.html"' in source
        assert "page_dir / \"index.html\"" not in source

    def test_build_emits_nojekyll(self):
        source = Path("src/praisonaiui/compiler/compiler.py").read_text(encoding="utf-8")
        assert ".nojekyll" in source

    def test_static_shell_strips_trailing_slash_before_react(self):
        source = Path("src/praisonaiui/compiler/compiler.py").read_text(encoding="utf-8")
        assert "aiui-canonical-url" in source
        assert "plugin-loader.js" in source
        assert "_patch_static_shell" in source

    def test_nav_intercept_canonicalizes_trailing_slash_on_load(self):
        source = Path("src/praisonaiui/templates/frontend/plugins/nav-intercept.js").read_text(encoding="utf-8")
        assert "canonicalizeUrlBar" in source
        assert "canonicalizeUrlBar();" in source

    def test_app_normalizes_initial_url_without_trailing_slash(self):
        source = Path("src/frontend/src/App.tsx").read_text(encoding="utf-8")
        assert "replaceState(null, '', initialPath" in source
        assert "normalizeDocPath(path)" in source or "canonicalPath = normalizeDocPath" in source

    def test_content_renders_mermaid_in_react_not_plugin(self):
        content = Path("src/frontend/src/Content.tsx").read_text(encoding="utf-8")
        assert "MermaidDiagram" in content
        assert "language-mermaid" in content
        assert "children.type === MermaidDiagram" in content
        plugin = Path("src/praisonaiui/templates/frontend/plugins/mermaid.js").read_text(encoding="utf-8")
        assert "article.prose" in plugin
