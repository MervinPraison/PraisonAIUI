"""Broken link check for docs sites (``aiui docs check-links``).

Checks Markdown links, images and reference links, ``href`` / ``src`` on
components and HTML (``<Card href>``), docs home frontmatter links, and the
YAML nav entries, tab, navbar and footer links. ``#anchor``s are checked
against the renderer's heading ids (``search_index.slugify``). Targets resolve
like ``src/frontend/src/docs/docSource.ts``; redirect sources
(``redirect_sources``) count as valid. External URLs only when asked.
"""

from __future__ import annotations

import difflib
import html
import posixpath
import re
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote

from praisonaiui.compiler.docs_home import docs_home_from_frontmatter
from praisonaiui.compiler.docs_scanner import DocPage, DocsScanner
from praisonaiui.compiler.search_index import inline_text, slugify

if TYPE_CHECKING:
    from praisonaiui.schema.models import Config

_FRONTMATTER = re.compile(r"^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)")
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
_CODE_SPAN = re.compile(r"`+[^`]*`+")
_COMMENT = re.compile(r"<!--.*?-->")
_ATX = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$")
_SETEXT = re.compile(r"^ {0,3}(=+|-+)[ \t]*$")
_BLOCK_START = re.compile(r"^\s*(?:[-*+>|]|\d+[.)]|#|<)")
_INLINE = re.compile(r"\]\(\s*(<[^>]*>|[^)\s]+)")
_REFERENCE = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)")
_AUTOLINK = re.compile(r"<(https?://[^\s>]+)>", re.I)
_ATTR = re.compile(r"""\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']([^"']*)["']\s*\})""")
_HTML_ID = re.compile(r"""\b(?:id|name)\s*=\s*["']([^"']+)["']""")
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)
_HTTP = re.compile(r"^(?:https?:)?//", re.I)


@dataclass(frozen=True)
class BrokenLink:
    """One link that leads nowhere."""

    file: str
    line: int
    target: str
    reason: str
    suggestion: str = ""


@dataclass
class LinkReport:
    """The result of a link check."""

    broken: list[BrokenLink] = field(default_factory=list)
    checked: int = 0
    pages: int = 0

    @property
    def ok(self) -> bool:
        return not self.broken


@dataclass
class _Page:
    page: DocPage
    url: str  # file-named URL: /docs/guide/index, the base links resolve against
    ids: set[str] = field(default_factory=set)
    links: list[tuple[int, str]] = field(default_factory=list)


def page_route(path: str) -> str:
    """``docSource.ts`` pageRoute: the route a ``.md`` path is served at."""
    if not path.lower().endswith(".md"):
        return path
    route = re.sub(r"\.md$", "", path, flags=re.I)
    route = re.sub(r"/(?:index|readme)$", "", route, flags=re.I)
    return re.sub(r"(^|/)\d+-", r"\1", route) or "/"


def heading_ids(lines: list[str]) -> set[str]:
    """Ids the docs renderer gives (h1-h4 ``slugify(text)``) plus raw HTML ids."""
    ids: set[str] = set()
    for i, (line, in_code) in enumerate(_outside_code(lines)):
        if in_code:
            continue
        ids.update(_HTML_ID.findall(line))
        text = None
        m = _ATX.match(line)
        if m and len(m.group(1)) <= 4:
            text = m.group(2) or ""
        elif _SETEXT.match(line) and i > 0:
            prev = lines[i - 1]
            if prev.strip() and not _BLOCK_START.match(prev) and not _SETEXT.match(prev):
                text = prev.strip()
        if text is not None:
            ids.add(slugify(html.unescape(inline_text(_IMAGE.sub("", text)))))
    ids.discard("")
    return ids


