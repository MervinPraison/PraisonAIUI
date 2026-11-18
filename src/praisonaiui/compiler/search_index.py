"""Full-text search index for docs sites (``search-index.json``).

``aiui build`` writes one entry per page: its path, title, description and
the text under each ``##`` / ``###`` heading, with the heading's anchor. The
docs search dialog (``src/frontend/src/docs/searchIndex.ts``) loads the file
the first time a reader opens search and ranks pages, sections and text.

Anchors use the same rule as the renderer's heading ids
(``src/frontend/src/markdown/slug.ts``, or the ``{#id}`` an author wrote), so
a result opens at its section. Comments are not indexed.
"""

from __future__ import annotations

import re
from typing import Any

from praisonaiui.compiler.docs_tags import heading_id, strip_comments

#: Characters of body text kept per section (enough for a snippet and for
#: matching words a reader would search for; keeps the file small).
SECTION_TEXT_LIMIT = 600

_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
_HEADING = re.compile(r"^(#{1,3})\s+(.+?)\s*#*\s*$")
_MKDOCS_BLOCK = re.compile(r'^(?:!!!|\?\?\?\+?|===\+?)\s*(?:[\w-]+)?\s*(?:"(.*)")?\s*$')
_HTML_TAG = re.compile(r"<[^>]+>")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
# Emphasis marks; a lone * or _ only at a word edge, so snake_case stays.
_INLINE = re.compile(r"\*\*|~~|(?<!\w)[*_]+|[*_]+(?!\w)")
_CODE_SPAN = re.compile(r"(`+)(.+?)\1")
_TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{2,}")
_SPACE = re.compile(r"\s+")


def slugify(text: str) -> str:
    """Heading id, as ``markdown/slug.ts`` computes it from the heading's text."""
    s = text.lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.ASCII)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def inline_text(markdown: str) -> str:
    """Inline Markdown as the reader sees it (links, emphasis, code marks and tags removed)."""
    s = _IMAGE.sub(r"\1", markdown)
    s = _LINK.sub(r"\1", s)
    s = _HTML_TAG.sub(" ", s)
    # Code spans keep their text as written; emphasis marks go everywhere else.
    parts = _CODE_SPAN.split(s)
    out = []
    for i, part in enumerate(parts):
        if i % 3 == 0:
            out.append(_INLINE.sub("", part).replace("`", ""))
        elif i % 3 == 2:
            out.append(part.strip())
    return "".join(out).strip()


def plain_text(markdown_line: str) -> str:
    """One line of Markdown as text: ``inline_text`` without quote, list or table marks."""
    s = markdown_line.strip()
    s = re.sub(r"^(>\s*)+", "", s)
    s = re.sub(r"^([-*+]|\d+[.)])\s+", "", s)
    s = inline_text(s)
    if s.startswith("|"):
        s = " ".join(c.strip() for c in s.strip("|").split("|"))
    return s


def _sections(body: str) -> list[dict[str, Any]]:
    """Split a page into sections: the intro, then one per ``##`` / ``###``."""
    sections: list[dict[str, Any]] = [{"heading": "", "anchor": "", "level": 1, "text": []}]
    fence: str | None = None
    for raw in strip_comments(body).splitlines():
        m = _FENCE.match(raw)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                fence = None
            continue
        if m:
            fence = m.group(1)
            continue
        h = _HEADING.match(raw)
        if h:
            level = len(h.group(1))
            raw_title, custom_id = heading_id(h.group(2))
            title = inline_text(raw_title)
            if level == 1:
                continue
            anchor = custom_id or slugify(title)
            sections.append({"heading": title, "anchor": anchor, "level": level, "text": []})
            continue
        if _TABLE_RULE.match(raw):
            continue
        block = _MKDOCS_BLOCK.match(raw.strip())
        line = (block.group(1) or "") if block else plain_text(raw)
        if line:
            sections[-1]["text"].append(line)
    out = []
    for s in sections:
        text = _SPACE.sub(" ", " ".join(s["text"])).strip()
        if len(text) > SECTION_TEXT_LIMIT:
            text = text[:SECTION_TEXT_LIMIT].rsplit(" ", 1)[0]
        if s["heading"] or text:
            out.append({"h": s["heading"], "a": s["anchor"], "l": s["level"], "x": text})
    return out


def page_entry(path: str, title: str, description: str, body: str) -> dict[str, Any]:
    """The index entry of one page (``body`` is its Markdown without front matter)."""
    return {"p": path, "t": title, "d": description, "s": _sections(body)}
