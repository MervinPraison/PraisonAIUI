"""Related pages: a short list of other pages under each docs page.

``aiui build`` scores every page against the others with TF-IDF over the
words the search index holds (title, keywords, description, headings and,
lightly, the text), adds a little for pages in the same sidebar group, and
writes the best ``limit`` (``content.docs.related``, default 3) as each
page's ``related`` in ``docs-nav.json``: a path, or ``{title, path|href}``
for an entry the author labelled or that leaves the site. Hidden, noindex,
``searchable: false`` pages, the home page and external links are never
suggested.

Front matter ``related: [path, …]`` replaces the suggestions (a docs path,
``./sibling``, an ``https://`` URL, or ``{Label: target}``); ``related: false``
shows none. ``aiui validate`` reports a target that is no page (7013).
"""

from __future__ import annotations

import math
import posixpath
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Callable, Optional

from praisonaiui.compiler.content_lint import ContentIssue
from praisonaiui.compiler.search_index import keywords_of, page_entry

DEFAULT_LIMIT = 3
MAX_LIMIT = 10
#: Terms kept per page vector: the rarest, most repeated words say what a page is about.
_TERMS = 30
#: Weight of a word by where it appears.
_WEIGHTS = {"title": 3.0, "keywords": 3.0, "headings": 2.0, "description": 1.5, "text": 0.25}
#: Same sidebar group, same top-level section.
_GROUP_BONUS, _SECTION_BONUS = 1.25, 1.1
#: Below this cosine score a page is not related, however few others there are.
_MIN_SCORE = 0.05
_URL = re.compile(r"https?://\S+$")
_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and are as at be by can do does for from has have how i if in into is it its of on or our so "
    "that the their them then there these this to use used uses using was we what when where which "
    "will with you your not all any each more most other some such than too very just also only own "
    "same both may must should would could get set one two new see page pages docs".split()
)


def tokens(text: str) -> list[str]:
    """Lowercase words, stop words and lone digits dropped, a plural ``s`` folded."""
    out = []
    for w in _WORD.findall(text.lower()):
        if len(w) < 2 or w in _STOP or w.isdigit():
            continue
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return out


def limit_of(value: Any) -> int:
    """``content.docs.related``: ``false``/``0`` → 0, ``true``/unset → 3, a number → itself (at most 10)."""
    if value is None or value is True:
        return DEFAULT_LIMIT
    if value is False or isinstance(value, bool) or not isinstance(value, int):
        return 0
    return max(0, min(value, MAX_LIMIT))


@dataclass
class _Doc:
    path: str
    group: str  # the sidebar group holding the page
    section: str  # its top-level section
    candidate: bool
    vector: dict[str, float]


def _crumb(trail: list[dict]) -> str:
    """A group's key (its page, else its title); "" at the top level."""
    return (trail[0].get("path") or trail[0].get("title", "")) if trail else ""


def _counts(entry: dict) -> dict[str, float]:
    counts: dict[str, float] = defaultdict(float)
    parts = {
        "title": entry.get("t", ""),
        "keywords": " ".join(entry.get("k", [])),
        "description": entry.get("d", ""),
        "headings": " ".join(s["h"] for s in entry.get("s", [])),
        "text": " ".join(s["x"] for s in entry.get("s", [])),
    }
    for part, text in parts.items():
        for w in tokens(text):
            counts[w] += _WEIGHTS[part]
    return counts


def _vectors(counts: list[dict[str, float]]) -> list[dict[str, float]]:
    """TF-IDF (log-scaled term weight), the top ``_TERMS`` terms, unit length."""
    df: dict[str, int] = defaultdict(int)
    for c in counts:
        for w in c:
            df[w] += 1
    n = len(counts)
    out = []
    for c in counts:
        v = {w: (1 + math.log(tf)) * math.log(1 + n / df[w]) for w, tf in c.items() if tf > 0}
        top = sorted(v.items(), key=lambda kv: (-kv[1], kv[0]))[:_TERMS]
        norm = math.sqrt(sum(x * x for _, x in top)) or 1.0
        out.append({w: x / norm for w, x in top})
    return out


def resolve(target: str, page_path: str, base: str, routes: set[str]) -> Optional[str]:
    """A front matter target as a page path in ``routes`` (with its ``#anchor``), or None.

    ``guides/setup``, ``/docs/guides/setup``, ``guides/setup.md`` and, from the
    page's own folder, ``./setup`` or ``../intro`` all name ``/docs/guides/setup``.
    """
    path, _, anchor = target.strip().partition("#")
    if path.startswith("."):
        path = posixpath.normpath(posixpath.join(posixpath.dirname(page_path), path))
    else:
        path = path.strip("/")
        if base.strip("/") and not path.startswith(base.strip("/") + "/"):
            path = f"{base.rstrip('/')}/{path}"
        path = "/" + path.lstrip("/")
    for suffix in (".mdx", ".md"):
        path = path.removesuffix(suffix)
    for candidate in (path, path.removesuffix("/index"), path.removesuffix("/README"), f"{path}/index"):
        if candidate in routes:
            return candidate + (f"#{anchor}" if anchor else "")
    return None


