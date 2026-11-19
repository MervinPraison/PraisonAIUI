"""Social cards: a 1200x630 PNG per docs page, the page's ``og:image`` (docs/features/seo.md).

``aiui build`` draws each card from the page title, its sidebar group, the
description, the site name and logo and the theme accent, and publishes it
at ``/og/<page route>.png``. Pillow is optional: without it the build skips
the cards and says once how to get them. Cards are cached by a hash of what
they show, so a rebuild (``aiui dev``) only draws the pages that changed.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

SIZE = (1200, 630)
OG_DIR = "og"
#: Bump when the drawing changes, so cached cards are redrawn.
VERSION = 1
NOTE = (
    "Social cards skipped: install Pillow (pip install pillow) to give every page a 1200x630 "
    "og:image, or set seo.ogImages: false to keep seo.defaultImage"
)
#: Logo files Pillow can draw (an SVG or emoji logo gets the site's initial instead).
RASTER = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
_PAD = 80
_LOGO = 56
#: The bundled UI font (Latin, variable weight); other scripts try these system fonts.
_FONT_GLOB = "geist-latin-wght-normal-*.woff2"
_SYSTEM_FONTS = (
    "NotoSansCJK-Regular.ttc", "Arial Unicode.ttf", "arialuni.ttf", "NotoSans-Regular.ttf",
    "DejaVuSans.ttf", "Arial.ttf",
)


def available() -> bool:
    """Pillow is installed (checked without importing it)."""
    return importlib.util.find_spec("PIL") is not None


@dataclass(frozen=True)
class Card:
    """What one card shows. ``logo`` is a raster file path, or "" for the initial."""

    title: str
    description: str = ""
    eyebrow: str = ""
    site: str = ""
    host: str = ""
    logo: str = ""
    accent: str = "#4f46e5"
    on_accent: str = "#ffffff"
    background: str = "#0e0e11"
    foreground: str = "#ededf0"
    muted: str = "#a1a1aa"


def _hex(color: str) -> str:
    """A CSS colour Pillow reads (hex, rgb(), hsl(), a name) as ``#rrggbb``, else ""."""
    from PIL import ImageColor

    try:
        return "#{:02x}{:02x}{:02x}".format(*ImageColor.getrgb(color.strip())[:3])
    except (ValueError, AttributeError):
        return ""


def style(theme, dark: bool) -> dict[str, str]:
    """The card colours of a site theme: the docs accent (themes.pro_accent) on the mode's page colours."""
    from praisonaiui.themes import PAPER_LOOK, PAPER_SEEDS, PRO_NEUTRALS, pro_accent, wcag_contrast

    mode = "dark" if dark else "light"
    preset = theme.preset if theme else None
    custom = theme and ((dark and theme.accent_dark) or theme.accent)
    accent = ""
    for own in (custom, None):  # a colour Pillow cannot read (oklch()) falls back to the preset's
        try:
            accent = _hex(pro_accent(preset, own)[mode]["accent"])
        except Exception:
            accent = ""
        if accent:
            break
    accent = accent or "#4f46e5"
    n = PRO_NEUTRALS[mode]
    paper = PAPER_SEEDS[mode] if preset == PAPER_LOOK else {}
    return {
        "accent": accent,
        "on_accent": max(("#ffffff", "#0e0e11"), key=lambda on: wcag_contrast(on, accent)),
        "background": paper.get("paper", n["background"]),
        "foreground": paper.get("ink", n["foreground"]),
        "muted": n["muted-fg"],
    }


def logo_file(config, base: Path, dark: bool) -> str:
    """The site logo for a card of this mode, when it is a raster file in the project folder; else ""."""
    logo = config.logo
    values = ([logo.dark, logo.light] if dark else [logo.light, logo.dark]) if logo else []
    value = next((v.strip() for v in [*values, config.site.logo] if v and v.strip()), "")
    if not value or value.startswith(("http://", "https://", "data:")):
        return ""
    root = base.resolve()
    src = (root / value.lstrip("/")).resolve()
    ok = src.suffix.lower() in RASTER and src.is_file() and src.is_relative_to(root)
    return str(src) if ok else ""


def cache_dir() -> Path:
    """Drawn cards, by :func:`card_key`: ``<data dir>/og-cards``, else ``~/.praisonaiui/cache/og-cards``."""
    from praisonaiui.features._paths import aiui_default_data_dir, feature_data_path

    return feature_data_path("og-cards", aiui_default_data_dir() / "cache" / "og-cards")


def card_path(route: str) -> str:
    """Where a page's card is published: ``/docs/guide`` -> ``og/docs/guide.png``."""
    return f"{OG_DIR}/{route.strip('/') or 'index'}.png"


def card_key(card: Card) -> str:
    """The card's cache key: what it shows, the logo's bytes and the drawing version."""
    logo = Path(card.logo)
    data = {**asdict(card), "logo": hashlib.sha256(logo.read_bytes()).hexdigest() if card.logo and logo.is_file() else "",
            "v": VERSION}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:24]


def write(cards: dict[str, Card], output_dir: Path, cache_dir: Optional[Path], font_dirs: list[Path]) -> list[str]:
    """Publish each route's card under ``output_dir``; a card in ``cache_dir`` is copied, not drawn.
    New cards are drawn in parallel (Pillow releases the GIL while it encodes), fonts per thread."""
    local = threading.local()

    def publish(route: str, card: Card) -> str:
        rel = card_path(route)
        dst = output_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        cached = cache_dir / f"{card_key(card)}.png" if cache_dir else None
        if cached and cached.is_file():
            shutil.copyfile(cached, dst)
            return rel
        if not hasattr(local, "fonts"):
            local.fonts = _Fonts(font_dirs)
        dst.write_bytes(render(card, local.fonts))
        if cached:
            try:
                cached.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(dst, cached)
            except OSError:  # a read-only cache folder only costs speed
                pass
        return rel

    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 1)) as pool:
        return list(pool.map(publish, cards, cards.values()))


