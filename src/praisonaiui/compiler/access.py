"""Who may read each docs page under ``aiui serve`` (docs/features/docs-auth.md).

``content.docs.auth`` makes every page need sign-in; ``public`` patterns and front
matter ``public: true`` open a page to anyone. The build writes each page's rule and
the ways to sign in (each password's environment variable, never the password) to
:data:`ACCESS_FILE`, which docs_auth.py enforces; the sitemap lists only open pages.
"""

from __future__ import annotations

import json
import os
from fnmatch import fnmatchcase
from pathlib import Path
from typing import TYPE_CHECKING

from praisonaiui.compiler.content_lint import ContentIssue

if TYPE_CHECKING:
    from praisonaiui.compiler.compiler import Compiler

ACCESS_FILE = "aiui-access.json"


def _auth(c: Compiler):
    docs = c.config.content.docs if c.config.content else None
    return docs.auth if docs else None


def _match(slug: str, base: str, pattern: str) -> bool:
    """``pattern`` (``/``, ``quickstart``, ``/docs/guides/*``) against a page's slug."""
    p, b = pattern.strip().strip("/"), base.strip("/")
    if b and (p == b or p.startswith(b + "/")):
        p = p[len(b):].strip("/")
    return fnmatchcase(slug, p or "index")


def page_rules(c: Compiler) -> dict[str, bool] | None:
    """Each page route: open to anyone (True) or not; the docs home also under ``/`` and the
    docs root. None without ``content.docs.auth``."""
    auth = _auth(c)
    if auth is None:
        return None
    base = c.config.site.route_base_docs.rstrip("/")
    out: dict[str, bool] = {}
    for page in c._published_pages():
        public = page.frontmatter.get("public")
        rule = public if isinstance(public, bool) else any(_match(page.slug, base, p) for p in auth.public)
        out[f"{base}/{page.slug}"] = rule
        if page.slug == "index":
            out["/"] = out[base or "/"] = rule
    return out


def is_public(rules: dict[str, bool] | None, route: str) -> bool:
    return rules is None or rules.get(route.rstrip("/") or "/") is True


def write(c: Compiler, output_dir: Path) -> list[str]:
    """Write :data:`ACCESS_FILE` for ``aiui serve`` (removed when the site has no auth)."""
    path = output_dir / ACCESS_FILE
    path.unlink(missing_ok=True)
    rules = page_rules(c)
    if rules is None:
        return []
    users = [{"name": name, "env": env} for name, env in _auth(c).readers()]
    base = c.config.site.route_base_docs.rstrip("/")
    path.write_text(json.dumps({"version": 1, "docs": base, "users": users, "pages": rules}), encoding="utf-8")
    return [ACCESS_FILE]


def build_warning(c: Compiler) -> list[str]:
    """``aiui build``'s reminder that only the aiui server enforces sign-in (7017)."""
    rules = page_rules(c)
    if rules is None:
        return []
    pages = [v for r, v in rules.items() if r not in ("/", c.config.site.route_base_docs.rstrip("/") or "/")]
    return [f"7017: content.docs.auth: {pages.count(False)} of {len(pages)} pages need sign-in, but only when "
            "aiui serve or aiui dev serves this build; a static host publishes every page"]


def issues(c: Compiler, config_file: str) -> list[ContentIssue]:
    """7017: front matter ``public`` on a site with no ``content.docs.auth`` (it does nothing)."""
    if _auth(c) is not None:
        return []
    return [ContentIssue(7017, Path(os.path.relpath(page.path, c.base_path)).as_posix(), 0,
                         "front matter public has no effect: the site has no content.docs.auth",
                         f"Add content.docs.auth to {config_file}, or remove the key")
            for page in c._published_pages() if "public" in page.frontmatter]
