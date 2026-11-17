"""Per-page facts for the docs page footer: last updated and the edit link.

``aiui build`` adds them to each page of ``docs-nav.json``:

- ``lastUpdated``: the date of the last commit that touched the page's
  source (``git log -1``), with ``content.docs.lastUpdated: true``. In a
  shallow clone every page would show the clone's one commit, so the date is
  left out there rather than shown wrong.
- ``editUrl``: ``content.docs.editLink.pattern`` with ``:path`` replaced by
  the page's source path under the docs folder.
"""

from __future__ import annotations

import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional


@lru_cache(maxsize=8)
def git_root(start: str) -> Optional[str]:
    """The work tree holding ``start``, or None (no git, not a repository, shallow clone)."""
    try:
        top = subprocess.run(
            ["git", "-C", start, "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
        shallow = subprocess.run(
            ["git", "-C", start, "rev-parse", "--is-shallow-repository"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return None if shallow == "true" else top or None


def git_last_updated(path: Path) -> Optional[str]:
    """``YYYY-MM-DD`` of the last commit touching ``path``, or None."""
    root = git_root(str(path.parent))
    if not root:
        return None
    try:
        out = subprocess.run(
            ["git", "-C", root, "log", "-1", "--format=%cs", "--", str(path.resolve())],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return out or None


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
    if not edit_pattern and not last_updated:
        return

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
                    if last_updated:
                        date = git_last_updated(source)
                        if date:
                            item["lastUpdated"] = date
            if item.get("children"):
                walk(item["children"])

    walk(nav.get("items", []))
