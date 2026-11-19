"""Content checks for ``aiui validate``: codes 7000-7009, 7013, 7019 and 7101 (listed in docs/api/cli.md).

Each issue names the page and line and says how to fix it. Missing images and
broken links are ``links.py``'s (6001); unknown component tags ``docs_tags.py``'s;
variables and snippets (7007, 7008) ``snippets.py``'s; redirects (7010, 7011)
``redirects.py``'s; endpoint references (7012) ``openapi_pages.py``'s; related pages (7013) ``related.py``'s; versions (7018) ``versions.py``'s; languages (7020) ``languages.py``'s.
"""

from __future__ import annotations

import difflib
import json
import re
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from praisonaiui.compiler.csp import EMBEDS
from praisonaiui.compiler.docs_scanner import DocPage
from praisonaiui.compiler.docs_tags import _prose_segments, strip_comments
from praisonaiui.compiler.links import _ATX, _CODE_SPAN, _outside_code
from praisonaiui.compiler.nav_builder import icon_name, icon_value, sidebar_title
from praisonaiui.schema.models import PAGE_ACTIONS, page_action_list


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
    "sidebarTitle": _STR, "tag": _STR, "mode": _STR, "url": _STR, "canonical": _STR, "robots": _STR,
    "playground": _STR, "openapi": _STR, "api": _STR,
    "order": _NUM, "boost": _NUM,
    "hidden": _BOOL, "noindex": _BOOL, "searchable": _BOOL,
    "deprecated": _BOOL, "hideFooterPagination": _BOOL, "noAnchor": _BOOL, "timestamp": _BOOL, "rss": _BOOL,
    "public": _BOOL,
    "lastUpdatedDate": _DATE,
    "keywords": "a list of words (or one comma-separated string)",
    "related": "a list of pages or URLs, or false",
    "pageActions": "a list of page actions, or false",
    "groups": "a list of group names (or one name)",
}

