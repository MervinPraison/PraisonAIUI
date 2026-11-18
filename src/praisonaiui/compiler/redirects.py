"""Redirects (``redirects:`` in aiui.yaml): the one matcher for the build,
the link check (links.py) and ``aiui serve`` (cli._static_site_app).

``source`` is a site path: ``:name`` matches one path segment and a final
``:name*`` the rest of the path, none included (``/beta/:slug*`` matches
``/beta`` and ``/beta/a/b``); ``destination`` reuses the names. The build
writes, for every rule whose source is not a published page:

* a stub page per exact source (meta refresh, canonical, ``location.replace``
  keeping the query and hash), so GitHub Pages and any static host redirect;
* ``_redirects`` for Netlify and Cloudflare Pages (real 301s there);
* the rules in ui-config.json: the docs app follows a wildcard rule on its
  page-not-found view (docs/DocsNotFound.tsx), and ``aiui serve`` answers
  every rule with a 301 (302 for ``permanent: false``).

The browser copy of :func:`match` is ``src/frontend/src/docs/redirects.ts``.
"""

from __future__ import annotations

import html
import re
from collections.abc import Callable, Iterable
from functools import lru_cache
from pathlib import Path
from typing import Any

from praisonaiui.utils import json_for_html

_PARAM = re.compile(r":([A-Za-z_]\w*)(\*)?")


def _norm(path: str) -> str:
    return "/" + path.strip().strip("/") if path.strip().strip("/") else "/"


def is_exact(source: str) -> bool:
    return not _PARAM.search(source)


@lru_cache(maxsize=512)
def pattern(source: str) -> re.Pattern[str]:
    """The regex a source matches (whole path, no trailing slash)."""
    src, out, pos = _norm(source), "", 0
    for m in _PARAM.finditer(src):
        literal = src[pos : m.start()]
        if m.group(2):  # the rest of the path, maybe nothing: the slash before it is optional
            out += re.escape(literal.rstrip("/")) + f"(?:/(?P<{m.group(1)}>.*))?"
        else:
            out += re.escape(literal) + f"(?P<{m.group(1)}>[^/]+)"
        pos = m.end()
    return re.compile(out + re.escape(src[pos:]))


def expand(destination: str, params: dict[str, str | None]) -> str:
    """``destination`` with ``:name`` / ``:name*`` filled in; an empty rest drops its slash."""
    out = _PARAM.sub(lambda m: params.get(m.group(1)) or "", destination)
    if out.startswith("/") and not out.startswith("//"):
        path, sep, rest = out.partition("?") if "?" in out else out.partition("#")
        out = (re.sub(r"/{2,}", "/", path).rstrip("/") or "/") + sep + rest
    return out


def match(rules: Iterable[Any], path: str) -> tuple[Any, str] | None:
    """The first rule matching ``path`` and its destination, or None. Rules
    are RedirectConfig models or ui-config dicts."""
    path = _norm(path)
    for rule in rules:
        source = rule["source"] if isinstance(rule, dict) else rule.source
        dest = rule["destination"] if isinstance(rule, dict) else rule.destination
        found = pattern(source).fullmatch(path)
        if found:
            return rule, expand(dest, found.groupdict())
    return None


def is_internal(url: str) -> bool:
    return url.startswith("/") and not url.startswith("//")


def active_rules(rules: Iterable[Any], pages: set[str]) -> list[Any]:
    """The rules a build publishes: a published page at an exact source wins
    over its rule (``aiui validate`` warns, 7011)."""
    return [r for r in rules if not (is_exact(r.source) and _norm(r.source) in pages)]


def netlify_lines(rules: Iterable[Any], base: str) -> list[str]:
    """``_redirects`` lines: ``:name*`` is ``*`` / ``:splat`` there."""
    lines = []
    for r in rules:
        src = base + _PARAM.sub(lambda m: "*" if m.group(2) else m.group(0), _norm(r.source))
        dest = _PARAM.sub(lambda m: ":splat" if m.group(2) else m.group(0), r.destination)
        dest = base + dest if is_internal(dest) else dest
        lines.append(f"{src} {dest} {301 if r.permanent else 302}")
    return lines


def stub_html(href: str, canonical: str) -> str:
    """A page that sends readers (meta refresh, script) and crawlers (canonical) to ``href``."""
    url, link = html.escape(href, quote=True), html.escape(canonical, quote=True)
    target = json_for_html(href)
    keep = "" if "?" in href else "+location.search"
    keep += "" if "#" in href else "+location.hash"
    return (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
        f'<title>Redirecting to {url}</title>\n<meta name="robots" content="noindex">\n'
        f'<link rel="canonical" href="{link}">\n<meta http-equiv="refresh" content="0; url={url}">\n'
        f"<script>location.replace({target}{keep})</script>\n"
        f'</head><body><p>This page moved to <a href="{url}">{url}</a>.</p></body></html>\n'
    )


def write_redirects(
    output_dir: Path, rules: list[Any], base: str, canonical: Callable[[str], str]
) -> list[str]:
    """Stub pages for the exact rules and ``_redirects``; returns the files written."""
    if not rules:
        return []
    root, files = output_dir.resolve(), []
    for r in rules:
        source = _norm(r.source)
        if not is_exact(source) or source == "/":
            continue
        dest = r.destination
        href, canon = (base + dest, canonical(dest)) if is_internal(dest) else (dest, dest)
        rel = source.lstrip("/")
        targets = [rel] if "." in rel.rsplit("/", 1)[-1] else [f"{rel}.html", f"{rel}/index.html"]
        for name in targets:
            file = output_dir / name
            if file.exists() or not file.resolve().is_relative_to(root):
                continue  # never over a real file, never outside the build
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(stub_html(href, canon), encoding="utf-8")
            files.append(name)
    (output_dir / "_redirects").write_text("\n".join(netlify_lines(rules, base)) + "\n", encoding="utf-8")
    return [*files, "_redirects"]


def redirect_issues(rules: list[Any], pages: set[str], docs_base: str, config_file: str) -> list:
    """``aiui validate`` findings for exact rules: one that loops or ends at
    no docs page (7010), one hidden by a published page at its source (7011)."""
    from praisonaiui.compiler.content_lint import ContentIssue

    docs = _norm(docs_base)
    issues = []
    for r in rules:
        source = _norm(r.source)
        if not is_exact(source):
            continue
        if source in pages:
            issues.append(ContentIssue(7011, config_file, 1, f"redirect {r.source}: a page is published there, so the redirect never runs", "Delete the page or the redirect"))
            continue
        seen, dest = {source}, r.destination
        while is_internal(dest):
            here = _norm(re.split(r"[?#]", dest, maxsplit=1)[0])
            if here in pages or "." in here.rsplit("/", 1)[-1]:
                break
            if here in seen:
                issues.append(ContentIssue(7010, config_file, 1, f"redirect {r.source} loops back to {here}", "Point it at the page's new URL"))
                break
            seen.add(here)
            nxt = match(rules, here)
            if nxt is None:
                if docs == "/" or here == docs or here.startswith(docs + "/"):
                    issues.append(ContentIssue(7010, config_file, 1, f"redirect {r.source} leads to {here}, which is not a docs page", "Point it at a page that exists"))
                break
            dest = nxt[1]
    return issues
