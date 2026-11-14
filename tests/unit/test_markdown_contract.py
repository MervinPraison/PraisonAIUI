"""Contract of the single Streamdown markdown renderer (WP1, ADR-0001 §5).

Source-level guardrails for things a refactor can silently break: the lazy
boundary that keeps Streamdown out of the entry, the sanitize pipeline, the
chat link/image policy (owner decision 1), light-mode contrast of docs
body text and table cells (moved here from test_light_mode_contrast.py), and
the guards that keep the vanilla DOM plugins off rendered markdown.
Rendering behaviour is tested in src/frontend/src/markdown/markdown.test.tsx.
"""

from __future__ import annotations

import re
from pathlib import Path

SRC = Path("src/frontend/src")
MD = SRC / "markdown"
PLUGINS = Path("src/praisonaiui/templates/frontend/plugins")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _app_sources():
    """Every app .ts/.tsx outside the markdown package, spikes and tests."""
    for path in SRC.rglob("*.ts*"):
        rel = path.relative_to(SRC).as_posix()
        if rel.startswith(("markdown/", "spike/")) or ".test." in rel or rel.endswith(".d.ts"):
            continue
        yield rel, _read(path)


class TestLazyBoundary:
    def test_app_imports_only_lazy_markdown(self):
        direct = re.compile(r"""from\s+['"][^'"]*markdown/Markdown['"]|import\(\s*['"][^'"]*markdown/Markdown['"]""")
        heavy = re.compile(r"""^\s*import\s[^;]*?from\s+['"](streamdown|shiki|katex|mermaid|@streamdown/[\w-]+)(/[^'"]*)?['"]""", re.M)
        offenders = [rel for rel, text in _app_sources() if direct.search(text) or heavy.search(text)]
        assert offenders == [], f"import @/markdown/LazyMarkdown instead: {offenders}"

    def test_lazy_markdown_keeps_contract_exports(self):
        source = _read(MD / "LazyMarkdown.tsx")
        assert "export function Markdown(" in source
        assert "export const preloadMarkdown" in source
        assert "import('./Markdown')" in source
        assert "from './Markdown'" not in source.replace("import type", "")
        assert "variant?: 'chat' | 'docs'" in source

    def test_old_renderers_are_gone(self):
        for rel, text in _app_sources():
            for dep in ("react-markdown", "react-syntax-highlighter", "remark-gfm", "MermaidDiagram", "mermaidThemes"):
                assert dep not in text, f"{rel} still references {dep}"
        for rel in ("MermaidDiagram.tsx", "mermaidThemes.ts"):
            assert not (MD / rel).exists()

    def test_curated_shiki_not_streamdown_code(self):
        plugin = _read(MD / "shikiPlugin.ts")
        langs = re.findall(r"^\s{4}([\w]+): \(\) => import\('shiki/langs/", plugin, re.M)
        assert len(langs) == 28, langs
        assert "createJavaScriptRegexEngine" in plugin
        assert "@streamdown/code" not in _read(MD / "streamdownPlugins.ts")


class TestDocsContent:
    def test_content_renders_docs_variant(self):
        source = _read(SRC / "Content.tsx")
        assert "from './markdown/LazyMarkdown'" in source
        assert '<Markdown variant="docs">' in source
        assert 'className="aiui-doc prose max-w-none min-w-0"' in source
        assert "prose-neutral" not in source  # prose is a marker only, no typography modifiers

    def test_content_awaits_preloads_and_honours_abort(self):
        source = _read(SRC / "Content.tsx")
        block = source.split("preprocessMkdocsMarkdown(await response.text())")[1].split("setMarkdown(content)")[0]
        assert "await Promise.all([preloadMarkdown(), preloadMarkdownPlugins(content)])" in block
        assert "if (controller.signal.aborted) return" in block

    def test_docs_body_and_tables_use_foreground_token(self):
        # Light-mode contrast: body text, list items and table cells inherit the
        # root colour (Streamdown's p/li/td set no colour of their own), and the
        # root uses the foreground token, never a muted one.
        source = _read(MD / "Markdown.tsx")
        root = re.search(r"const ROOT_CLASS = '([^']+)'", source)
        assert root, "ROOT_CLASS not found"
        classes = root.group(1).split()
        assert "text-foreground" in classes
        assert "min-w-0" in classes  # code blocks/tables must not widen the page on mobile
        assert not any(c.startswith("text-muted") for c in classes)


