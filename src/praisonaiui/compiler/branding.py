"""Brand images of a docs build: the logo, favicon and background image.

A value is an http(s) or data URL, a site path (``/images/logo.svg``) or a
file path relative to the config folder (``logo.svg``), which the build
publishes at the same path from the site root.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Optional

IMAGE_SUFFIXES = {".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico"}
DECORATIONS = ("gradient", "grid")
_ICON_LINK_RE = re.compile(r"<link\b[^>]*\brel=[\"']icon[\"'][^>]*>")


def is_image(value: str) -> bool:
    """An image URL or path, not an emoji or a text mark."""
    v = value.strip()
    return v.startswith(("http://", "https://", "data:image/", "/")) or Path(v).suffix.lower() in IMAGE_SUFFIXES


def asset_url(value: Optional[str], base: Path, files: dict[str, Path]) -> Optional[str]:
    """``value`` as a site URL; a config-relative image file is recorded in ``files``
    (published path -> source) for :func:`publish`. Anything else (an emoji, a
    missing file, a path outside the config folder) is returned unchanged."""
    v = (value or "").strip()
    if not v or v.startswith(("http://", "https://", "data:", "/")):
        return value
    root = base.resolve()
    src = (root / v).resolve()
    if src.suffix.lower() not in IMAGE_SUFFIXES or not src.is_file() or not src.is_relative_to(root):
        return value
    rel = src.relative_to(root).as_posix()
    files[rel] = src
    return f"/{rel}"


def publish(files: dict[str, Path], output_dir: Path) -> list[str]:
    """Copy the recorded brand images into the build output."""
    for rel, src in files.items():
        dst = output_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())
    return sorted(files)


def favicon_links(light: Optional[str], dark: Optional[str]) -> str:
    """The ``<link rel="icon">`` tags: one icon, or one per browser colour scheme
    (the tab strip the icon sits on follows the browser's scheme, not the page's)."""
    esc = lambda url: html.escape(url, quote=True)  # noqa: E731
    if light and dark and light != dark:
        return (
            f'<link rel="icon" href="{esc(light)}" media="(prefers-color-scheme: light)" />\n'
            f'  <link rel="icon" href="{esc(dark)}" media="(prefers-color-scheme: dark)" />'
        )
    return f'<link rel="icon" href="{esc(light or dark or "")}" />'


def patch_favicon(page: str, light: Optional[str], dark: Optional[str]) -> str:
    """Replace the bundle's icon link in a page with the site's favicon."""
    if not (light or dark):
        return page
    return _ICON_LINK_RE.sub(lambda _m: favicon_links(light, dark), page, count=1)


def background(value) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """``site.theme.background`` as (decoration for ``data-aiui-bg``, light image, dark image).

    A string is ``gradient``, ``grid`` or one image for both modes; ``{light, dark}``
    is an image per mode (one alone serves both)."""
    if value is not None and not isinstance(value, str):
        light, dark = value.light or value.dark, value.dark or value.light
        return ("image", light, dark) if light else (None, None, None)
    v = (value or "").strip()
    if not v or v == "none":
        return None, None, None
    if v.lower() in DECORATIONS:
        return v.lower(), None, None
    return "image", v, v


def missing_images(config, base: Path) -> list:
    """7102: a logo, favicon or background image file that the build cannot publish
    (not found, or outside the config folder), so the site would show a broken image."""
    from praisonaiui.compiler.content_lint import ContentIssue

    theme = config.site.theme if config.site else None
    values = [
        ("logo.light", config.logo and config.logo.light),
        ("logo.dark", config.logo and config.logo.dark),
        ("favicon.light", config.favicon and config.favicon.light),
        ("favicon.dark", config.favicon and config.favicon.dark),
        ("site.logo", config.site.logo if config.site and config.site.logo and is_image(config.site.logo) else None),
    ]
    _, bg_light, bg_dark = background(theme.background if theme else None)
    values += [("site.theme.background", bg_light), ("site.theme.background", bg_dark if bg_dark != bg_light else None)]
    out = []
    for key, value in values:
        if value and asset_url(value, base, {}) == value and not value.startswith(("http://", "https://", "data:", "/")):
            out.append(ContentIssue(7102, key, 0, f"image {value!r} is not a file in the project folder",
                                    "Use a path relative to the config file, a site path (/logo.svg) or a URL"))
    return out