_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(")
_IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
_ALT_ATTR = re.compile(r"\balt\s*=", re.I)
# `icon="…"` on a component tag (<Card icon="flag">, <Icon icon={"flag"} />).
_ICON_ATTR = re.compile(r"<[A-Z][\w.]*\s[^<>]*?\bicon=(?:\"([^\"]*)\"|'([^']*)'|\{[\"']([^\"']*)[\"']\})")


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
    if kind == FRONTMATTER_TYPES["related"]:
        return value is False or isinstance(value, list)
    if kind == FRONTMATTER_TYPES["pageActions"]:
        return page_action_list(value) is not None
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
    if key == "related":
        return "Write related: [guides/setup, https://example.com] or related: false"
    if key == "pageActions":
        return (f"Write pageActions: [copy, chatgpt] or pageActions: false; the actions are {', '.join(PAGE_ACTIONS)}, "
                "or {label, href} for a link of your own")
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


#: Raw HTML the docs renderer removes (its sanitizer keeps no such element), and what to use instead.
_REMOVED_HTML = {
    "script": "Load scripts with site.customJs",
    "style": "Add styles with site.customCss",
    "link": "Add stylesheets with site.customCss",
    "form": "Link to the form instead",
    "audio": "Link to the audio file instead",
    "object": "Link to the file instead",
    "embed": "Link to the file instead",
}
_RAW_HTML = re.compile(r"<(iframe|" + "|".join(_REMOVED_HTML) + r")(?=[\s/>])([^>]*)")
_IFRAME_SRC = re.compile(r"""\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']([^"']*)["']\s*\}|([^\s>]+))""")


def check_raw_html(text: str, shown: str) -> list[ContentIssue]:
    """7019: raw HTML a docs page shows differently than written. Only YouTube, Vimeo and
    Loom ``<iframe>`` players play in the page (docs/embeds.ts), any other becomes a link;
    ``<script>``, ``<style>``, ``<link>``, ``<form>``, ``<audio>``, ``<object>`` and
    ``<embed>`` are removed. Fenced code, ``<CodeBlock>`` and inline code are skipped."""
    _, first = _split_frontmatter(text)
    out: list[ContentIssue] = []
    line_no = 1
    for code, chunk in _prose_segments(strip_comments(text)):
        if not code:
            prose = "\n".join(_CODE_SPAN.sub(lambda m: " " * len(m.group(0)), ln) for ln in chunk.split("\n"))
            for m in _RAW_HTML.finditer(prose):
                n = line_no + prose.count("\n", 0, m.start())
                if n < first:
                    continue
                tag = m.group(1)
                if tag != "iframe":
                    out.append(ContentIssue(7019, shown, n, f"<{tag}> is removed: docs pages do not load raw <{tag}>",
                                            _REMOVED_HTML[tag]))
                    continue
                found = _IFRAME_SRC.search(m.group(2))
                src = next((g for g in found.groups() if g is not None), "") if found else ""
                if any(rx.search(src) for rx in EMBEDS):
                    continue
                if not src:
                    out.append(ContentIssue(7019, shown, n, "<iframe> has no src and is removed",
                                            "Give it a YouTube, Vimeo or Loom URL"))
                    continue
                host = urlsplit(src).hostname or src
                out.append(ContentIssue(7019, shown, n, f"<iframe> to {host} shows as a link, not an embedded frame",
                                        "Only YouTube, Vimeo and Loom videos play inside a page; "
                                        "write a link, or use an image of the content with a link"))
        line_no += chunk.count("\n")
    return out


def check_pages(pages: list[DocPage], root: Path, listed: frozenset = frozenset(),
                read: Callable[[Path], str] | None = None) -> list[ContentIssue]:
    """Every content check for the scanned docs pages, in page order; ``listed``: slugs given a directory listing;
    ``read``: the page text (``Compiler._page_text``: snippets expanded)."""

    def shown(page: DocPage) -> str:
        try:
            return page.path.relative_to(root).as_posix()
        except ValueError:
            return page.path.as_posix()

    out: list[ContentIssue] = []
    for page in pages:
        text = read(page.path) if read else page.path.read_text(encoding="utf-8")
        out += check_frontmatter(text, shown(page))
        fm = page.frontmatter if isinstance(page.frontmatter, dict) else {}
        out += check_body(text, shown(page), fm, page.slug in listed)
        out += check_icons(text, shown(page), fm)
        out += check_raw_html(text, shown(page))

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


@lru_cache(maxsize=4)
def _icon_names(path: Path) -> frozenset[str]:
    try:
        return frozenset(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return frozenset()


def lucide_icons() -> frozenset[str]:
    """Every lucide icon name the served frontend build draws (its ``aiui-icons.json``); empty without one."""
    from praisonaiui.compiler.compiler import Compiler

    return _icon_names(Compiler._frontend_dirs()[0] / "aiui-icons.json")


def icon_issue(value: object, file: str, line: int, where: str = "icon") -> list[ContentIssue]:
    """7009: an icon value that draws nothing (not a lucide name, an emoji or an image URL)."""
    known = lucide_icons()
    resolved = icon_value(value)
    if not known or not isinstance(value, str) or (resolved and not icon_name(resolved)) or resolved in known:
        return []  # no build to check against, a wrong type (7001's), an image URL or emoji, or an icon
    near = difflib.get_close_matches(resolved or value.strip().lower(), known, n=1)
    return [ContentIssue(7009, file, line, f"{where} '{value}' is not a lucide icon, an emoji or an image URL; it shows nothing",
                         (f"Did you mean '{near[0]}'? " if near else "") + "Names: https://lucide.dev/icons")]


def check_icons(text: str, shown: str, frontmatter: dict) -> list[ContentIssue]:
    """7009 for a page: its front matter ``icon`` and ``features[].icon``, and ``icon="…"`` on its components."""
    raw, first = _split_frontmatter(text)
    fm_lines = (raw or "").splitlines()

    def fm_line(value: str) -> int:
        return next((i + 1 for i, s in enumerate(fm_lines) if re.search(rf"\bicon\s*:\s*[\"']?{re.escape(value)}", s)), 2)

    out: list[ContentIssue] = []
    features = frontmatter.get("features") if isinstance(frontmatter.get("features"), list) else []
    for value in [frontmatter.get("icon"), *(f.get("icon") for f in features if isinstance(f, dict))]:
        if isinstance(value, str):
            out += icon_issue(value, shown, fm_line(value))
    lines = strip_comments(text).splitlines()[first - 1:]
    for n, (line, in_code) in enumerate(_outside_code(lines), start=first):
        if not in_code:
            for m in _ICON_ATTR.finditer(_CODE_SPAN.sub("", line)):
                out += icon_issue(next(g for g in m.groups() if g is not None), shown, n)
    return out


def nav_icons(entries) -> list[ContentIssue]:
    """7009 for ``icon:`` on the navigation's groups and links (``manual_entries``)."""
    out: list[ContentIssue] = []
    for e in entries or ():
        if getattr(e, "icon", None):
            label = getattr(e, "group", None) or getattr(e, "label", "")
            out += icon_issue(e.icon, "navigation", 0, f"icon of '{label}'")
        out += nav_icons(getattr(e, "pages", None)) if hasattr(e, "group") else []
    return out


# The page backgrounds of the light and dark themes (themes.PRO_NEUTRALS).
_BACKGROUNDS = {"light": ("#ffffff", "#18181b"), "dark": ("#0e0e11", "#ededf0")}
_AA_NON_TEXT = 3.0


def accent_contrast(accent: str | None, accent_dark: str | None = None) -> list[ContentIssue]:
    """7101: a hex ``site.theme.accent`` under 3:1 on the light or dark background
    (``accentDark``, when set, is the one checked on the dark background).

    WCAG 2 AA (1.4.11) asks 3:1 for buttons, focus rings and other UI parts
    drawn in the accent. Link text is derived from the accent to reach 4.5:1,
    so it is not checked here. Non-hex colours cannot be measured and pass.
    """
    from praisonaiui.themes import _HEX_COLOR, _reach, wcag_contrast

    out = []
    for mode, (bg, ink) in _BACKGROUNDS.items():
        key, color = ("accentDark", accent_dark) if mode == "dark" and accent and accent_dark else ("accent", accent)
        color = (color or "").strip()
        if not _HEX_COLOR.match(color):
            continue
        ratio = wcag_contrast(color, bg)
        if ratio < _AA_NON_TEXT:
            better = _reach(color, ink, [bg], _AA_NON_TEXT + 0.1)
            out.append(ContentIssue(7101, f"site.theme.{key}", 0,
                                    f"accent {color} has {ratio:.1f}:1 contrast on the {mode} background "
                                    f"({bg}); WCAG AA needs 3:1 for buttons and focus rings",
                                    f"Try {better}, a shade that reaches 3:1 in {mode} mode"))
    return out
