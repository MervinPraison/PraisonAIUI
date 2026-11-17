"""Navigation builder - creates navigation tree from docs pages."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from praisonaiui.compiler.docs_scanner import DocPage


@dataclass
class NavItem:
    """A single navigation item."""

    title: str
    path: str
    description: str = ""
    noindex: bool = False
    page_title: str = ""  # the page's own title when the sidebar shows a shorter `nav_title`
    icon: str = ""  # a lucide icon name for the sidebar (group `icon:` in the YAML, page frontmatter `icon:`)
    children: list["NavItem"] = field(default_factory=list)


_ICON_NAME = re.compile(r"[a-z0-9-]{1,40}")


def icon_name(value: object) -> str:
    """A sidebar icon name (lowercase letters, digits, hyphens), or "" for anything else."""
    name = str(value).strip().lower() if isinstance(value, str) else ""
    return name if _ICON_NAME.fullmatch(name) else ""


class NavBuilder:
    """Builds navigation tree from discovered docs pages."""

    def __init__(self, pages: list[DocPage], base_path: str = "/docs"):
        self.pages = pages
        self.base_path = base_path.rstrip("/")

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

            # Create NavItem for this page
            item = NavItem(
                title=page.title,
                path=full_path,
                description=page.description,
                noindex=page.noindex,
                icon=icon_name(page.frontmatter.get("icon")),
            )

            # Determine parent path
            parts = page.slug.split("/")

            if len(parts) == 1 or page.slug == "index":
                # Root level page
                root_items.append(item)
                tree[page.slug] = item
            else:
                # Nested page - find or create parent
                parent_slug = "/".join(parts[:-1])
                parent_path = f"{self.base_path}/{parent_slug}"

                if parent_slug in tree:
                    tree[parent_slug].children.append(item)
                else:
                    # Create placeholder parent
                    parent_item = NavItem(
                        title=parts[-2].replace("-", " ").title(),
                        path=parent_path,
                        children=[item],
                    )
                    tree[parent_slug] = parent_item
                    root_items.append(parent_item)

                tree[page.slug] = item

        return root_items

    def to_dict(self) -> dict:
        """Convert navigation tree to dictionary for JSON export."""
        items = self.build()
        return {"items": [self._item_to_dict(item) for item in items]}

    def to_dict_grouped(self, groups: list, docs_dir: Path | None = None) -> dict:
        """Navigation from the YAML tab groups (``content.docs.nav.mode: manual``).

        Each group becomes a section holding its pages (and nested groups) in
        the listed order. A page is named by its slug (``guide/setup``), its
        file path without ``.md`` (``adr/0001-x``) or ``index``. Pages no group
        lists stay routable and searchable as top-level items that no tab
        shows in its sidebar. A page listed twice appears once (the first).
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

        def page_item(page: DocPage) -> NavItem:
            title = str(page.frontmatter.get("nav_title") or page.title)
            path = f"{self.base_path}/{page.slug}".rstrip("/")
            return NavItem(
                title=title,
                path=path,
                description=page.description,
                noindex=page.noindex,
                page_title=page.title if title != page.title else "",
                icon=icon_name(page.frontmatter.get("icon")),
            )

        def lookup(name: str) -> DocPage | None:
            key = name.strip().strip("/")
            key = key[:-3] if key.endswith(".md") else key
            base = self.base_path.strip("/")
            if base and key.startswith(base + "/"):
                key = key[len(base) + 1 :]
            return by_name.get(key)

        def section(group) -> NavItem:
            children: list[NavItem] = []
            for entry in group.pages:
                if isinstance(entry, str):
                    page = lookup(entry)
                    if page is not None and page.slug not in used:
                        used.add(page.slug)
                        children.append(page_item(page))
                else:
                    sub = section(entry)
                    if sub.children:
                        children.append(sub)
            return NavItem(title=group.group, path="", children=children, icon=icon_name(group.icon))

        items = [s for s in (section(g) for g in groups) if s.children]
        items += [page_item(p) for p in self.pages if p.slug not in used]
        return {"items": [self._item_to_dict(item) for item in items]}

    def _item_to_dict(self, item: NavItem) -> dict:
        """Convert a NavItem to dictionary (a section has no path)."""
        result: dict = {"title": item.title}
        if item.path:
            result["path"] = item.path
        if item.description:
            result["description"] = item.description
        if item.noindex:
            result["noindex"] = True
        if item.page_title:
            result["pageTitle"] = item.page_title
        if item.icon:
            result["icon"] = item.icon
        if item.children:
            result["children"] = [self._item_to_dict(child) for child in item.children]
        return result
