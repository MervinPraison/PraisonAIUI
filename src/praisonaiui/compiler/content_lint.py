"""Content checks for ``aiui validate``: codes 7000-7006 and 7101 (listed in docs/api/cli.md).

Each issue names the page and line and says how to fix it. Missing images and
broken links are ``links.py``'s (6001); unknown component tags ``docs_tags.py``'s.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from praisonaiui.compiler.docs_scanner import DocPage
from praisonaiui.compiler.docs_tags import strip_comments
from praisonaiui.compiler.links import _ATX, _CODE_SPAN, _outside_code
from praisonaiui.compiler.nav_builder import sidebar_title


@dataclass(frozen=True)
class ContentIssue:
    """One finding: ``file:line: message`` and a fix ``hint``."""

    code: int
    file: str
    line: int
    message: str
    hint: str = ""


_STR, _NUM, _BOOL, _DATE = "a string", "a number", "true or false", "a date (YYYY-MM-DD)"
#: Front matter keys the build reads, and the type each needs.
FRONTMATTER_TYPES: dict[str, str] = {
    "title": _STR, "nav_title": _STR, "description": _STR, "icon": _STR, "layout": _STR,
    "sidebarTitle": _STR, "tag": _STR, "mode": _STR, "url": _STR,
    "order": _NUM, "boost": _NUM,
    "hidden": _BOOL, "noindex": _BOOL, "searchable": _BOOL,
    "deprecated": _BOOL, "hideFooterPagination": _BOOL, "noAnchor": _BOOL, "timestamp": _BOOL,
    "lastUpdatedDate": _DATE,
    "keywords": "a list of words (or one comma-separated string)",
}

_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(")
_IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
_ALT_ATTR = re.compile(r"\balt\s*=", re.I)


def _type_ok(kind: str, value: Any) -> bool:
    if value is None:
        return True
    if kind == _STR:
        return isinstance(value, str)
    if kind == _NUM:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if kind == _BOOL:
        return isinstance(value, bool)
    if kind == _DATE:
        return hasattr(value, "isoformat") or bool(isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}", value))
    return isinstance(value, str) or (isinstance(value, list) and all(isinstance(v, str) for v in value))


def _split_frontmatter(text: str) -> tuple[str | None, int]:
    """The raw front matter (from just after the opening ``---``) and the body's first line."""
    if not text.startswith("---"):
        return None, 1
    end = text.find("---", 3)
    if end == -1:
        return None, 1
    return text[3:end], text[: end + 3].count("\n") + 2


def check_frontmatter(text: str, shown: str) -> list[ContentIssue]:
    """7000 and 7001 for one page."""
    import yaml

    raw, _ = _split_frontmatter(text)
    if raw is None:
        return []
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        line = mark.line + 1 if mark else 1
        return [ContentIssue(7000, shown, line, f"front matter is not valid YAML ({getattr(exc, 'problem', exc)}); "
                             "the page is built without its title and settings",
                             "Quote values that contain ': ' or start with a special character")]
    if data is None:
        return []
    if not isinstance(data, dict):
        return [ContentIssue(7001, shown, 2, "front matter must be 'key: value' lines",
                             "Write each setting as key: value")]
    lines = raw.splitlines()
    out = []
    for key, kind in FRONTMATTER_TYPES.items():
        if key in data and not _type_ok(kind, data[key]):
            line = next((i + 1 for i, s in enumerate(lines) if re.match(rf"{re.escape(key)}\s*:", s)), 2)
            value = data[key]
            out.append(ContentIssue(7001, shown, line,
                                    f"front matter '{key}' should be {kind}, not {type(value).__name__} {value!r}",
                                    _type_hint(key, kind, value)))
    return out


def _type_hint(key: str, kind: str, value: Any) -> str:
    if kind == _STR:
        return f'Quote it: {key}: "{value}"'
    if kind == _BOOL:
        return f"Write {key}: true or {key}: false, without quotes"
    if kind == _DATE:
        return f"Write {key}: 2026-05-01"
    if kind == _NUM:
        try:
            return f"Write {key}: {float(value):g} without quotes"
        except (TypeError, ValueError):
            return f"Write {key}: and a number, such as {key}: 1"
    return f"Write {key}: [install, setup] (words only)"


