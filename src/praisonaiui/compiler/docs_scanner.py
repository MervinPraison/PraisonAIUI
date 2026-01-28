"""Docs folder scanner - discovers markdown files and extracts metadata."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class DocPage:
    """Represents a discovered documentation page."""

    path: Path
    slug: str
    title: str
    order: int = 0
    frontmatter: dict = field(default_factory=dict)


class DocsScanner:
    """Scans a docs directory and discovers pages."""

    def __init__(
        self,
        docs_dir: Path,
        include: list[str] | None = None,
        exclude: list[str] | None = None,
        index_files: list[str] | None = None,
    ):
        self.docs_dir = docs_dir
        self.include = include or ["**/*.md", "**/*.mdx"]
        self.exclude = exclude or []
        self.index_files = index_files or ["index.md", "README.md"]

    def scan(self) -> list[DocPage]:
        """
        Scan the docs directory and return discovered pages.

        Returns:
            List of DocPage objects
        """
        pages: list[DocPage] = []

        if not self.docs_dir.exists():
            return pages

        # Find all matching files
        for pattern in self.include:
            for file_path in self.docs_dir.glob(pattern):
                if file_path.is_file() and not self._is_excluded(file_path):
                    page = self._parse_page(file_path)
                    pages.append(page)

        # Sort by path for consistent ordering
        pages.sort(key=lambda p: (p.path.parent, p.order, p.path.name))

        return pages

    def _is_excluded(self, path: Path) -> bool:
        """Check if a path matches any exclude pattern."""
        import fnmatch

        rel_path = str(path.relative_to(self.docs_dir))
        filename = path.name

        for pattern in self.exclude:
            # Check both full path and filename for pattern matching
            if fnmatch.fnmatch(rel_path, pattern) or fnmatch.fnmatch(filename, pattern):
                return True
        return False

    def _parse_page(self, file_path: Path) -> DocPage:
        """Parse a markdown file and extract metadata."""
        content = file_path.read_text(encoding="utf-8")

        # Extract frontmatter
        frontmatter = self._extract_frontmatter(content)

        # Determine slug
        slug = self._path_to_slug(file_path)

        # Determine title (from frontmatter or first heading)
        title = frontmatter.get("title") or self._extract_title(content) or slug

        # Extract order from frontmatter or filename
        order = frontmatter.get("order", 0)
        if order == 0:
            # Try to extract number prefix from filename (e.g., "01-intro.md")
            match = re.match(r"^(\d+)", file_path.stem)
            if match:
                order = int(match.group(1))

        return DocPage(
            path=file_path,
            slug=slug,
            title=title,
            order=order,
            frontmatter=frontmatter,
        )

    def _path_to_slug(self, file_path: Path) -> str:
        """Convert a file path to a URL slug."""
        rel_path = file_path.relative_to(self.docs_dir)

        # Remove extension
        slug_parts = list(rel_path.parts)
        if slug_parts:
            slug_parts[-1] = rel_path.stem

        # Handle index files
        if slug_parts and slug_parts[-1].lower() in ["index", "readme"]:
            slug_parts = slug_parts[:-1]

        # Join and normalize
        slug = "/".join(slug_parts)

        # Remove number prefixes (e.g., "01-" -> "")
        slug = re.sub(r"/?\d+-", "/", slug).strip("/")

        return slug or "index"

    def _extract_frontmatter(self, content: str) -> dict:
        """Extract YAML frontmatter from content."""
        if not content.startswith("---"):
            return {}

        try:
            # Find closing ---
            end_idx = content.find("---", 3)
            if end_idx == -1:
                return {}

            frontmatter_str = content[3:end_idx].strip()

            # Lazy import yaml
            import yaml

            return yaml.safe_load(frontmatter_str) or {}
        except Exception:
            return {}

    def _extract_title(self, content: str) -> str | None:
        """Extract title from first heading in content."""
        # Skip frontmatter
        if content.startswith("---"):
            end_idx = content.find("---", 3)
            if end_idx != -1:
                content = content[end_idx + 3 :]

        # Find first heading
        match = re.search(r"^#\s+(.+)$", content.strip(), re.MULTILINE)
        if match:
            return match.group(1).strip()

        return None
