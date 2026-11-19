"""Full-text search index for docs sites (``search-index.json``, ``search-index/``).

``aiui build`` writes one entry per page: its path, title, description, the
text under each ``##`` / ``###`` heading with the heading's anchor, and the
page's front matter ``keywords`` (``k``, matched but never shown) and
``boost`` (``b``, a ranking multiplier). Pages with ``searchable: false`` are
left out. The docs search dialog (``src/frontend/src/docs/searchIndex.ts``)
loads the file the first time a reader opens search and ranks pages,
sections and text.

Anchors use the same rule as the renderer's heading ids
(``src/frontend/src/markdown/slug.ts``, or the ``{#id}`` an author wrote), so
a result opens at its section. Comments are not indexed.

The same entries are also written split up (:func:`write_shards`), so the dialog
downloads a small part of them: ``search-index/meta.json`` holds each page's
path, keywords, boost and section headings with their word counts, plus the
sorted list of every word; ``search-index/<key>/w<n>.json`` holds, for a run of
those words, the sections each appears in and how often; ``.../p<i>.json``
holds page ``i``'s section text, for the snippets of the results shown. The
dialog fetches the meta file on first open, the word files a query's words
match and the text of the pages it lists, and ranks exactly as it would with
the whole file (``searchIndex.ts`` ``ShardedIndex``). ``<key>`` is a hash of
the index, so a page cached from an older deploy never mixes its meta file with
newer parts; a missing part makes the dialog fall back to ``search-index.json``.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

from praisonaiui.compiler.docs_tags import heading_id, strip_comments

#: Characters of body text kept per section. Every word of a normal section is
#: searchable (this repo's longest is about 5 000); the cap only guards against
#: a giant generated section bloating the file the dialog downloads.
SECTION_TEXT_LIMIT = 6000
#: Range of the front matter ``boost``.
BOOST_RANGE = (0.1, 10.0)

_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
_HEADING = re.compile(r"^(#{1,3})\s+(.+?)\s*#*\s*$")
_MKDOCS_BLOCK = re.compile(r'^(?:!!!|\?\?\?\+?|===\+?)\s*(?:[\w-]+)?\s*(?:"(.*)")?\s*$')
_HTML_TAG = re.compile(r"<[^>]+>")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
# Emphasis marks; a lone * or _ only at a word edge, so snake_case stays.
_INLINE = re.compile(r"\*\*|~~|(?<!\w)[*_]+|[*_]+(?!\w)")
_CODE_SPAN = re.compile(r"(`+)(.+?)\1")
# <Update label="…">: a changelog entry, a section of its own (compiler/changelog.py).
_UPDATE = re.compile(r"^\s*<Update\b(.*?)/?>")
_TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{2,}")
_SPACE = re.compile(r"\s+")


# JavaScript's \s (ECMAScript WhiteSpace + LineTerminator). Python's \s differs
# (no U+FEFF, adds U+001C-U+001F and U+0085), so slug.ts's classes are spelt out.
_JS_SPACE = "\t\n\v\f\r    -     　﻿"
_SLUG_DROP = re.compile(f"[^A-Za-z0-9_{_JS_SPACE}-]")
_SLUG_SPACE = re.compile(f"[{_JS_SPACE}]+")


def slugify(text: str) -> str:
    """Heading id, exactly as ``markdown/slug.ts`` computes it from the heading's text."""
    s = _SLUG_DROP.sub("", text.lower())
    s = _SLUG_SPACE.sub("-", s)
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
        update = _UPDATE.match(raw)
        if update:
            from praisonaiui.compiler import changelog  # it imports this module

            a = changelog.am._attrs(update.group(1))
            if a.get("label"):
                info = [a.get("description", ""), *changelog.am.labels(a.get("tags"))]
                sections.append({"heading": a["label"], "anchor": changelog.anchor(a), "level": 2, "text": [x for x in info if x]})
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


def keywords_of(value: Any) -> list[str]:
    """Front matter ``keywords``: a list or a comma-separated string, blanks dropped."""
    items = value.split(",") if isinstance(value, str) else value if isinstance(value, list) else []
    return [k for k in (str(item).strip() for item in items if item is not None) if k]


