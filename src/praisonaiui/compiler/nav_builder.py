"""Navigation builder - creates navigation tree from docs pages."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from praisonaiui.compiler.docs_scanner import DocPage
from praisonaiui.compiler.seo import frontmatter_tags
from praisonaiui.schema.models import page_action_list


@dataclass
class NavItem:
    """A single navigation item."""

    title: str
    path: str
    description: str = ""
    noindex: bool = False
    hidden: bool = False  # routable, but not in the sidebar or pager (publish.apply_indexing)
    searchable: bool = True  # frontmatter `searchable: false`: not in the site's own search
    page_title: str = ""  # the page's own title when the sidebar shows a shorter `nav_title`
    icon: str = ""  # a lucide icon name for the sidebar (group `icon:` in the YAML, page frontmatter `icon:`)
    expanded: bool | None = None  # a group's `expanded:` (false: starts folded)
    tag: str = ""  # a badge after the label: a group's `tag:` in the YAML, a page's frontmatter `tag:`
    directory: str = ""  # card | accordion: the build lists the children on the group's page
    children: list["NavItem"] = field(default_factory=list)
    extra: dict = field(default_factory=dict)  # page_fields(): the page's other frontmatter switches


_ICON_NAME = re.compile(r"[a-z0-9-]{1,40}")
_ICON_URL = re.compile(r"(https?://|/)[^\s\"'<>()]{1,300}")
_META_KEY = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,39}")
#: Page modes besides the default: wide (no "On this page"), center (no sidebar either),
#: custom (only the article, full width), frame (custom with the sidebar).
PAGE_MODES = ("wide", "center", "custom", "frame", "assistant")
#: Frontmatter keys the build reads itself; every other scalar key goes to the page's `meta`.
KNOWN_KEYS = frozenset(
    "title description sidebarTitle nav_title icon iconType tag deprecated mode url hideFooterPagination "
    "hidden noindex searchable order date timestamp lastUpdatedDate noAnchor layout hero features keywords boost canonical robots playground related pageActions".split()
)


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "group"


def manual_entries(config) -> list | None:
    """The sidebar entries a config lists: ``navigation.pages`` and ``groups``,
    then (with ``content.docs.nav.mode: manual``) the tab groups; None for the
    generated sidebar."""
    nav = config.navigation
    docs = config.content.docs if config.content else None
    entries: list = [*nav.pages, *nav.groups] if nav else []
    if nav and docs and docs.nav and docs.nav.mode == "manual":
        from praisonaiui.schema.models import NavGroupConfig

        for d, hidden in nav.divisions():  # tabs, their menu items, anchors, dropdowns
            if not hidden:
                entries += [*d.pages, *d.groups]
                continue
            entries += [NavGroupConfig(group=d.label, pages=d.pages, hidden=True)] * bool(d.pages)
            entries += [g.model_copy(update={"hidden": True}) for g in d.groups]
    return entries or None


def nav_divisions(nav, base: str = "/docs") -> dict:
    """``navigation`` in ui-config.json: tabs, anchors, dropdowns and versions with their groups' page
    lists (a division's loose ``pages`` as a first untitled group); hidden ones left out (a hidden
    version stays, flagged, so its pages still find their version)."""

    def group(g) -> dict:
        return {"group": g.group, "icon": g.icon, "prefix": g.prefix, "pages": g.page_slugs(),
                **({"boost": g.boost} if g.boost is not None else {})}

    def division(d, key: str) -> dict:
        out = {key: d.label, "groups": [group(g) for g in d.sidebar_groups()]}
        for k in ("icon", "href", "url", "description"):
            if getattr(d, k, None):
                out[k] = getattr(d, k)
        for k, child in (("menu", "item"), ("tabs", "tab")):
            if getattr(d, k, None):
                out[k] = [division(c, child) for c in getattr(d, k) if not c.hidden]
        return out

    out: dict = {"tabs": [division(t, "tab") for t in nav.tabs if not t.hidden]}
    for k, child, items in (("anchors", "anchor", [*(nav.global_.anchors if nav.global_ else []), *nav.anchors]),
                            ("dropdowns", "dropdown", nav.dropdowns)):
        if items:
            out[k] = [division(d, child) for d in items if not d.hidden]
    from praisonaiui.compiler.versions import prefix, resolved

    if nav.versions:  # compiler/versions.py; the browser's docs/versions.ts
        out["versions"] = [
            {**division(v, "version"), "prefix": prefix(sub, base), **({"default": True} if not sub else {}),
             **({"tag": v.tag} if v.tag else {}), **({"hidden": True} if v.hidden else {})}
            for v, sub in resolved(nav)
        ]
    return out


def nav_trails(nav: dict) -> dict[str, list[dict]]:
    """Each page path's ancestor groups, outermost first (``[{"title", "path"?}]``)."""
    trails: dict[str, list[dict]] = {}

    def walk(items: list[dict], trail: list[dict]) -> None:
        for item in items:
            if item.get("path"):
                trails.setdefault(item["path"], trail)
            if item.get("children"):
                crumb = {"title": item.get("title", ""), **({"path": item["path"]} if item.get("path") else {})}
                walk(item["children"], [*trail, crumb])

    walk(nav.get("items", []), [])
    return trails