def _outside_code(lines: list[str]) -> Iterable[tuple[str, bool]]:
    """Each line with whether it sits in fenced code or an HTML comment."""
    fence: str | None = None
    comment = False
    for line in lines:
        m = _FENCE.match(line)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and line.strip() == m.group(1):
                fence = None
            yield line, True
            continue
        if comment:
            comment = "-->" not in line
            yield line, True
            continue
        if m:
            fence = m.group(1)
            yield line, True
            continue
        line = _COMMENT.sub("", line)
        if "<!--" in line:
            comment = True
            line = line.split("<!--", 1)[0]
        yield line, False


def link_targets(lines: list[str]) -> list[tuple[int, str]]:
    """``(line number, target)`` for every link and image outside code."""
    out: list[tuple[int, str]] = []
    for n, (line, in_code) in enumerate(_outside_code(lines), start=1):
        if in_code:
            continue
        line = _CODE_SPAN.sub("", line)
        ref = _REFERENCE.match(line)
        found = [ref.group(1)] if ref else _INLINE.findall(line)
        found += _AUTOLINK.findall(line)
        if "<" in line:
            found += [a or b or c for a, b, c in _ATTR.findall(line)]
        out.extend((n, t) for t in found)
    return out


class _Checker:
    def __init__(self, docs_dir: Path, pages: list[DocPage], base: str, redirects: Iterable[str], root: Path):
        self.docs_dir = docs_dir
        self.base = "/" + base.strip("/") if base.strip("/") else ""
        self.root = root
        self.routes: dict[str, _Page] = {}
        self.pages: list[_Page] = []
        for page in pages:
            rel = page.path.relative_to(docs_dir).with_suffix("").as_posix()
            text = page.path.read_text(encoding="utf-8")
            entry = _Page(page, f"{self.base}/{rel}")
            fm = _FRONTMATTER.match(text)
            body_start = fm.group(0).count("\n") if fm else 0
            lines = text.splitlines()
            entry.ids = heading_ids(lines[body_start:])
            entry.links = [(n + body_start, t) for n, t in link_targets(lines[body_start:])]
            entry.links += self._frontmatter_links(page.frontmatter, lines[:body_start])
            self.pages.append(entry)
            self.routes.setdefault(f"{self.base}/{page.slug}", entry)
        for entry in self.pages:  # file-named URLs (/docs/adr/0001-x) reach the page too
            self.routes.setdefault(entry.url, entry)
        home = self.routes.get(f"{self.base}/index")
        if home:
            self.routes.setdefault("/", home)
            self.routes.setdefault(self.base or "/", home)
        self.redirects = {_norm(r) for r in redirects if isinstance(r, str) and r.strip()}
        self.files = sorted(
            f"{self.base}/{p.relative_to(docs_dir).as_posix()}"
            for p in docs_dir.rglob("*")
            if p.is_file() and p.suffix.lower() not in (".md", ".mdx")
        )
        self.report = LinkReport(pages=len(self.pages))
        self.external: dict[str, list[tuple[str, int]]] = {}

    @staticmethod
    def _frontmatter_links(fm: dict, lines: list[str]) -> list[tuple[int, str]]:
        home = docs_home_from_frontmatter(fm) or {}
        hero = home.get("hero", {})
        found = [a["link"] for a in hero.get("actions", [])]
        found += [hero[k] for k in ("image", "imageDark") if k in hero]
        found += [f["link"] for f in home.get("features", []) if "link" in f]
        return [(next((i for i, ln in enumerate(lines, 1) if t in ln), 1), t) for t in found]

    def display(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.root.resolve()).as_posix()
        except ValueError:
            return str(path)

    def run(self) -> None:
        for entry in self.pages:
            for line, target in entry.links:
                self.check(target, entry.url, self.display(entry.page.path), line, entry)

    def check(self, raw: str, from_url: str, file: str, line: int, src: _Page | None = None) -> None:
        target = raw.strip()
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1].strip()
        if not target or "{{" in target or "{%" in target:
            return
        self.report.checked += 1
        if _HTTP.match(target):
            self.external.setdefault(target, []).append((file, line))
            return
        if _SCHEME.match(target):
            return  # mailto:, tel:, ...
        path, _, frag = target.partition("#")
        path = unquote(path.split("?", 1)[0])
        if not path:
            if src is not None:
                self._anchor(src, frag, raw, file, line)
            return
        if path.startswith("/"):
            url = posixpath.normpath(path)
        else:
            url = posixpath.normpath(posixpath.dirname(from_url) + "/" + path)
        url = "/" + url.lstrip("/")
        is_md = url.lower().endswith(".md")
        route = _norm(page_route(url))
        entry = self.routes.get(route)
        if entry is None and not is_md and self.base and not route.startswith(self.base + "/"):
            entry = self.routes.get(self.base + route)  # the app finds /x as /docs/x
            if entry is None:
                return  # outside the docs (an app route): not ours to judge
        if entry is not None:
            self._anchor(entry, frag, raw, file, line)
        elif route in self.redirects or url == "/":
            return
        elif not is_md and (self.docs_dir / route[len(self.base) + 1 :]).is_file():
            return
        else:
            kind = "file" if "." in route.rsplit("/", 1)[-1] and not is_md else "page"
            hint = self._suggest(route, kind, path, from_url, is_md)
            self._broken(file, line, raw, f"{kind} not found", hint)

    def _anchor(self, entry: _Page, frag: str, raw: str, file: str, line: int) -> None:
        frag = unquote(frag)
        if frag and frag not in entry.ids:
            close = difflib.get_close_matches(frag, sorted(entry.ids), n=1, cutoff=0.6)
            where = f" on {entry.url}" if not raw.strip().startswith("#") else ""
            self._broken(file, line, raw, f"anchor #{frag} not found{where}", f"#{close[0]}" if close else "")

    def _suggest(self, route: str, kind: str, path: str, from_url: str, is_md: bool) -> str:
        pool = self.files if kind == "file" else sorted({f"{self.base}/{e.page.slug}" for e in self.pages})
        close = difflib.get_close_matches(route, pool, n=1, cutoff=0.6)
        if not close:
            return ""
        best = close[0]
        if path.startswith("/"):
            return best
        if kind == "page":
            entry = self.routes[best]
            best = entry.url + entry.page.path.suffix if is_md else best
        return posixpath.relpath(best, posixpath.dirname(from_url))

    def _broken(self, file: str, line: int, target: str, reason: str, suggestion: str = "") -> None:
        self.report.broken.append(BrokenLink(file, line, target, reason, suggestion))

    def check_external(self, timeout: float, workers: int = 16) -> None:
        urls = sorted(self.external)
        with ThreadPoolExecutor(max_workers=max(1, min(workers, len(urls) or 1))) as pool:
            results = pool.map(lambda u: probe_url(u, timeout), urls)
            for url, reason in zip(urls, results):
                if reason:
                    for file, line in self.external[url]:
                        self._broken(file, line, url, reason)