def boost_of(value: Any) -> float | None:
    """Front matter ``boost``, clamped to ``BOOST_RANGE``; ``None`` when absent, invalid or 1."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        boost = float(value)
    except ValueError:
        return None
    if boost != boost or boost <= 0:  # NaN or not a positive number
        return None
    boost = min(max(boost, BOOST_RANGE[0]), BOOST_RANGE[1])
    return None if boost == 1 else boost


def page_entry(
    path: str, title: str, description: str, body: str, frontmatter: dict | None = None
) -> dict[str, Any]:
    """The index entry of one page (``body`` is its Markdown without front matter)."""
    entry: dict[str, Any] = {"p": path, "t": title, "d": description, "s": _sections(body)}
    meta = frontmatter or {}
    if keywords := keywords_of(meta.get("keywords")):
        entry["k"] = keywords
    if (boost := boost_of(meta.get("boost"))) is not None:
        entry["b"] = boost
    return entry


#: Folder of the split index, beside ``search-index.json``.
SHARDS_DIR = "search-index"
#: Format of ``search-index/meta.json``.
SHARDS_VERSION = 2
#: About this many characters of postings per word file (a few kB gzipped).
SHARD_CHARS = 16_000
#: How often a section's heading counts, as ``searchIndex.ts`` HEADING_WEIGHT.
HEADING_WEIGHT = 2
_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def tokenize(text: str) -> list[str]:
    """Words exactly as ``searchRank.ts`` ``tokenize`` finds them: lower case, runs of
    letters and digits in any script (``/[\\p{L}\\p{N}]+/gu``)."""
    words, word = [], []
    for ch in text.lower():
        if unicodedata.category(ch)[0] in "LN":
            word.append(ch)
        elif word:
            words.append("".join(word))
            word = []
    if word:
        words.append("".join(word))
    return words


def _b36(n: int) -> str:
    out = ""
    while True:
        n, r = divmod(n, 36)
        out = _B36[r] + out
        if not n:
            return out


def _postings(entries: list[tuple[int, int]]) -> str:
    """``"<gap>[:<count>],…"``: section ids as gaps from the previous one, counts over 1, base 36."""
    prev, parts = 0, []
    for sid, tf in entries:
        parts.append(_b36(sid - prev) + (f":{_b36(tf)}" if tf > 1 else ""))
        prev = sid
    return ",".join(parts)


def _dump(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_shards(
    output_dir: Path, pages: list[dict[str, Any]], index_json: str, shard_chars: int = SHARD_CHARS
) -> list[str]:
    """Write the split index of ``pages`` (:func:`page_entry` entries) under
    :data:`SHARDS_DIR`, replacing any earlier one. ``index_json``: the text of
    ``search-index.json``, hashed into the key; ``shard_chars``: the size of a
    word file (:data:`SHARD_CHARS`). Returns the files written."""
    root = output_dir / SHARDS_DIR
    shutil.rmtree(root, ignore_errors=True)
    key = hashlib.sha256(index_json.encode("utf-8")).hexdigest()[:10]
    (root / key).mkdir(parents=True)
    postings: dict[str, list[tuple[int, int]]] = {}
    meta_pages, texts, sid = [], [], 0
    for page in pages:
        sections = []
        for sec in page["s"]:
            words = tokenize(sec["h"]) * HEADING_WEIGHT + tokenize(sec["x"])
            for word, tf in Counter(words).items():
                postings.setdefault(word, []).append((sid, tf))
            sections.append([sec["h"], sec["a"], len(words)])
            sid += 1
        meta_pages.append({"p": page["p"], "s": sections,
                           **{k: page[k] for k in ("k", "b") if k in page}})
        texts.append([sec["x"] for sec in page["s"]])
    words = sorted(postings)
    starts, shard, size = [], [], shard_chars
    files = [f"{SHARDS_DIR}/meta.json"]
    for i, word in enumerate(words):
        if size >= shard_chars:
            if shard:
                _dump(root / key / f"w{len(starts) - 1}.json", shard)
            starts.append(i)
            shard, size = [], 0
        shard.append(_postings(postings[word]))
        size += len(word) + len(shard[-1])
    if shard:
        _dump(root / key / f"w{len(starts) - 1}.json", shard)
    files += [f"{SHARDS_DIR}/{key}/w{n}.json" for n in range(len(starts))]
    for i, text in enumerate(texts):
        _dump(root / key / f"p{i}.json", text)
        files.append(f"{SHARDS_DIR}/{key}/p{i}.json")
    _dump(root / "meta.json", {"version": SHARDS_VERSION, "key": key, "pages": meta_pages,
                               "words": words, "shards": starts})
    return files