def icon_name(value: object) -> str:
    """A sidebar icon name (lowercase letters, digits, hyphens), or "" for anything else."""
    name = str(value).strip().lower() if isinstance(value, str) else ""
    return name if _ICON_NAME.fullmatch(name) else ""


def icon_value(value: object) -> str:
    """A sidebar icon: a lucide name, an image URL (``https://…`` or ``/…``) or an emoji; "" for anything else."""
    text = value.strip() if isinstance(value, str) else ""
    if _ICON_URL.fullmatch(text):
        return text
    if text and len(text) <= 8 and not any(c.isascii() for c in text):
        return text  # an emoji (no ASCII at all, so never markup)
    return icon_name(text)


def external_url(frontmatter: dict) -> str:
    """Frontmatter ``url:`` when it is an absolute http(s) URL: the page is a sidebar link to it."""
    url = frontmatter.get("url")
    return url.strip() if isinstance(url, str) and re.match(r"https?://\S+$", url.strip()) else ""


def sidebar_title(page: DocPage) -> str:
    """The sidebar label: frontmatter ``sidebarTitle`` or ``nav_title``, else the title."""
    fm = page.frontmatter
    return str(fm.get("sidebarTitle") or fm.get("nav_title") or page.title)


def page_fields(page: DocPage) -> dict:
    """The page's frontmatter switches for docs-nav.json (only what differs from the default).

    ``lede``: the frontmatter ``description`` shows under the title. ``deprecated``,
    ``mode`` (PAGE_MODES), ``hidePager`` (``hideFooterPagination``), ``noAnchor``,
    ``href`` (an external ``url:``), ``pageActions`` (the page's own menu, or false) and ``meta``: the page's other scalar keys, for
    custom JS and CSS (``aiui:content-loaded`` detail, ``data-fm-*`` on the article);
    ``seo``: the head tags it sets (compiler/seo.py).
    """
    fm = page.frontmatter
    out: dict = {}
    if str(fm.get("description") or "").strip():
        out["lede"] = True
    if fm.get("deprecated") is True:
        out["deprecated"] = True
    if fm.get("mode") in PAGE_MODES:
        out["mode"] = fm["mode"]
    if fm.get("hideFooterPagination") is True:
        out["hidePager"] = True
    if fm.get("noAnchor") is True:
        out["noAnchor"] = True
    if external_url(fm):
        out["href"] = external_url(fm)
    actions = page_action_list(fm.get("pageActions"))
    if actions is not None and actions is not True:
        out["pageActions"] = actions  # the page's own page actions (false: none)
    meta = {
        k: v[:200] if isinstance(v, str) else v
        for k, v in fm.items()
        if k not in KNOWN_KEYS and isinstance(k, str) and _META_KEY.fullmatch(k)
        and isinstance(v, (str, int, float, bool))
    }
    if meta:
        out["meta"] = dict(list(meta.items())[:20])
    if tags := frontmatter_tags(fm):
        out["seo"] = tags  # compiler/seo.py: canonical, robots, keywords, og:*, twitter:*
    return out


