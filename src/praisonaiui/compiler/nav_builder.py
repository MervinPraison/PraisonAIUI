"""Navigation builder - creates navigation tree from docs pages."""

from __future__ import annotations

from dataclasses import dataclass, field

from praisonaiui.compiler.docs_scanner import DocPage


@dataclass
class NavItem:
    """A single navigation item."""

    title: str
    path: str
    children: list["NavItem"] = field(default_factory=list)


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
            item = NavItem(title=page.title, path=full_path)

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

    def _item_to_dict(self, item: NavItem) -> dict:
        """Convert a NavItem to dictionary."""
        result = {"title": item.title, "path": item.path}
        if item.children:
            result["children"] = [self._item_to_dict(child) for child in item.children]
        return result
