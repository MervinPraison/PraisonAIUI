"""Changelog pages (docs/features/writing-docs.md#changelog).

A page's ``<Update label="2026-11-18" description="v1.2" tags={["API"]}>``
blocks are its entries. With front matter ``rss: true``, ``aiui build`` writes
an RSS 2.0 feed of them at ``<page>/rss.xml`` (absolute links when the site URL
is known) and links it from the page's head. Every value is escaped (R9).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from email.utils import format_datetime
from html import escape

from praisonaiui.compiler import agent_markdown as am
from praisonaiui.compiler.docs_tags import strip_comments
from praisonaiui.compiler.search_index import slugify

FEED = "rss.xml"
_OPEN = re.compile(rf"<Update\b({am._ATTRS})\s*(/?)>")
_CLOSE = "</Update>"
_ID = re.compile(r"[\w-]+")
_DATES = ("%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%B %Y", "%b %Y")
_ISO_IN = re.compile(r"\d{4}-\d{2}-\d{2}")


def anchor(attrs: dict[str, str]) -> str:
    """The entry's id: ``id="…"`` when it is one, else the label's slug (as docs/DocsUpdate.tsx)."""
    return attrs["id"] if _ID.fullmatch(attrs.get("id", "")) else slugify(attrs.get("label", ""))


def entry_date(label: str) -> datetime | None:
    """The date a label names (``2026-11-18``, ``November 18, 2026``, ``v1.2 (2026-11-18)``), else None."""
    text = label.strip()
    found = _ISO_IN.search(text)
    for value, formats in ((text, _DATES), (found.group(0) if found else "", _DATES[:1])):
        for fmt in formats:
            try:
                return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def updates(text: str, **links: str) -> list[dict]:
    """The ``<Update>`` entries of a page body (no front matter), in order; ``body`` is
    plain Markdown, page links to the pages (``links``: page_dir, docs_base, site)."""
    code = am._Code()
    masked = am.visibility(code.mask(strip_comments(text)), "humans", code)
    out = []
    for m in _OPEN.finditer(masked):
        a = am._attrs(m.group(1))
        end = masked.find(_CLOSE, m.end())
        body = "" if m.group(2) else masked[m.end() : end if end >= 0 else len(masked)]
        out.append({
            "label": a.get("label", "").strip(),
            "description": a.get("description", "").strip(),
            "tags": am.labels(a.get("tags")),
            "anchor": anchor(a),
            "body": am.body_markdown(code.unmask(body), md=False, **links),
        })
    return out


_LIST = re.compile(r"^\s*(?:[-*+]|\d{1,9}[.)])\s+")
_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def _inline(text: str) -> str:
    s = escape(text)
    s = _LINK.sub(r'<a href="\2">\1</a>', s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)


def to_html(md: str) -> str:
    """Plain Markdown as simple, escaped HTML for a feed reader: paragraphs, lists, code, links."""
    out: list[str] = []
    block: list[str] = []
    kind = ""
    fence = ""

    def flush() -> None:
        nonlocal block, kind
        if kind == "ul":
            out.append("<ul>" + "".join(f"<li>{_inline(x)}</li>" for x in block) + "</ul>")
        elif kind == "pre":
            out.append(f"<pre><code>{escape(chr(10).join(block))}</code></pre>")
        elif block:
            out.append(f"<p>{_inline(' '.join(block))}</p>")
        block, kind = [], ""

    for line in md.split("\n"):
        f = re.match(r"\s*(`{3,}|~{3,})", line)
        if fence:
            if f and f.group(1)[0] == fence[0] and line.strip() == f.group(1):
                flush()
                fence = ""
            else:
                block.append(line)
            continue
        if f:
            flush()
            fence, kind = f.group(1), "pre"
            continue
        text = re.sub(r"^(>\s?)+", "", line).strip()
        heading = re.match(r"#{1,6}\s+(.*)", text)
        if not text or heading:
            flush()
            if heading:
                out.append(f"<p><strong>{_inline(heading.group(1))}</strong></p>")
        elif _LIST.match(text):
            if kind != "ul":
                flush()
            kind = "ul"
            block.append(_LIST.sub("", text))
        elif kind == "ul":
            block[-1] += " " + text
        else:
            block.append(text)
    flush()
    return "\n".join(out)


def feed(*, title: str, description: str, page_url: str, feed_url: str, entries: list[dict]) -> str:
    """The RSS 2.0 document for one changelog page (newest entries as written, first)."""
    items, dates = [], []
    for e in entries:
        link = f"{page_url}#{e['anchor']}" if e["anchor"] else page_url
        when = entry_date(e["label"])
        parts = [
            f"<title>{escape(': '.join(x for x in (e['label'], e['description']) if x) or 'Update')}</title>",
            f"<link>{escape(link)}</link>",
            f'<guid isPermaLink="true">{escape(link)}</guid>',
        ]
        if when:
            dates.append(when)
            parts.append(f"<pubDate>{format_datetime(when)}</pubDate>")
        parts += [f"<category>{escape(t)}</category>" for t in e["tags"]]
        if e["body"]:
            parts.append(f"<description>{escape(to_html(e['body']))}</description>")
        items.append("    <item>\n      " + "\n      ".join(parts) + "\n    </item>")
    head = [
        f"<title>{escape(title)}</title>",
        f"<link>{escape(page_url)}</link>",
        f"<description>{escape(description or title)}</description>",
        f'<atom:link href="{escape(feed_url)}" rel="self" type="application/rss+xml" />',
    ]
    if dates:  # the newest entry, so a rebuild with no new entry writes the same file
        head.append(f"<lastBuildDate>{format_datetime(max(dates))}</lastBuildDate>")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    '
        + "\n    ".join(head)
        + ("\n" + "\n".join(items) if items else "")
        + "\n  </channel>\n</rss>\n"
    )


def head_link(title: str, url: str) -> str:
    """``<link rel="alternate" type="application/rss+xml">`` for the page's static head."""
    return f'  <link rel="alternate" type="application/rss+xml" title="{escape(title)}" href="{escape(url)}" />'
