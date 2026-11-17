"""The docs home page layout (frontmatter ``layout: home`` on the docs index).

``docs_home_from_frontmatter`` keeps the fields the docs renderer draws
(``hero`` and ``features``, the VitePress shape) as plain strings, drops
anything else, and caps the lists. The compiler writes the result to
ui-config.json ``docsHome``; ``src/frontend/src/docs/DocsHome.tsx`` renders it.
``hero_preload_tags`` lets the home page's HTML start the hero image download
before the app has drawn the hero.
"""

from __future__ import annotations

import html
import posixpath
import re
from typing import Any

MAX_ACTIONS = 4
MAX_FEATURES = 12
_HERO_KEYS = ("name", "text", "tagline", "image", "imageDark", "imageAlt")
_FEATURE_KEYS = ("title", "details", "icon", "link", "linkText")
_ALIASES = {"image_dark": "imageDark", "image_alt": "imageAlt", "link_text": "linkText"}


def _strings(raw: Any, keys: tuple[str, ...]) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in raw.items():
        key = _ALIASES.get(key, key)
        if key in keys and isinstance(value, (str, int, float)) and str(value).strip():
            out[key] = str(value).strip()
    return out


def docs_home_from_frontmatter(frontmatter: dict) -> dict | None:
    """The ``docsHome`` manifest for a page's frontmatter, or None when it is not ``layout: home``."""
    if not isinstance(frontmatter, dict) or frontmatter.get("layout") != "home":
        return None
    home: dict[str, Any] = {}

    raw_hero = frontmatter.get("hero")
    hero: dict[str, Any] = _strings(raw_hero, _HERO_KEYS)
    actions = []
    for raw in (raw_hero or {}).get("actions") or [] if isinstance(raw_hero, dict) else []:
        action = _strings(raw, ("text", "link"))
        if "text" in action and "link" in action:
            action["theme"] = "alt" if isinstance(raw, dict) and raw.get("theme") == "alt" else "brand"
            actions.append(action)
    if actions:
        hero["actions"] = actions[:MAX_ACTIONS]
    if hero:
        home["hero"] = hero

    features = [f for f in (_strings(raw, _FEATURE_KEYS) for raw in frontmatter.get("features") or []) if "title" in f]
    if features:
        home["features"] = features[:MAX_FEATURES]
    return home


_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.I)
# The theme bootstrap in index.html turns dark on only when the OS says dark,
# so "light" is everything else (no preference included).
_MEDIA = {"light": "not all and (prefers-color-scheme: dark)", "dark": "(prefers-color-scheme: dark)"}


def _hero_url(src: str, home_path: str) -> str | None:
    """The URL DocsHome.tsx requests for a hero image (resolveDocTarget against the home page)."""
    src = src.strip()
    if src.startswith("//") or _SCHEME.match(src):
        return src if src.lower().startswith(("http://", "https://")) else None
    if src.startswith("/"):
        return src
    base = home_path.rstrip("/").rsplit("/", 1)[0] + "/"
    path, sep, rest = (base + src).partition("?") if "?" in src else ((base + src), "", "")
    return posixpath.normpath(path) + (sep + rest if sep else "")


def hero_preload_tags(home: dict | None, home_path: str, mode: str) -> str:
    """``<link rel="preload" as="image">`` tags for the docs home hero.

    The app draws the hero only after its scripts and data have loaded, so
    without these the image (the page's largest paint) cannot start sooner.
    ``mode`` is ``site.theme.mode``: with both images and ``system``, each link
    carries the colour-scheme query the theme bootstrap uses; a fixed mode
    preloads only its own image. A reader whose saved light/dark choice differs
    from the OS fetches both; the app still shows the right one.
    """
    hero = (home or {}).get("hero") or {}
    light, dark = hero.get("image"), hero.get("imageDark")
    if not light:
        return ""
    if not dark:
        picks = [(light, None)]
    elif mode == "dark":
        picks = [(dark, None)]
    elif mode == "light":
        picks = [(light, None)]
    else:
        picks = [(light, _MEDIA["light"]), (dark, _MEDIA["dark"])]
    tags = []
    for src, media in picks:
        url = _hero_url(src, home_path)
        if not url:
            continue
        media_attr = f' media="{html.escape(media)}"' if media else ""
        tags.append(f'  <link rel="preload" as="image" href="{html.escape(url, quote=True)}"{media_attr} fetchpriority="high">')
    return "\n".join(tags)
