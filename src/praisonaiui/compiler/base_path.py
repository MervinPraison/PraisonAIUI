"""The URL path a static build is published under (``aiui build --base-path``).

A site at the root of its host needs none. A GitHub project site
(``user.github.io/repo``) or docs behind a proxy (``example.com/docs``) does:
every asset, manifest, page and link URL must start with it. The browser
side reads it from ``<meta name="aiui-base">`` (src/frontend/src/lib/url.ts).
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlparse

# Path segments of letters, digits and -._~ only: the value goes into HTML
# attributes and URLs unescaped.
_SAFE = re.compile(r"^(?:/[A-Za-z0-9._~-]+)+$")

AUTO = "auto"


def normalize_base_path(value: str | None) -> str:
    """``"/repo"`` for ``repo``, ``/repo/`` or ``/repo``; ``""`` for none, ``""`` or ``/``.

    Raises ValueError for anything else (a scheme, a query, ``..``, spaces).
    """
    raw = (value or "").strip()
    if raw in ("", "/"):
        return ""
    path = "/" + raw.strip("/")
    if not _SAFE.match(path) or any(seg in (".", "..") for seg in path.split("/")):
        raise ValueError(
            f"Invalid base path {value!r}: use a URL path such as /docs or /my-repo "
            "(letters, digits and - . _ ~ only)"
        )
    return path


def github_pages_base(env: Mapping[str, str], project_dir: Path) -> tuple[str, str | None]:
    """``(base path, site URL)`` for a GitHub Pages build (``--base-path auto``).

    In GitHub Actions a project site is served at ``https://<owner>.github.io/<repo>``,
    so the base is ``/<repo>``. A user or organisation site (repo
    ``<owner>.github.io``) or a custom domain (a ``CNAME`` file, as
    ``_site_url`` reads it) is served at the root. Outside Actions: the root.
    """
    repo_slug = env.get("GITHUB_REPOSITORY", "") if env.get("GITHUB_ACTIONS") == "true" else ""
    owner, _, repo = repo_slug.partition("/")
    if not owner or not repo or repo.lower() == f"{owner.lower()}.github.io":
        return "", None
    if any((project_dir / d / "CNAME").is_file() for d in (".", "docs")):
        return "", None
    base = normalize_base_path(repo)
    return base, f"https://{owner.lower()}.github.io{base}"


def resolve_base_path(
    cli_value: str | None,
    config_value: str | None,
    site_url: str | None,
    project_dir: Path,
    env: Mapping[str, str] | None = None,
) -> tuple[str, str | None]:
    """``(base path, inferred site URL or None)``.

    The first one set wins: ``--base-path``, ``site.basePath``, then the path
    of ``seo.siteUrl`` (``https://example.com/docs`` means ``/docs``). ``auto``
    detects a GitHub Pages project site (``github_pages_base``).
    """
    env = os.environ if env is None else env
    for value in (cli_value, config_value):
        if value is None:
            continue
        if value.strip().lower() == AUTO:
            if site_url:  # an explicit site URL says where the site lives
                return normalize_base_path(urlparse(site_url).path), None
            return github_pages_base(env, project_dir)
        return normalize_base_path(value), None
    if site_url:
        return normalize_base_path(urlparse(site_url).path), None
    return "", None