class _Fonts:
    """Fonts by (size, weight), from the bundled UI font, else a system font, else Pillow's own."""

    def __init__(self, dirs: list[Path]):
        self.bundled = next((str(p) for d in dirs for p in sorted(d.glob(_FONT_GLOB))), None)
        self._cache: dict = {}

    def get(self, size: int, weight: int, text: str):
        latin = all(ord(c) < 0x250 or 0x2000 <= ord(c) < 0x2070 for c in text)
        key = (size, weight, latin)
        if key not in self._cache:
            self._cache[key] = self._load(size, weight, latin)
        return self._cache[key]

    def _load(self, size: int, weight: int, latin: bool):
        from PIL import ImageFont

        names = ([self.bundled] if latin and self.bundled else []) + list(_SYSTEM_FONTS) + [self.bundled]
        for name in filter(None, names):
            try:
                font = ImageFont.truetype(name, size)
            except OSError:
                continue
            try:
                font.set_variation_by_axes([weight])
            except Exception:  # not a variable font
                pass
            return font
        try:
            return ImageFont.load_default(size)
        except TypeError:  # Pillow < 10.1
            return ImageFont.load_default()


def _wrap(draw, text: str, font, width: int, max_lines: int) -> list[str]:
    """``text`` in lines no wider than ``width``; past ``max_lines`` the last line ends in an ellipsis."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        trial = f"{line} {word}" if line else word
        if draw.textlength(trial, font=font) <= width:
            line = trial
            continue
        if line:
            lines.append(line)
        line = word
        while draw.textlength(line, font=font) > width and len(line) > 1:  # a word wider than the card
            cut = len(line) - 1
            while cut > 1 and draw.textlength(line[:cut], font=font) > width:
                cut -= 1
            lines.append(line[:cut])
            line = line[cut:]
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and draw.textlength(f"{last}…", font=font) > width:
            last = last[:-1].rstrip()
        lines[-1] = f"{last}…"
    return lines


def _logo(card: Card):
    from PIL import Image

    if not card.logo:
        return None
    try:
        with Image.open(card.logo) as img:
            img = img.convert("RGBA")
        img.thumbnail((_LOGO * 5, _LOGO))
        return img
    except Exception:  # unreadable image: the initial instead
        return None


def render(card: Card, fonts: _Fonts) -> bytes:
    """The card as PNG bytes."""
    from io import BytesIO

    from PIL import Image, ImageDraw, ImageFilter

    w, h = SIZE
    img = Image.new("RGB", SIZE, card.background)
    # A soft accent glow in the top-right corner, drawn small and blurred up.
    glow = Image.new("L", (w // 4, h // 4), 0)
    ImageDraw.Draw(glow).ellipse((w // 4 - 110, -70, w // 4 + 70, 90), fill=115)
    img.paste(card.accent, (0, 0, w, h), glow.filter(ImageFilter.GaussianBlur(28)).resize(SIZE, Image.BICUBIC))
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, w, 8), fill=card.accent)
    text_w = w - 2 * _PAD

    # Header: the logo (or the site's initial) and the site name
    x, top = _PAD, _PAD
    logo = _logo(card)
    if logo:
        img.paste(logo, (x, top + (_LOGO - logo.height) // 2), logo)
        x += logo.width + 20
    elif card.site:
        draw.rounded_rectangle((x, top, x + _LOGO, top + _LOGO), radius=14, fill=card.accent)
        letter = next((c for c in card.site if c.isalnum()), "").upper()
        draw.text((x + _LOGO / 2, top + _LOGO / 2), letter, font=fonts.get(32, 700, letter),
                  fill=card.on_accent, anchor="mm")
        x += _LOGO + 20
    if card.site and not (logo and logo.width > 2 * logo.height):  # a wordmark already names the site
        font = fonts.get(30, 600, card.site)
        draw.text((x, top + _LOGO / 2), _wrap(draw, card.site, font, w - _PAD - x, 1)[0],
                  font=font, fill=card.foreground, anchor="lm")

    # Footer: the site's host
    bottom = h - _PAD
    if card.host:
        font = fonts.get(26, 500, card.host)
        draw.text((_PAD, bottom), card.host, font=font, fill=card.muted, anchor="ls")
        bottom -= 26 + 28

    # Body: the group, the title (largest size that fits 3 lines) and as much description as fits
    y = top + _LOGO + 64
    if card.eyebrow:
        font = fonts.get(28, 600, card.eyebrow)
        draw.text((_PAD, y), _wrap(draw, card.eyebrow, font, text_w, 1)[0], font=font, fill=card.accent)
        y += 28 + 20
    for size in (72, 64, 56, 48):
        font = fonts.get(size, 700, card.title)
        lines = _wrap(draw, card.title, font, text_w, 99)
        if len(lines) <= 2 or size == 48:
            break
    lines = _wrap(draw, card.title, font, text_w, 3)
    for line in lines:
        draw.text((_PAD, y), line, font=font, fill=card.foreground)
        y += round(size * 1.15)
    lh = 42
    room = (bottom - (y + 20)) // lh
    if card.description and room > 0:
        font = fonts.get(30, 400, card.description)
        y += 20
        for line in _wrap(draw, card.description, font, text_w, min(room, 3)):
            draw.text((_PAD, y), line, font=font, fill=card.muted)
            y += lh

    out = BytesIO()
    img.save(out, "PNG")
    return out.getvalue()
