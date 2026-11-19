"""Docs versions: ``navigation.versions`` (docs/features/navigation.md#versions).

The default version is served at the docs root; every other one from its folder
(``docs/v1/guide.md`` at ``/docs/v1/guide``). A page belongs to the version whose
folder holds it. The browser mirror is ``src/frontend/src/docs/versions.ts``.
"""

from __future__ import annotations

import re
from collections import Counter

from praisonaiui.compiler.content_lint import ContentIssue


def folder(version) -> str:
    """The folder (and URL segment) of a version: ``v1``, ``2.x``."""
    return re.sub(r"[^a-z0-9._-]+", "-", version.version.strip().lower()).strip("-.") or "version"


def resolved(navigation) -> list[tuple[object, str]]:
    """``(version, folder)`` pairs; the default version (the first ``default: true``, else the first) has folder ``""``."""
    versions = list(navigation.versions) if navigation else []
    if not versions:
        return []
    default = next((v for v in versions if v.default), versions[0])
    return [(v, "" if v is default else folder(v)) for v in versions]


def prefix(sub: str, base: str) -> str:
    """The URL prefix of a version's pages (the docs base for the default)."""
    base = base.rstrip("/")
    return f"{base}/{sub}" if sub else base


def version_of(path: str, versions: list[tuple[object, str]], base: str) -> tuple[object, str] | None:
    """The version a page path belongs to: the longest folder prefix, else the default."""
    best = None
    for v, sub in versions:
        p = prefix(sub, base)
        if sub and (path == p or path.startswith(p + "/")) and (best is None or len(sub) > len(best[1])):
            best = (v, sub)
    return best or next((pair for pair in versions if not pair[1]), None)


def indexed(version, sub: str) -> bool:
    """Whether a version's pages go into the sitemap and llms.txt (``index``; default: the default version only)."""
    return version.index if version.index is not None else not sub


def apply(nav: dict, navigation, base: str) -> set[str]:
    """Point each older-version page's canonical at the default version's same page (when there is one)
    and mark the pages of unindexed versions ``robots: noindex``; returns those pages' paths
    (kept out of the sitemap and llms.txt, but still in the site search)."""
    versions = resolved(navigation)
    if not versions:
        return set()
    items: dict[str, dict] = {}

    def walk(entries: list[dict]) -> None:
        for item in entries:
            if item.get("path"):
                items.setdefault(item["path"], item)
            walk(item.get("children") or [])

    walk(nav.get("items", []))
    quiet: set[str] = set()
    for path, item in items.items():
        pair = version_of(path, versions, base)
        if not pair or not pair[1]:
            continue
        rest = path[len(prefix(pair[1], base)):]
        seo = item.get("seo") or {}
        counterpart = prefix("", base) + rest
        if rest and counterpart in items and "canonical" not in seo:
            seo["canonical"] = counterpart
        if not indexed(*pair):
            seo.setdefault("robots", "noindex")
            quiet.add(path)
        if seo:
            item["seo"] = seo
    return quiet


def issues(navigation, base: str) -> list[ContentIssue]:
    """7018: two versions with one name, more than one default, or a page listed under a version
    whose folder does not hold it."""
    versions = resolved(navigation)
    out: list[ContentIssue] = []
    hint = "Give each version its own name and folder; mark one version `default: true`"
    for name, n in Counter(folder(v) for v, _ in versions).items():
        if n > 1:
            out.append(ContentIssue(7018, "navigation", 0, f"{n} versions use the folder '{name}'", hint))
    if sum(bool(v.default) for v, _ in versions) > 1:
        out.append(ContentIssue(7018, "navigation", 0, "more than one version is marked default: true", hint))
    docs = base.strip("/")
    for v, sub in versions:
        groups = [*v.sidebar_groups(), *(g for t in v.tabs for g in t.sidebar_groups())]
        for slug in (s for g in groups for s in g.page_slugs()):
            name = slug.strip().strip("/").removesuffix(".md")
            name = name[len(docs) + 1:] if docs and name.startswith(docs + "/") else name
            owner = version_of(prefix("", base) + "/" + name, versions, base)
            if owner and owner[0] is not v:
                where = f"docs/{sub}/" if sub else "outside the other versions' folders"
                out.append(ContentIssue(7018, "navigation", 0,
                                        f"version '{v.version}' lists '{slug}', a page of version '{owner[0].version}'",
                                        f"Keep version '{v.version}' pages {where}"))
    return out
