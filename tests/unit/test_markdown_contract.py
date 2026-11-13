"""Contract of the single Streamdown markdown renderer (WP1, ADR-0001 §5).

Source-level guardrails for things a refactor can silently break: the lazy
boundary that keeps Streamdown out of the entry, the sanitize pipeline, the
chat link/image policy (owner decision 1), and light-mode contrast of docs
body text and table cells (moved here from test_light_mode_contrast.py).
Rendering behaviour is tested in src/frontend/src/markdown/markdown.test.tsx.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

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
        assert 'className="aiui-doc max-w-none min-w-0"' in source
        assert "prose-neutral" not in source

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
        assert "rehypePlugins={isDocs ? DOCS_REHYPE : CHAT_REHYPE}" in source
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
    """The docs and chat styles still load the vanilla plugins (plugin-loader,
    syntax-highlight, code-copy, mermaid). They skip React-rendered markdown by
    looking for ``#main-content article.prose``, which the Streamdown docs
    article no longer has. Measured with ``aiui build`` + the new bundle:
    highlight.js re-highlights every Streamdown code block (Shiki spans gone,
    React-owned DOM replaced) and its global ``pre`` rule boxes the code a
    second time; a theme toggle re-runs it on chat messages too.

    The plugin files are outside WP1's ownership (cross-file request to WP8).
    Strict xfail: once the guards also skip ``.aiui-markdown`` this XPASSes
    and fails, and the marker must be removed.
    """

    @pytest.mark.xfail(strict=True, reason="WP8 cross-file request: plugin guards must skip .aiui-markdown / article.aiui-doc")
    def test_plugins_skip_streamdown_output(self):
        loader = _read(PLUGINS / "plugin-loader.js")
        assert "article.aiui-doc" in loader or ".aiui-markdown" in loader
        for name in ("syntax-highlight.js", "code-copy.js", "mermaid.js"):
            assert ".aiui-markdown" in _read(PLUGINS / name), name
        # highlight.js's override sheet must not restyle every <pre> on the page
        highlight = _read(PLUGINS / "syntax-highlight.js")
        assert not re.search(r"^\s*pre\s*\{", highlight, re.M)

    def test_streamdown_root_carries_the_skip_marker(self):
        # The class the plugins are asked to skip is on every rendered root.
        source = _read(MD / "Markdown.tsx")
        root = re.search(r"const ROOT_CLASS = '([^']+)'", source)
        assert root and "aiui-markdown" in root.group(1).split()
        assert 'className="aiui-doc max-w-none min-w-0"' in _read(SRC / "Content.tsx")
