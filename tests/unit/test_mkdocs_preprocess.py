"""MkDocs Material preprocessing contract for the React docs renderer.

The behaviour itself is tested in TypeScript, against the real code, by
src/frontend/src/markdown/markdown.test.tsx (``npm test -- markdown``):
admonitions, collapsibles, tabs, nesting, fence-awareness and rendering.
This module pins the contract the Streamdown docs variant relies on, and runs
that JS suite when the frontend dependencies are installed.

(It used to mirror the old ``convertMkdocsTabs`` logic in Python; that
heading-based tab conversion is gone.)
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path("src/frontend")
PREPROCESS = FRONTEND / "src/markdown/mkdocsPreprocess.ts"
MARKDOWN = FRONTEND / "src/markdown/Markdown.tsx"
BLOCKS = FRONTEND / "src/markdown/MkdocsBlocks.tsx"


def _src(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class TestMkdocsPreprocessContract:
    def test_blocks_become_aiui_tags(self):
        source = _src(PREPROCESS)
        assert "export function convertMkdocsBlocks" in source
        assert "<aiui-admonition" in source
        assert "<aiui-tabs>" in source
        assert "<aiui-tab title=" in source
        # collapsible ??? / ???+ admonitions
        assert 'collapsible="open"' in source
        assert 'collapsible="closed"' in source

    def test_preprocess_pipeline(self):
        source = _src(PREPROCESS)
        pipeline = source.split("export function preprocessMkdocsMarkdown")[1]
        assert "stripMkdocsGridWrappers" in pipeline
        assert "replaceMkdocsIcons" in pipeline
        assert "convertMkdocsBlocks" in pipeline

    def test_legacy_tab_headings_removed(self):
        source = _src(PREPROCESS)
        assert "convertMkdocsTabs" not in source
        assert "\\u200Btab:" not in source

    def test_transforms_are_fence_aware(self):
        source = _src(PREPROCESS)
        assert "outsideFences" in source
        assert "FENCE_RE" in source

    def test_docs_sanitize_schema_allows_exactly_the_aiui_tags(self):
        source = _src(MARKDOWN)
        assert "'aiui-admonition', 'aiui-tabs', 'aiui-tab'" in source
        assert "'aiui-admonition': ['type', 'title', 'collapsible']" in source
        assert "'aiui-tab': ['title']" in source
        # allowedTags rewrites blank lines inside the tag and corrupts code
        assert "allowedTags=" not in source

    def test_blocks_have_renderers(self):
        source = _src(BLOCKS)
        assert "export function Admonition" in source
        assert "export function MkdocsTabs" in source
        assert 'role="tablist"' in source


def _frontend_ready() -> bool:
    return (
        shutil.which("node") is not None
        and (FRONTEND / "node_modules/esbuild").is_dir()
        and (FRONTEND / "node_modules/streamdown").is_dir()
    )


@pytest.mark.skipif(not _frontend_ready(), reason="frontend node_modules not installed")
def test_markdown_js_suite_passes():
    """Run the real TypeScript suite (admonitions, tabs, XSS, image gate ...)."""
    result = subprocess.run(
        ["node", "scripts/run-tests.mjs", "src/markdown/markdown.test"],
        cwd=FRONTEND,
        capture_output=True,
        text=True,
        timeout=300,
        env={**os.environ, "NODE_NO_WARNINGS": "1"},
    )
    # The exit code is the verdict: Node prints TAP or its spec report
    # depending on whether stdout is a TTY, so text checks are flaky.
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-4000:]