def _manual(value: list, page_path: str, base: str, routes: set[str]) -> list:
    """``related: [...]`` as docs-nav entries; targets that are no page are left out (7013 reports them)."""
    out: list = []
    for raw in value:
        label = None
        if isinstance(raw, dict) and len(raw) == 1:
            label, raw = next(iter(raw.items()))
            label = str(label).strip()[:120] or None
        if not isinstance(raw, str) or not raw.strip():
            continue
        if _URL.match(raw.strip()):
            href = raw.strip()
            out.append({"title": label or re.sub(r"^https?://(www\.)?", "", href).rstrip("/"), "href": href})
            continue
        path = resolve(raw, page_path, base, routes)
        if path is None or path.split("#")[0] == page_path:
            continue
        out.append({"title": label, "path": path} if label else path)
    return out[:MAX_LIMIT]


def annotate(
    nav: dict,
    read: Callable[[str], Optional[str]],
    frontmatter: Callable[[str], dict],
    *,
    limit: int,
    base: str,
) -> dict[str, list]:
    """Set ``related`` on each page item of a docs-nav dict, in place; returns ``{path: related}``.

    ``read(path)``: the page's Markdown without front matter, or None (no source);
    ``frontmatter(path)``: its front matter.
    """
    from praisonaiui.compiler.nav_builder import nav_trails

    trails = nav_trails(nav)
    home = {f"{base.rstrip('/')}/index", base.rstrip("/") or "/"}
    items: list[dict] = []

    def walk(level: list[dict]) -> None:
        for item in level:
            if item.get("path"):
                items.append(item)
            walk(item.get("children") or [])

    walk(nav.get("items", []))
    routes = {i["path"] for i in items}
    titles = {i["path"]: i.get("pageTitle") or i.get("title", "") for i in items}
    docs: list[_Doc] = []
    counts: list[dict[str, float]] = []
    metas: dict[str, dict] = {}
    for item in items:
        path = item["path"]
        fm = metas[path] = frontmatter(path)
        body = read(path)
        if body is None:
            continue
        trail = trails.get(path, [])
        candidate = not (item.get("hidden") or item.get("noindex") or item.get("searchable") is False or path in home)
        entry = page_entry(path, titles[path], item.get("description", ""), body, {"keywords": keywords_of(fm.get("keywords"))})
        docs.append(_Doc(path, _crumb(trail[-1:]), _crumb(trail[:1]), candidate, {}))
        counts.append(_counts(entry))
    for doc, vector in zip(docs, _vectors(counts)):
        doc.vector = vector

    postings: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for i, doc in enumerate(docs):
        if doc.candidate:
            for w, x in doc.vector.items():
                postings[w].append((i, x))
    by_path = {d.path: i for i, d in enumerate(docs)}

    out: dict[str, list] = {}
    for item in items:
        path = item["path"]
        fm = metas.get(path, {})
        value = fm.get("related")
        if value is False or item.get("mode") in ("custom", "frame") or path in home:
            continue
        if isinstance(value, list):
            related = _manual(value, path, base, routes)
        elif limit and path in by_path:
            me = by_path[path]
            scores: dict[int, float] = defaultdict(float)
            for w, x in docs[me].vector.items():
                for j, y in postings.get(w, ()):
                    if j != me:
                        scores[j] += x * y
            doc = docs[me]
            for j in scores:
                if doc.group and docs[j].group == doc.group:
                    scores[j] *= _GROUP_BONUS
                elif doc.section and docs[j].section == doc.section:
                    scores[j] *= _SECTION_BONUS
            ranked = sorted((j for j, s in scores.items() if s >= _MIN_SCORE), key=lambda j: (-scores[j], j))
            related = [docs[j].path for j in ranked[:limit]]
        else:
            continue
        if related:
            item["related"] = related
            out[path] = related
    return out


def links(related: list, titles: dict[str, str]) -> list[tuple[str, str, bool]]:
    """``(title, path or href, external)`` for each entry of a page's ``related``."""
    out = []
    for r in related:
        if isinstance(r, str):
            out.append((titles.get(r.split("#")[0], r), r, False))
        elif r.get("href"):
            out.append((r["title"], r["href"], True))
        else:
            out.append((r["title"], r["path"], False))
    return out


def issues(pages, base: str, routes: set[str], shown: Callable[[Any], str], text_of: Callable[[Any], str]) -> list[ContentIssue]:
    """7013: a front matter ``related`` target that is no page of the site."""
    import difflib

    out: list[ContentIssue] = []
    for page in pages:
        value = page.frontmatter.get("related") if isinstance(page.frontmatter, dict) else None
        if not isinstance(value, list):  # false, or the wrong type (7001's)
            continue
        lines = text_of(page).splitlines()
        line = next((i + 1 for i, s in enumerate(lines) if re.match(r"related\s*:", s)), 2)
        own = f"{base.rstrip('/')}/{page.slug}".rstrip("/")
        for raw in value:
            target = next(iter(raw.values())) if isinstance(raw, dict) and len(raw) == 1 else raw
            if isinstance(target, str) and (_URL.match(target.strip()) or resolve(target, own, base, routes)):
                continue
            near = difflib.get_close_matches(f"{base.rstrip('/')}/{str(target).strip('/')}", sorted(routes), n=1)
            out.append(ContentIssue(7013, shown(page), line, f"related '{target}' is not a page of this site; it is left out",
                                    (f"Did you mean '{near[0].removeprefix(base.rstrip('/') + '/')}'? " if near else "")
                                    + "Name a page by its path under the docs folder, or an https:// URL"))
    return out
