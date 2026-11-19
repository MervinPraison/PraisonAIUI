"""Who may read each docs page under ``aiui serve`` (docs/features/docs-auth.md).

``content.docs.auth`` makes every page need sign-in; ``public`` patterns and front
matter ``public: true`` open a page to anyone, front matter ``groups`` limits it to
readers in those groups. The build writes each page's rule and
the ways to sign in (each password's environment variable, never the password) to
:data:`ACCESS_FILE`, which docs_auth.py enforces; the sitemap lists only open pages.
"""

from __future__ import annotations

import json
import os
from fnmatch import fnmatchcase
from pathlib import Path
from typing import TYPE_CHECKING, Union

from praisonaiui.compiler.content_lint import ContentIssue

if TYPE_CHECKING:
    from praisonaiui.compiler.compiler import Compiler

ACCESS_FILE = "aiui-access.json"
#: A page's rule: True (anyone), False (any signed-in reader) or the groups that may read it.
Rule = Union[bool, list[str]]


def _auth(c: Compiler):
    docs = c.config.content.docs if c.config.content else None
    return docs.auth if docs else None


def _groups(fm: dict) -> list[str]:
    groups = fm.get("groups")
    groups = [groups] if isinstance(groups, str) else groups if isinstance(groups, list) else []
    return sorted({str(g).strip() for g in groups if str(g).strip()})


def _match(slug: str, base: str, pattern: str) -> bool:
    """``pattern`` (``/``, ``quickstart``, ``/docs/guides/*``) against a page's slug."""
    p, b = pattern.strip().strip("/"), base.strip("/")
    if b and (p == b or p.startswith(b + "/")):
        p = p[len(b):].strip("/")
    return fnmatchcase(slug, p or "index")


def page_rules(c: Compiler) -> dict[str, Rule] | None:
    """Each page route's :data:`Rule`; the docs home also under ``/`` and the docs root.
    None without ``content.docs.auth``."""
    auth = _auth(c)
    if auth is None:
        return None
    base = c.config.site.route_base_docs.rstrip("/")
    out: dict[str, Rule] = {}
    for page in c._published_pages():
        public = page.frontmatter.get("public")
        rule: Rule = _groups(page.frontmatter) or (
            public if isinstance(public, bool) else any(_match(page.slug, base, p) for p in auth.public))
        out[f"{base}/{page.slug}"] = rule
        if page.slug == "index":
            out["/"] = out[base or "/"] = rule
    return out


def is_public(rules: dict[str, Rule] | None, route: str) -> bool:
    return rules is None or rules.get(route.rstrip("/") or "/") is True


def write(c: Compiler, output_dir: Path) -> list[str]:
    """Write :data:`ACCESS_FILE` for ``aiui serve`` (removed when the site has no auth)."""
    path = output_dir / ACCESS_FILE
    path.unlink(missing_ok=True)
    rules = page_rules(c)
    if rules is None:
        return []
    users = [{"name": name, "env": env, "groups": groups} for name, env, groups in _auth(c).readers()]
    base = c.config.site.route_base_docs.rstrip("/")
    path.write_text(json.dumps({"version": 1, "docs": base, "users": users, "pages": rules}), encoding="utf-8")
    return [ACCESS_FILE]


def build_warning(c: Compiler) -> list[str]:
    """``aiui build``'s reminder that only the aiui server enforces sign-in (7017)."""
    rules = page_rules(c)
    if rules is None:
        return []
    pages = [v for r, v in rules.items() if r not in ("/", c.config.site.route_base_docs.rstrip("/") or "/")]
    return [f"7017: content.docs.auth: {len(pages) - pages.count(True)} of {len(pages)} pages need sign-in, but only when "
            "aiui serve or aiui dev serves this build; a static host publishes every page"]


def issues(c: Compiler, config_file: str) -> list[ContentIssue]:
    """7017: front matter ``public``/``groups`` with no ``content.docs.auth``, or a group no reader has."""
    auth = _auth(c)
    known = {g for _, _, groups in auth.readers() for g in groups} if auth else set()
    out = []
    for page in c._published_pages():
        groups = _groups(page.frontmatter)
        shown = Path(os.path.relpath(page.path, c.base_path)).as_posix()
        if auth is None and (groups or "public" in page.frontmatter):
            out.append(ContentIssue(7017, shown, 0, "front matter public/groups has no effect: the site has no "
                                    "content.docs.auth", f"Add content.docs.auth to {config_file}, or remove the key"))
        elif missing := [g for g in groups if g not in known]:
            out.append(ContentIssue(7017, shown, 0, f"no reader is in group {', '.join(missing)}",
                                    "Add the group to a reader under content.docs.auth.users"))
    return out
