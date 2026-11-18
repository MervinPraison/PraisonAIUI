"""Per-page facts for the docs page footer: last updated and the edit link.

``aiui build`` adds them to each page of ``docs-nav.json``:

- ``lastUpdated``: the date of the last commit that touched the page's
  source (``git log -1``), with ``content.docs.lastUpdated: true``. A page's
  frontmatter ``lastUpdatedDate: 2026-05-01`` wins over git, and
  ``timestamp: false`` / ``true`` turns the date off or on for that page. In a
  shallow clone a page whose last change is older than the clone shows the
  clone's oldest commit, so its date is left out rather than shown wrong;
  pages changed inside the cloned history keep their real date.
- ``editUrl``: ``content.docs.editLink.pattern`` with ``:path`` replaced by
  the page's source path under the docs folder.
"""

from __future__ import annotations

import re
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, timeout=10, check=True).stdout.strip()


@lru_cache(maxsize=8)
def git_root(start: str) -> Optional[str]:
    """The work tree holding ``start``, or None (no git, not a repository)."""
    try:
        return _git("-C", start, "rev-parse", "--show-toplevel") or None
    except (OSError, subprocess.SubprocessError):
        return None


@lru_cache(maxsize=8)
def shallow_boundary(root: str) -> frozenset[str]:
    """The commits a shallow clone cuts history at (empty for a full clone)."""
    try:
        shallow = Path(root, _git("-C", root, "rev-parse", "--git-path", "shallow"))
        return frozenset(shallow.read_text(encoding="utf-8").split()) if shallow.is_file() else frozenset()
    except (OSError, subprocess.SubprocessError):
        return frozenset()


def git_last_updated(path: Path) -> Optional[str]:
    """``YYYY-MM-DD`` of the last commit touching ``path``; None without git, or when
    that commit is a shallow clone's boundary (the real date is older and unknown)."""
    root = git_root(str(path.parent))
    if not root:
        return None
    try:
        sha, _, date = _git("-C", root, "log", "-1", "--format=%H %cs", "--", str(path.resolve())).partition(" ")
    except (OSError, subprocess.SubprocessError):
        return None
    return None if not date or sha in shallow_boundary(root) else date


def frontmatter_date(value: object) -> Optional[str]:
    """``YYYY-MM-DD`` from frontmatter ``lastUpdatedDate`` (a YAML date or a string starting with one)."""
    text = value.isoformat() if hasattr(value, "isoformat") else str(value or "")
    return text[:10] if re.match(r"\d{4}-\d{2}-\d{2}", text) else None


def edit_url(pattern: str, rel_path: str) -> str:
    """The edit link for a page: ``pattern`` with ``:path`` replaced."""
    return pattern.replace(":path", rel_path.lstrip("/"))


def annotate_nav(
    nav: dict,
    resolve: Callable[[str], Optional[Path]],
    docs_dir: Path,
    *,
    edit_pattern: Optional[str] = None,
    last_updated: bool = False,
) -> None:
    """Add ``lastUpdated`` / ``editUrl`` to every page item of a docs-nav dict, in place."""
    from praisonaiui.compiler.docs_scanner import DocsScanner

    read_frontmatter = DocsScanner(docs_dir)._extract_frontmatter

    def walk(items: list[dict]) -> None:
        for item in items:
            path = item.get("path")
            if path:
                source = resolve(path)
                if source is not None:
                    if edit_pattern:
                        try:
                            rel = source.resolve().relative_to(docs_dir.resolve()).as_posix()
                        except ValueError:
                            rel = source.name
                        item["editUrl"] = edit_url(edit_pattern, rel)
                    fm = read_frontmatter(source.read_text(encoding="utf-8")) if source.is_file() else {}
                    shown = fm.get("timestamp") if isinstance(fm.get("timestamp"), bool) else last_updated
                    date = shown and (frontmatter_date(fm.get("lastUpdatedDate")) or git_last_updated(source))
                    if date:
                        item["lastUpdated"] = date
            if item.get("children"):
                walk(item["children"])

    walk(nav.get("items", []))
