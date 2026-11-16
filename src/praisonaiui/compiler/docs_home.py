"""The docs home page layout (frontmatter ``layout: home`` on the docs index).

``docs_home_from_frontmatter`` keeps the fields the docs renderer draws
(``hero`` and ``features``, the VitePress shape) as plain strings, drops
anything else, and caps the lists. The compiler writes the result to
ui-config.json ``docsHome``; ``src/frontend/src/docs/DocsHome.tsx`` renders it.
"""

from __future__ import annotations

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