def _norm(path: str) -> str:
    path = "/" + path.strip().lstrip("/")
    return path.rstrip("/") or "/"


def probe_url(url: str, timeout: float = 10.0) -> str | None:
    """Why an external URL is broken, or None when it answers (HEAD, then GET)."""
    import urllib.error
    import urllib.request

    url = url.split("#", 1)[0]
    if url.startswith("//"):
        url = "https:" + url
    reason = ""
    for method in ("HEAD", "GET"):
        request = urllib.request.Request(url, method=method, headers={"User-Agent": "aiui-link-check"})
        try:
            with urllib.request.urlopen(request, timeout=timeout):  # noqa: S310 - http(s) only
                return None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                return None  # rate limited, not missing
            reason = f"HTTP {e.code}"
        except (urllib.error.URLError, OSError, ValueError) as e:
            return f"unreachable ({getattr(e, 'reason', e)})"
    return reason


def check_links(
    docs_dir: Path,
    *,
    route_base: str = "/docs",
    include: list[str] | None = None,
    exclude: list[str] | None = None,
    index_files: list[str] | None = None,
    redirects: Iterable[str] = (),
    external: bool = False,
    timeout: float = 10.0,
    root: Path | None = None,
) -> LinkReport:
    """Check every link and image in a docs folder; file names are shown relative to ``root``."""
    checker = _docs_checker(docs_dir, route_base, include, exclude, index_files, redirects, root)
    checker.run()
    if external:
        checker.check_external(timeout)
    return checker.report