def check_body(text: str, shown: str, frontmatter: dict, listed: bool = False) -> list[ContentIssue]:
    """7002 (alt text), 7005 (heading levels) and 7006 (empty page, unless the build ``listed`` its group on it)."""
    _, first = _split_frontmatter(text)
    lines = strip_comments(text).splitlines()[first - 1:]
    out: list[ContentIssue] = []
    level, has_text = 1, False  # the page title is the h1
    for n, (line, in_code) in enumerate(_outside_code(lines), start=first):
        if in_code:
            has_text = has_text or bool(line.strip())
            continue
        prose = _CODE_SPAN.sub("", line)
        heading = _ATX.match(prose)
        if heading:
            depth = len(heading.group(1))
            if depth > level + 1:
                out.append(ContentIssue(7005, shown, n, f"heading jumps from h{level} to h{depth}",
                                        f"Use {'#' * (level + 1)} here; screen readers navigate by heading level"))
            level = depth
            continue
        has_text = has_text or bool(prose.strip())
        for alt in _MD_IMAGE.findall(prose):
            if not alt.strip():
                out.append(ContentIssue(7002, shown, n, "image has no alt text",
                                        "Describe the image: ![What it shows](path.png)"))
        for tag in _IMG_TAG.findall(prose):
            if not _ALT_ATTR.search(tag):
                out.append(ContentIssue(7002, shown, n, "<img> has no alt attribute",
                                        'Add alt="what it shows" (alt="" marks a decorative image)'))
    home = any(k in frontmatter for k in ("hero", "features", "layout", "url"))  # url: a sidebar link
    if not has_text and not home and not listed:
        out.append(ContentIssue(7006, shown, first, "page has no content beyond its headings",
                                "Write the page, or add it to content.docs.exclude until it is ready"))
    return out


def check_pages(pages: list[DocPage], root: Path, listed: frozenset = frozenset()) -> list[ContentIssue]:
    """Every content check for the scanned docs pages, in page order; ``listed``: slugs given a directory listing."""

    def shown(page: DocPage) -> str:
        try:
            return page.path.relative_to(root).as_posix()
        except ValueError:
            return page.path.as_posix()

    out: list[ContentIssue] = []
    for page in pages:
        text = page.path.read_text(encoding="utf-8")
        out += check_frontmatter(text, shown(page))
        fm = page.frontmatter if isinstance(page.frontmatter, dict) else {}
        out += check_body(text, shown(page), fm, page.slug in listed)

    by_slug: dict[str, list[DocPage]] = defaultdict(list)
    by_title: dict[tuple, list[DocPage]] = defaultdict(list)
    for page in pages:
        by_slug[page.slug].append(page)
        if not page.hidden:
            label = sidebar_title(page).strip().lower()
            by_title[(page.path.parent, label)].append(page)
    for slug, same in by_slug.items():
        for page in same[1:]:
            out.append(ContentIssue(7003, shown(page), 1,
                                    f"publishes the same page '{slug}' as {shown(same[0])}; only one is shown",
                                    "Rename or remove one of the files"))
    for (_, _label), same in by_title.items():
        if len({p.slug for p in same}) > 1:
            for page in same[1:]:
                out.append(ContentIssue(7004, shown(page), 1,
                                        f"sidebar title '{page.title}' is also used by {shown(same[0])} in the same group",
                                        "Give one page a different title or nav_title"))
    return out


# The page backgrounds of the light and dark themes (themes.PRO_NEUTRALS).
_BACKGROUNDS = {"light": ("#ffffff", "#18181b"), "dark": ("#0e0e11", "#ededf0")}
_AA_NON_TEXT = 3.0


def accent_contrast(accent: str | None) -> list[ContentIssue]:
    """7101: a hex ``site.theme.accent`` under 3:1 on the light or dark background.

    WCAG 2 AA (1.4.11) asks 3:1 for buttons, focus rings and other UI parts
    drawn in the accent. Link text is derived from the accent to reach 4.5:1,
    so it is not checked here. Non-hex colours cannot be measured and pass.
    """
    from praisonaiui.themes import _HEX_COLOR, _reach, wcag_contrast

    if not accent or not _HEX_COLOR.match(accent.strip()):
        return []
    color = accent.strip()
    out = []
    for mode, (bg, ink) in _BACKGROUNDS.items():
        ratio = wcag_contrast(color, bg)
        if ratio < _AA_NON_TEXT:
            better = _reach(color, ink, [bg], _AA_NON_TEXT + 0.1)
            out.append(ContentIssue(7101, "site.theme.accent", 0,
                                    f"accent {color} has {ratio:.1f}:1 contrast on the {mode} background "
                                    f"({bg}); WCAG AA needs 3:1 for buttons and focus rings",
                                    f"Try {better}, a shade that reaches 3:1 in {mode} mode"))
    return out
