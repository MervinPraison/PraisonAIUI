"""What ``aiui build`` publishes, and what it tells crawlers.

- Exclude: ``content.docs.exclude`` plus an optional ``.aiuiignore`` next to
  the config (``is_excluded``). Excluded files are never copied to the output.
- Visibility: a page is ``hidden`` (frontmatter ``hidden: true``, a hidden
  nav group or tab, or a page no manual nav group lists) or ``noindex``.
  ``apply_indexing`` folds both into one ``noindex`` flag on the nav item, the
  single test the sitemap, ``llms*.txt``, site search and the robots meta use.
- Robots: one ``<meta name="robots">`` per page (``robots_content``), and the
  optional ``Content-Signal`` line in robots.txt.
"""

from __future__ import annotations

import re
from fnmatch import fnmatch
from pathlib import Path

#: Gitignore-style file next to ``aiui.yaml``; its patterns join ``content.docs.exclude``.
IGNORE_FILE = ".aiuiignore"

#: The robots meta tag in the built ``index.html`` (one per page; replaced, never repeated).
_ROBOTS_META = re.compile(r'<meta\s+name="robots"[^>]*>')


def read_ignore_file(base_path: Path) -> list[str]:
    """Patterns from ``<base_path>/.aiuiignore``: one per line, ``#`` comments and blanks skipped."""
    path = base_path / IGNORE_FILE
    if not path.is_file():
        return []
    lines = (line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


def _matches(rel: str, pattern: str) -> bool:
    """Whether a pattern names ``rel`` (posix, relative to the docs folder) or a folder holding it.

    ``drafts/*``, ``drafts`` and ``drafts/`` all cover ``drafts/a/b.md``; a
    pattern without ``/`` (``*.tmp``, ``secret.md``) matches any path segment;
    a leading ``/`` anchors the pattern to the docs folder.
    """
    anchored = pattern.startswith("/")
    pat = pattern.strip("/")
    if not pat:
        return False
    parts = rel.split("/")
    if any(fnmatch("/".join(parts[:i]), pat) for i in range(1, len(parts) + 1)):
        return True
    return not anchored and "/" not in pat and any(fnmatch(part, pat) for part in parts)


def is_excluded(rel: str, patterns: list[str]) -> bool:
    """Whether ``rel`` is excluded: the last matching pattern wins and ``!pattern`` re-includes."""
    excluded = False
    for pattern in patterns:
        negate = pattern.startswith("!")
        if _matches(rel, pattern[1:] if negate else pattern):
            excluded = not negate
    return excluded


def _walk(items: list[dict]):
    for item in items:
        yield item
        yield from _walk(item.get("children") or [])


def apply_indexing(nav: dict, indexing: str = "navigable") -> None:
    """Mark hidden pages ``noindex`` unless ``seo.indexing`` is ``all``.

    After this, ``item["noindex"]`` alone decides whether a page goes into the
    sitemap, ``llms*.txt``, site search and gets ``<meta name="robots" content="noindex">``.
    """
    if indexing == "all":
        return
    for item in _walk(nav.get("items", [])):
        if item.get("hidden") and item.get("path"):
            item["noindex"] = True


def robots_content(noindex: bool, robots: dict | None) -> str:
    """The robots meta value: ``noindex`` alone for a noindex page (links still followed), else ``seo.robots``."""
    robots = robots or {}
    follow = "follow" if robots.get("follow", True) else "nofollow"
    if noindex or not robots.get("index", True):
        return "noindex" if follow == "follow" else "noindex, nofollow"
    return f"index, {follow}"


def set_robots_meta(html: str, content: str) -> str:
    """``html`` with exactly one robots meta tag carrying ``content``."""
    tag = f'<meta name="robots" content="{content}" />'
    if _ROBOTS_META.search(html):
        first = True

        def keep_first(_: re.Match[str]) -> str:
            nonlocal first
            out, first = (tag if first else ""), False
            return out

        return _ROBOTS_META.sub(keep_first, html)
    return html.replace("</head>", f"  {tag}\n</head>", 1)


def content_signal(signals: dict | None) -> str | None:
    """The robots.txt ``Content-Signal`` line from ``seo.contentSignals`` (None when unset)."""
    if not signals:
        return None
    names = {"search": "search", "ai_input": "ai-input", "ai_train": "ai-train"}
    parts = [
        f"{names[key]}={'yes' if value else 'no'}"
        for key, value in signals.items()
        if key in names and value is not None
    ]
    return f"Content-Signal: {', '.join(parts)}" if parts else None


def with_slash(url: str) -> str:
    """``url`` ending in ``/`` (``seo.trailingSlash``); query and fragment left as they are."""
    cut = min((i for i in (url.find("?"), url.find("#")) if i >= 0), default=len(url))
    head, tail = url[:cut], url[cut:]
    return url if head.endswith("/") else f"{head}/{tail}"