class TestSecurity:
    def test_every_rehype_list_keeps_raw_sanitize_harden(self):
        source = _read(MD / "Markdown.tsx")
        for name in ("DOCS_REHYPE", "CHAT_REHYPE"):
            block = source.split(f"const {name} = [")[1].split("] as StreamdownProps")[0]
            assert "defaultRehypePlugins.raw" in block
            assert "sanitizePlugin" in block
            assert "defaultRehypePlugins.harden" in block
        # Each variant's list, plus the per-instance footnote-label prefix step.
        assert "[...(isDocs ? DOCS_REHYPE : CHAT_REHYPE)!, [rehypeFootnoteLabel, idPrefix]]" in source
        assert "rehypePlugins={rehypePlugins}" in source
        assert "allowedTags" not in source.split("*/", 1)[1]  # only mentioned in the header comment

    def test_chat_image_gate_runs_after_sanitize(self):
        source = _read(MD / "Markdown.tsx")
        block = source.split("const CHAT_REHYPE = [")[1].split("] as StreamdownProps")[0]
        assert block.index("sanitizePlugin") < block.index("rehypeImageGate") < block.index("harden")

    def test_chat_link_and_image_policy(self):
        policy = _read(MD / "urlPolicy.ts")
        assert "EXTERNAL_LINK_REL = 'noopener noreferrer nofollow'" in policy
        assert "data:image\\/" in policy
        assert "blob:" in policy
        assert "tagName === 'source'" in policy  # <picture><source srcset> cannot bypass the gate
        markdown = _read(MD / "Markdown.tsx")
        assert "LINKS_AS_ANCHORS = { enabled: false }" in markdown
        assert "a: PolicyLink" in markdown

    def test_chat_mermaid_is_resource_gated(self):
        # securityLevel 'strict' still keeps <img> in HTML labels and mermaid
        # lays the SVG out in the live page, so the chat plugin gates the
        # source, the label sanitizer and the final SVG.
        plugins = _read(MD / "streamdownPlugins.ts")
        assert "export const chatMermaidPlugin: DiagramPlugin = createLazyMermaidPlugin(true)" in plugins
        assert "mermaid.render(id, gateMermaidSource(source))" in plugins
        assert "svg: gateSvgResources(result.svg)" in plugins
        # labels cannot keep fetching tags, and a %%{init}%% directive cannot undo it
        assert "dompurifyConfig: CHAT_DOMPURIFY, secure: CHAT_SECURE_KEYS" in plugins
        for key in ("'dompurifyConfig'", "'themeCSS'", "'securityLevel'"):
            assert key in plugins.split("const CHAT_SECURE_KEYS = [")[1].split("]")[0], key
        markdown = _read(MD / "Markdown.tsx")
        assert "mermaid: isDocs ? lazyMermaidPlugin : chatMermaidPlugin" in markdown
        policy = _read(MD / "urlPolicy.ts")
        assert "export function gateSvgResources" in policy
        for tag in ("img", "image", "feImage", "use", "iframe", "object", "embed", "link"):
            assert tag in policy.split("const FETCHING = ")[1].split("\n")[0], tag

    def test_inline_images_stay_phrasing_content(self):
        # Streamdown's own <img> wrapper is a <div>, invalid inside <p>.
        markdown = _read(MD / "Markdown.tsx")
        assert markdown.count("img: MarkdownImage") == 2

    def test_mermaid_is_strict(self):
        plugins = _read(MD / "streamdownPlugins.ts")
        body = plugins.split("mermaid.initialize({")[1].split("mermaid.render(")[0]
        # strict comes after the spread, so no theme config can relax it
        assert body.index("...config") < body.index("securityLevel: 'strict'")


class TestVanillaPluginsLeaveStreamdownAlone:
    """The docs, chat, agents and playground styles still load the vanilla
    plugins (plugin-loader, syntax-highlight, code-copy, mermaid, toc). They
    rewrite code blocks they find: highlight.js rebuilds <code> from its text
    (Shiki's line spans collapse into one line) and code-copy wraps the <pre>.
    Rendered behaviour is covered by markdown.test.tsx and
    tests/browser/test_markdown_legacy_plugins_browser.py; these pin the
    source-level contract that keeps them off React-rendered markdown.
    """

    GUARD = "#main-content article.prose"

    def test_docs_article_matches_every_plugin_guard(self):
        # Each plugin skips React docs by this selector; the docs article must keep matching it.
        for name in ("plugin-loader.js", "syntax-highlight.js", "code-copy.js", "mermaid.js"):
            assert self.GUARD in _read(PLUGINS / name), f"{name} no longer guards with {self.GUARD}"
        content = _read(SRC / "Content.tsx")
        main = content.split('<main id="main-content"')[1].split("</main>")[0]
        article = re.search(r'<article\b[^>]*className="([^"]+)"', main)
        assert article, "the docs <article> must sit inside <main id=\"main-content\">"
        assert "prose" in article.group(1).split()

    def test_prose_marker_does_not_style_streamdown(self):
        # @tailwindcss/typography skips everything under not-prose.
        source = _read(MD / "Markdown.tsx")
        root = re.search(r"const ROOT_CLASS = '([^']+)'", source)
        assert root and {"aiui-markdown", "not-prose"} <= set(root.group(1).split())

    def test_code_blocks_are_hidden_from_highlight_js(self):
        # Chat messages have no guarded ancestor: every fenced block carries
        # `nohighlight` and no word-boundary `language-` class.
        source = _read(MD / "Markdown.tsx")
        assert source.count("code: LegacySafeCode") == 2  # chat and docs maps
        guard = _read(MD / "legacyPlugins.ts")
        assert "'$1aiuilanguage-$2'" in guard
        assert "export const NO_HIGHLIGHT = 'nohighlight'" in guard

    def test_code_blocks_are_marked_done_for_code_copy(self):
        source = _read(MD / "Markdown.tsx")
        assert "useLegacyCopyGuard(guardId)" in source
        assert "data-aiui-markdown={guardId}" in source
        guard = _read(MD / "legacyPlugins.ts")
        assert "new MutationObserver" in guard
        assert "attributeFilter: ['data-copy-processed']" in guard
        assert "copyProcessed" in guard  # dataset key of data-copy-processed

    def test_legacy_pre_box_styles_are_reset_in_the_base_layer(self):
        # syntax-highlight.js injects `pre {… !important}`; index.css has
        # `.prose pre {… !important}` in the components layer. Only an
        # !important rule in an earlier layer (base) beats both.
        assert re.search(r"^\s*pre\s*\{", _read(PLUGINS / "syntax-highlight.js"), re.M)
        assert "import './markdown.css'" in _read(MD / "Markdown.tsx")
        css = _read(MD / "markdown.css")
        rule = css.split("@layer base {")[1]
        assert ".aiui-markdown [data-streamdown='code-block-body'] > pre" in rule
        for decl in ("padding: 0 !important", "border: 0 !important", "background-color: transparent !important"):
            assert decl in rule, decl