def _page_nav_item(page: DocPage, path: str, hidden: bool = False) -> NavItem:
    """A page's sidebar entry; an external ``url:`` page has no path (no route, sitemap, llms or search entry)."""
    title = sidebar_title(page)
    return NavItem(
        title=title,
        path="" if external_url(page.frontmatter) else path,
        description=page.description,
        noindex=page.noindex,
        hidden=hidden or page.hidden,
        searchable=page.searchable,
        page_title=page.title if title != page.title else "",
        icon=icon_value(page.frontmatter.get("icon")),
        tag=str(page.frontmatter.get("tag") or "").strip()[:24],
        extra=page_fields(page),
    )


class NavBuilder:
    """Builds navigation tree from discovered docs pages."""

    def __init__(self, pages: list[DocPage], base_path: str = "/docs", directory: str | None = None,
                 roots: tuple[str, ...] = ()):
        self.pages = pages
        self.base_path = base_path.rstrip("/")
        self.directory = directory or ""  # content.docs.nav.directory (auto mode)
        self.roots = roots  # version folders (compiler/versions.py): their pages are top-level entries
        self.unresolved: list[str] = []  # names a manual nav lists that match no page

    def build(self) -> list[NavItem]:
        """
        Build navigation tree from pages.

        Returns:
            List of top-level NavItem objects
        """
        # Group pages by directory
        tree: dict[str, NavItem] = {}
        root_items: list[NavItem] = []

        for page in self.pages:
            full_path = f"{self.base_path}/{page.slug}".rstrip("/")

            item = _page_nav_item(page, full_path)

            placeholder = tree.get(page.slug)
            if placeholder is not None and placeholder.children:  # its folder section came first
                item.children = placeholder.children
                placeholder.__dict__.update(item.__dict__)
                tree[page.slug] = placeholder
                continue

            # Determine parent path
            parts = page.slug.split("/")

            if len(parts) == 1 or page.slug == "index" or "/".join(parts[:-1]) in self.roots:
                # Root level page
                root_items.append(item)
                tree[page.slug] = item
            else:
                # Nested page - find or create parent
                parent_slug = "/".join(parts[:-1])

                if parent_slug in tree:
                    tree[parent_slug].children.append(item)
                else:
                    # A folder section. It has no path: a folder without an
                    # index page is not a page (no route, sitemap or llms entry),
                    # unless nav.directory asks for a generated listing page.
                    parent_item = NavItem(
                        title=parts[-2].replace("-", " ").title(),
                        path=f"{self.base_path}/{parent_slug}" if self.directory else "",
                        children=[item],
                    )
                    tree[parent_slug] = parent_item
                    root_items.append(parent_item)

                tree[page.slug] = item

        for item in root_items:
            if item.children:
                item.directory = self.directory
        return root_items

    def to_dict(self) -> dict:
        """Convert navigation tree to dictionary for JSON export."""
        items = self.build()
        return {"items": [self._item_to_dict(item) for item in items]}

    def to_dict_grouped(self, entries: list, docs_dir: Path | None = None) -> dict:
        """Navigation from the YAML tab groups (``content.docs.nav.mode: manual``).

        Each group becomes a section holding its pages (and nested groups) in
        the listed order. A page is named by its slug (``guide/setup``), its
        file path without ``.md`` (``adr/0001-x``) or ``index``. Pages no group
        lists, and pages of a ``hidden`` group, stay routable as ``hidden``
        items (no sidebar, pager or indexing; see publish.apply_indexing).
        A page listed twice appears once (the first). Entries may also be
        pages (``navigation.pages``); a group's ``root`` page is its own path.
        """
        by_name: dict[str, DocPage] = {}
        for page in self.pages:
            by_name.setdefault(page.slug, page)
            if docs_dir is not None:
                try:
                    rel = page.path.relative_to(docs_dir).with_suffix("").as_posix()
                except ValueError:
                    continue
                by_name.setdefault(rel, page)
        used: set[str] = set()

        def page_item(page: DocPage, hidden: bool = False) -> NavItem:
            return _page_nav_item(page, f"{self.base_path}/{page.slug}".rstrip("/"), hidden)

        def lookup(name: str) -> DocPage | None:
            key = name.strip().strip("/")
            key = key[:-3] if key.endswith(".md") else key
            base = self.base_path.strip("/")
            if base and key.startswith(base + "/"):
                key = key[len(base) + 1 :]
            return by_name.get(key)

        def take(name: str, hidden: bool, report: bool = True) -> NavItem | None:
            page = lookup(name)
            if page is None:
                if report:
                    self.unresolved.append(name)
                return None
            if page.slug in used:
                return None
            used.add(page.slug)
            return page_item(page, hidden)

        def section(group, hidden: bool, trail: tuple[str, ...]) -> NavItem:
            hidden = hidden or bool(getattr(group, "hidden", False))
            trail = (*trail, _slug(group.group))
            root = take(group.root, hidden) if group.root else None
            if root is None and group.directory:  # a listing page at /docs/<group-slug>, or the page there
                root = take("/".join(trail), hidden, report=False)
            children = [c for c in (entry(e, hidden, trail) for e in group.pages) if c and (c.path or c.children or c.extra.get("href"))]
            item = root or NavItem(title=group.group, path="")
            if root is None and group.directory and any(c.path for c in children):
                item.path = f"{self.base_path}/{'/'.join(trail)}"
                item.hidden = hidden
            if root is not None:
                item.page_title = item.page_title or (item.title if item.title != group.group else "")
            item.title = group.group
            item.icon = icon_value(group.icon) or item.icon
            item.expanded, item.tag = group.expanded, (group.tag or "").strip() or item.tag
            item.directory = group.directory or ""
            item.children = children
            return item

        def entry(e, hidden: bool, trail: tuple[str, ...]) -> NavItem | None:
            if isinstance(e, str):
                return take(e, hidden)
            if not hasattr(e, "group"):  # a `{label, href}` link
                return NavItem(title=e.label, path="", hidden=hidden, icon=icon_value(e.icon),
                               tag=(e.tag or "").strip(), extra={"href": e.href})
            return section(e, hidden, trail)

        items = [i for i in (entry(e, False, ()) for e in entries) if i and (i.path or i.children or i.extra.get("href"))]
        items += [page_item(p, hidden=True) for p in self.pages if p.slug not in used and not external_url(p.frontmatter)]
        return {"items": [self._item_to_dict(item) for item in items]}

    def _item_to_dict(self, item: NavItem) -> dict:
        """Convert a NavItem to dictionary (a section has no path)."""
        result: dict = {"title": item.title, **item.extra}
        if item.path:
            result["path"] = item.path
        if item.description:
            result["description"] = item.description
        if item.noindex:
            result["noindex"] = True
        if item.hidden:
            result["hidden"] = True
        if not item.searchable:
            result["searchable"] = False
        if item.page_title:
            result["pageTitle"] = item.page_title
        if item.icon:
            result["icon"] = item.icon
        if item.tag:
            result["tag"] = item.tag
        if item.children:
            if item.expanded is not None:
                result["expanded"] = item.expanded
            if item.directory and item.path:
                result["directory"] = item.directory
            result["children"] = [self._item_to_dict(child) for child in item.children]
        return result
