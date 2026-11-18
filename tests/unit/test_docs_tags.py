"""Docs component tags: unknown-tag build warning, comments, {#id} (compiler/docs_tags.py)."""

from __future__ import annotations

import re
from pathlib import Path

from typer.testing import CliRunner

from praisonaiui.cli import app
from praisonaiui.compiler.docs_tags import (
    KNOWN_DOCS_TAGS,
    heading_id,
    strip_comments,
    unknown_tags,
)
from praisonaiui.compiler.search_index import page_entry

REPO = Path(__file__).resolve().parents[2]
TS_TABLE = REPO / "src" / "frontend" / "src" / "markdown" / "docsTags.ts"


def test_known_tags_match_the_renderer_table():
    """KNOWN_DOCS_TAGS mirrors DOCS_TAG_NAMES (DOCS_TAGS keys + PASSTHROUGH) in docsTags.ts."""
    src = TS_TABLE.read_text(encoding="utf-8")
    table = src[src.index("export const DOCS_TAGS") : src.index("\n}\n", src.index("export const DOCS_TAGS"))]
    names = set(re.findall(r"^    ([A-Z]\w*):", table, re.M))
    names |= set(re.findall(r"'([A-Z]\w*)'", re.search(r"PASSTHROUGH = new Set\(\[(.*?)\]\)", src).group(1)))
    assert names == set(KNOWN_DOCS_TAGS)


def test_unknown_tags_are_reported_once_with_their_first_line():
    md = "\n".join(
        [
            "# Page",  # 1
            "<Note>known</Note>",  # 2
            "<Tree>",  # 3
            '  <Tree.Folder name="app">',  # 4
            "  </Tree.Folder>",  # 5
            "</Tree>",  # 6
            "```mdx",  # 7
            "<InFence />",  # 8
            "```",  # 9
            "Use `<InSpan>` and <B>bold</B>, <DIV>x</DIV>.",  # 10
            "{/* <InComment /> */}",  # 11
            '<Tree label="again" /> <Color hex="#fff">c</Color>',  # 12
        ]
    )
    assert unknown_tags(md) == [(3, "Tree"), (4, "Tree.Folder"), (12, "Color")]


def test_comments_are_removed_outside_fences_keeping_line_numbers():
    md = "a {/* x */} b\n{/* multi\nline */}\n<!-- html -->\n```\n{/* code */}\n```\n"
    out = strip_comments(md)
    assert out == "a  b\n\n\n\n```\n{/* code */}\n```\n"
    assert out.count("\n") == md.count("\n")


def test_search_index_uses_custom_ids_and_skips_comments():
    assert heading_id("Plain") == ("Plain", None)
    entry = page_entry("/docs/a", "A", "", "## My section {#custom}\n\nText {/* secret */} here\n")
    assert entry["s"] == [{"h": "My section", "a": "custom", "l": 2, "x": "Text here"}]


def _site(tmp_path: Path, page: str) -> Path:
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "index.md").write_text("# Home\n", encoding="utf-8")
    (tmp_path / "docs" / "guide.md").write_text(page, encoding="utf-8")
    config = tmp_path / "aiui.yaml"
    config.write_text(
        "site:\n  title: T\nseo:\n  siteUrl: https://example.com\ncontent:\n  docs:\n    dir: ./docs\n",
        encoding="utf-8",
    )
    return config


def test_build_and_validate_warn_about_unknown_components_with_file_and_line(tmp_path):
    config = _site(tmp_path, "# Guide\n\n<Note>ok</Note>\n\n<Tree>\nkept {/* hidden */}\n</Tree>\n")
    out = tmp_path / "out"
    for args in (["build", "--output", str(out)], ["validate"]):
        result = CliRunner().invoke(app, [*args, "--config", str(config)])
        assert result.exit_code == 0, result.output
        text = " ".join(result.output.split())
        assert "docs/guide.md:5: <Tree> is not a docs component" in text
        assert "<Note>" not in text
    # Agents' full export drops the MDX comment.
    full = (out / "llms-full.txt").read_text(encoding="utf-8")
    assert "kept" in full and "hidden" not in full