def _docs_checker(docs_dir, route_base, include, exclude, index_files, redirects, root) -> _Checker:
    pages = DocsScanner(docs_dir, include=include, exclude=exclude, index_files=index_files).scan()
    return _Checker(docs_dir, pages, route_base, redirects, root or docs_dir.parent)


def redirect_sources(cfg: Config) -> list[str]:
    """Redirect source paths in the config (``redirects:`` at the top level or
    under ``content.docs``, entries with ``source`` or ``from``); each counts
    as a valid link target. Empty until the config has redirects."""
    out: list[str] = []
    docs = cfg.content.docs if cfg.content else None
    for holder in (cfg, docs):
        for entry in getattr(holder, "redirects", None) or []:
            get = entry.get if isinstance(entry, dict) else lambda k, e=entry: getattr(e, k, None)
            source = get("source") or get("from")
            if isinstance(source, str):
                out.append(source)
    return out


def check_site_links(cfg: Config, config_path: Path, *, external: bool = False, timeout: float = 10.0) -> LinkReport:
    """Check the docs pages and the links in the YAML of a site config."""
    root = config_path.parent
    docs = cfg.content.docs if cfg.content else None
    if docs is None:
        return LinkReport()
    checker = _docs_checker(
        root / docs.dir, cfg.site.route_base_docs, docs.include, docs.exclude, docs.index_files,
        redirect_sources(cfg), root,
    )
    checker.run()
    yaml_lines = config_path.read_text(encoding="utf-8").splitlines() if config_path.is_file() else []
    file = checker.display(config_path)

    def line_of(value: str) -> int:
        return next((i for i, ln in enumerate(yaml_lines, 1) if value in ln), 1)

    names: dict[str, DocPage] = {}
    for entry in checker.pages:
        names.setdefault(entry.page.slug, entry.page)
        names.setdefault(entry.url[len(checker.base) + 1 :], entry.page)

    def nav_entry(name: str) -> None:
        checker.report.checked += 1
        key = name.strip().strip("/")
        key = key[:-3] if key.endswith(".md") else key
        prefix = checker.base.strip("/")
        if prefix and key.startswith(prefix + "/"):
            key = key[len(prefix) + 1 :]
        if key not in names:
            close = difflib.get_close_matches(key, sorted(names), n=1, cutoff=0.6)
            checker._broken(file, line_of(name), name, "nav page not found", close[0] if close else "")

    def walk(group: Any) -> None:
        for entry in group.pages:
            if isinstance(entry, str):
                nav_entry(entry)
            elif hasattr(entry, "group"):  # a nested group; a `{label, href}` link names no page
                walk(entry)

    links: list[str] = []
    for tab in cfg.navigation.tabs if cfg.navigation else []:
        links += [tab.url] if tab.url else []
        for group in tab.groups:
            walk(group)
    if cfg.navbar:
        links += [cfg.navbar.primary.href] if cfg.navbar.primary else []
        links += [link.href for link in cfg.navbar.links]
    if cfg.footer:
        links += [item.href for column in cfg.footer.links for item in column.items]
    for href in links:
        if href.startswith("/") or _HTTP.match(href):  # site paths and URLs; others are app-relative
            checker.check(href, "/", file, line_of(href))
    if external:
        checker.check_external(timeout)
    return checker.report


def format_broken(link: BrokenLink) -> str:
    """``file:line: target: reason (did you mean X?)``."""
    hint = f" (did you mean {link.suggestion}?)" if link.suggestion else ""
    return f"{link.file}:{link.line}: {link.target}: {link.reason}{hint}"

