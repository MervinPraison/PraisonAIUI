"""The SEO head ``aiui build`` writes into each page (docs/features/seo.md).

Every tag comes from one map per page, built in this order (later wins):

1. the defaults (``Compiler._page_tags``: canonical, ``og:*``, ``twitter:*``, robots),
2. ``seo.metatags`` (every page),
3. ``seo.paths`` entries whose ``path`` holds the page (shorter paths first),
4. the page's frontmatter: ``canonical``, ``robots``, ``keywords`` and any
   ``og:*``, ``twitter:*`` or ``article:*`` key.

Layers 3 and 4 travel in docs-nav.json as the page's ``seo`` map, so the docs
app sets the same tags on client navigation (``src/frontend/src/docs/seoMeta.ts``).
A noindex page always keeps its noindex robots value.
"""

from __future__ import annotations

import re
from html import escape
from typing import Any, Callable, Iterable

from praisonaiui.schema.models import META_TAG_NAME as TAG_KEY

_FM_KEY = re.compile(r"(og|twitter|article):[a-z0-9_:]{1,40}")
#: Frontmatter keys, besides ``og:*`` / ``twitter:*`` / ``article:*``, that become head tags.
FM_KEYS = ("canonical", "robots", "keywords")
#: Open Graph families take ``property=``; everything else ``name=``.
_PROPERTY = re.compile(r"(og|article|fb|book|profile|music|video):")
#: Tags whose value is a URL: a root-relative one (``/og.png``) is made absolute.
URL_KEYS = frozenset({"canonical", "og:url", "og:image", "og:image:url", "og:image:secure_url", "twitter:image"})
#: Keys the head carries elsewhere: description (its frontmatter key) and robots (``set_robots_meta``).
_NOT_RENDERED = frozenset({"description", "robots"})
_NOINDEX = re.compile(r"\b(noindex|none)\b", re.I)


