"""Docs component tags on the Python side of ``aiui build``.

``KNOWN_DOCS_TAGS`` mirrors the renderer's table (``DOCS_TAG_NAMES`` in
``src/frontend/src/markdown/docsTags.ts``; ``tests/unit/test_docs_tags.py``
checks they match). Any other PascalCase tag still renders, dropped with its
children shown as Markdown, and the build warns with file and line. Also:
comments removed from what the build publishes, and ``## Title {#id}``.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from pathlib import Path

#: Mirrors ``DOCS_TAG_NAMES`` in ``src/frontend/src/markdown/docsTags.ts``.
KNOWN_DOCS_TAGS = frozenset(
    "Note Info Tip Check Warning Danger Accordion AccordionGroup Tabs Tab "
    "Steps Step CardGroup Card Columns Column Frame CodeGroup CodeBlock "
    "ParamField ResponseField Expandable Panel RequestExample ResponseExample Visibility "
    "Callout Badge Tooltip Icon Tile Prompt Tree FileTree Tree.Folder Tree.File Color Color.Row Color.Item Update".split()
)

_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
_CODE_SPAN = re.compile(r"(`+).+?\1")
# A component name has a lower-case letter, so <DIV> and <B> stay HTML.
_TAG = re.compile(r"</?([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*)(?=[\s/>]|$)")
_COMMENT = re.compile(r"\{/\*.*?\*/\}|<!--.*?-->", re.S)
_HEADING_ID = re.compile(r"\s*\{#([\w-]+)\}\s*$")
# <CodeBlock …>code</CodeBlock>: its body is code (the renderer turns it into a fence).
_CODE_BLOCK = re.compile(r"^\s*<CodeBlock\b")
_CODE_BLOCK_END = "</CodeBlock>"


def _prose_segments(text: str) -> Iterable[tuple[bool, str]]:
    """``(is_code, chunk)`` runs: fenced code and ``<CodeBlock>`` bodies verbatim, prose between."""
    fence: str | None = None
    buf: list[str] = []
    for line in text.splitlines(keepends=True):
        m = _FENCE.match(line)
        if fence is None and (m or _CODE_BLOCK.match(line)):
            if buf:
                yield False, "".join(buf)
            buf, fence = [line], m.group(1) if m else _CODE_BLOCK_END
            if fence == _CODE_BLOCK_END and _CODE_BLOCK_END in line:
                yield True, line
                buf, fence = [], None
            continue
        buf.append(line)
        if fence == _CODE_BLOCK_END:
            if _CODE_BLOCK_END in line:
                yield True, "".join(buf)
                buf, fence = [], None
            continue
        if fence and m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
            if line.strip() == m.group(1):
                yield True, "".join(buf)
                buf, fence = [], None
    if buf:
        yield fence is not None, "".join(buf)


def strip_comments(text: str) -> str:
    """Remove ``{/* … */}`` and ``<!-- … -->`` outside fenced code (line count kept)."""

    def blank(m: re.Match[str]) -> str:
        return "\n" * m.group(0).count("\n")

    return "".join(chunk if code else _COMMENT.sub(blank, chunk) for code, chunk in _prose_segments(text))


def heading_id(title: str) -> tuple[str, str | None]:
    """``"Title {#id}"`` → ``("Title", "id")``; a title without one → ``(title, None)``."""
    m = _HEADING_ID.search(title)
    return (title[: m.start()], m.group(1)) if m else (title, None)


def unknown_tags(text: str) -> list[tuple[int, str]]:
    """``(line, tag)`` for the first use of each PascalCase tag not in ``KNOWN_DOCS_TAGS``."""
    seen: dict[str, int] = {}
    line_no = 1
    for code, chunk in _prose_segments(strip_comments(text)):
        if not code:
            for offset, line in enumerate(chunk.splitlines()):
                for name in _TAG.findall(_CODE_SPAN.sub("", line)):
                    if re.search(r"[a-z]", name) and name not in KNOWN_DOCS_TAGS:
                        seen.setdefault(name, line_no + offset)
        line_no += chunk.count("\n")
    return sorted(((line, name) for name, line in seen.items()))


def lint_pages(paths: Iterable[Path], root: Path, read: Callable[[Path], str] | None = None) -> list[str]:
    """One warning per unknown tag per page: ``docs/a.md:12: <Gadget> is not a docs component …``.

    ``read``: the page text (``Compiler._page_text``: snippets expanded)."""
    warnings: list[str] = []
    for path in paths:
        text = read(path) if read else path.read_text(encoding="utf-8")
        try:
            shown = path.relative_to(root)
        except ValueError:
            shown = path
        for line, name in unknown_tags(text):
            warnings.append(
                f"{shown.as_posix()}:{line}: <{name}> is not a docs component; "
                "its content shows as plain Markdown"
            )
    return warnings