def _text(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return ""
    return str(value).strip()[:500]


def clean(tags: dict | None) -> dict[str, str]:
    """``tags`` with valid names and non-empty scalar values, as strings."""
    out = {}
    for key, value in (tags or {}).items():
        text = _text(value)
        if isinstance(key, str) and TAG_KEY.fullmatch(key) and text:
            out[key] = text
    return out


def frontmatter_tags(fm: dict) -> dict[str, str]:
    """The head tags a page's frontmatter sets (``keywords: [a, b]`` -> ``"a, b"``)."""
    out = {}
    for key, value in fm.items():
        if not isinstance(key, str) or not (key in FM_KEYS or _FM_KEY.fullmatch(key)):
            continue
        if key == "keywords" and isinstance(value, list):
            value = ", ".join(t for t in map(_text, value) if t)
        text = _text(value)
        if text:
            out[key] = text
    return out


def is_noindex(robots: str | None) -> bool:
    return bool(robots and _NOINDEX.search(robots))


def _route_prefix(path: str, docs_base: str) -> str:
    """A ``seo.paths`` path as a route: ``v1``, ``/v1/*`` and ``/docs/v1/`` all give ``/docs/v1``."""
    base = docs_base.rstrip("/")
    p = "/" + path.strip().rstrip("*").strip("/")
    if p == "/":
        return base or "/"
    return p if p == base or p.startswith(f"{base}/") else f"{base}{p}"


def path_tags(route: str, paths: Iterable, docs_base: str) -> dict[str, str]:
    """The ``seo.paths`` tags for a page route; a longer (more specific) path wins."""
    route = route.rstrip("/")
    matched = []
    for entry in paths:
        prefix = _route_prefix(entry.path, docs_base).rstrip("/")
        if route == prefix or route.startswith(f"{prefix}/"):
            matched.append((len(prefix), clean(entry.metatags)))
    out: dict[str, str] = {}
    for _, tags in sorted(matched, key=lambda m: m[0]):
        out.update(tags)
    return out


def apply_page_seo(nav: dict, seo, docs_base: str) -> None:
    """Fold ``seo.paths`` into each page's ``seo`` map (frontmatter wins), in place.

    A page whose robots tag says ``noindex`` becomes a noindex page, so the
    sitemap, ``llms*.txt`` and site search leave it out as well.
    """
    paths = seo.paths if seo else []
    site_robots = clean(seo.metatags if seo else None).get("robots")

    def walk(items: list[dict]) -> None:
        for item in items:
            if item.get("path"):
                tags = {**path_tags(item["path"], paths, docs_base), **item.get("seo", {})}
                if tags:
                    item["seo"] = tags
                if is_noindex(tags.get("robots") or site_robots):
                    item["noindex"] = True
            walk(item.get("children") or [])

    walk(nav.get("items", []))


def merge(defaults: dict[str, str], overrides: dict[str, str], absolute: Callable[[str], str]) -> dict[str, str]:
    """The page's final tags: ``defaults`` with ``overrides`` on top.

    ``og:url`` follows the canonical and ``twitter:image`` the ``og:image``
    unless set themselves; ``twitter:card`` is ``summary_large_image`` when
    there is an image. A noindex default robots value is never overridden.
    """
    tags = dict(defaults)
    for key, value in overrides.items():
        if key in URL_KEYS and value.startswith("/") and not value.startswith("//"):
            value = absolute(value)
        tags[key] = value
    if "og:url" not in overrides:
        tags["og:url"] = tags["canonical"]
    if "twitter:image" not in overrides and tags.get("og:image"):
        tags["twitter:image"] = tags["og:image"]
    tags.setdefault("twitter:card", "summary_large_image" if tags.get("twitter:image") else "summary")
    if is_noindex(defaults.get("robots")) and not is_noindex(tags.get("robots")):
        tags["robots"] = defaults["robots"]
    return tags


def render(tags: dict[str, str]) -> str:
    """The ``<link rel="canonical">`` and ``<meta>`` lines for ``tags`` (values escaped, R9)."""
    lines = []
    for key, value in tags.items():
        if key in _NOT_RENDERED:
            continue
        if key == "canonical":
            lines.append(f'  <link rel="canonical" href="{escape(value)}" />')
        else:
            attr = "property" if _PROPERTY.match(key) else "name"
            lines.append(f'  <meta {attr}="{escape(key)}" content="{escape(value)}" />')
    return "\n".join(lines)


def strip_meta(html: str, keys: Iterable[str]) -> str:
    """``html`` without the template's ``<meta>`` tags for ``keys`` (the page writes its own)."""
    names = [re.escape(k) for k in keys if k not in _NOT_RENDERED and k != "canonical"]
    if not names:
        return html
    pattern = re.compile(rf'[ \t]*<meta\s+(?:name|property)="(?:{"|".join(names)})"[^>]*>\n?')
    return pattern.sub("", html)


def json_ld(page: dict, site: dict) -> dict:
    """The page's JSON-LD ``@graph``: Organization, WebSite, TechArticle and BreadcrumbList.

    ``page``: url, title, description, crumbs ``[(name, url)]`` and optional
    dateModified, keywords and image. ``site``: url (no trailing slash; may be
    empty), name, search (``?q=`` opens site search) and organization
    ``{name, url, logo, sameAs}``.
    """
    root, org_cfg = site["url"], site.get("organization") or {}
    org_id, site_id = f"{root}/#organization", f"{root}/#website"
    org: dict = {"@type": "Organization", "@id": org_id, "name": org_cfg.get("name") or site["name"]}
    if org_cfg.get("url") or root:
        org["url"] = org_cfg.get("url") or f"{root}/"
    if org_cfg.get("logo"):
        org["logo"] = {"@type": "ImageObject", "url": org_cfg["logo"]}
    if org_cfg.get("sameAs"):
        org["sameAs"] = list(org_cfg["sameAs"])
    website: dict = {"@type": "WebSite", "@id": site_id, "name": site["name"], "url": f"{root}/",
                     "publisher": {"@id": org_id}}
    if site.get("search") and root:
        website["potentialAction"] = {
            "@type": "SearchAction",
            "target": {"@type": "EntryPoint", "urlTemplate": f"{root}/?q={{search_term_string}}"},
            "query-input": "required name=search_term_string",
        }
    article: dict = {
        "@type": "TechArticle", "@id": f"{page['url']}#article", "headline": page["title"],
        "description": page["description"], "url": page["url"], "mainEntityOfPage": page["url"],
        "isPartOf": {"@id": site_id}, "publisher": {"@id": org_id},
    }
    for key in ("dateModified", "keywords", "image"):
        if page.get(key):
            article[key] = page[key]
    graph = [org, website, article]
    crumbs = page.get("crumbs") or []
    if crumbs:
        items = [{"@type": "ListItem", "position": i, "name": name, "item": item}
                 for i, (name, item) in enumerate([*crumbs, (page["title"], page["url"])], 1)]
        graph.append({"@type": "BreadcrumbList", "itemListElement": items})
    return {"@context": "https://schema.org", "@graph": graph}
