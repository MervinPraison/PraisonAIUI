"""
Theme system for PraisonAIUI.

Generates CSS variables for shadcn/ui themes at build time.
All 22 official color presets are embedded — no network required.
"""

import json
import logging
import re
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Shadcn themes registry URL (may be unavailable; fallbacks are authoritative)
SHADCN_THEMES_URL = "https://ui.shadcn.com/registry/colors.json"

# ── All 22 official shadcn/ui color presets ──────────────────────────
# Source: shadcn/ui registry. These are the authoritative fallback so
# builds work offline and in air-gapped environments.

# Single source of truth for preset names — imported by schema/models.py
# and features/theme.py to keep all three in sync.
PRESET_NAMES: tuple[str, ...] = (
    "zinc",
    "slate",
    "stone",
    "gray",
    "neutral",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
)


def _base_light():
    """Shared light-mode structural variables (non-color)."""
    return {
        "background": "0 0% 100%",
        "foreground": "240 10% 3.9%",
        "card": "0 0% 100%",
        "card-foreground": "240 10% 3.9%",
        "popover": "0 0% 100%",
        "popover-foreground": "240 10% 3.9%",
        "secondary": "240 4.8% 95.9%",
        "secondary-foreground": "240 5.9% 10%",
        "muted": "240 4.8% 95.9%",
        "muted-foreground": "240 3.8% 46.1%",
        "accent": "240 4.8% 95.9%",
        "accent-foreground": "240 5.9% 10%",
        "destructive": "0 84.2% 60.2%",
        "destructive-foreground": "0 0% 98%",
        "border": "240 5.9% 90%",
        "input": "240 5.9% 90%",
    }


def _base_dark():
    """Shared dark-mode structural variables (non-color)."""
    return {
        "background": "240 10% 3.9%",
        "foreground": "0 0% 98%",
        "card": "240 10% 3.9%",
        "card-foreground": "0 0% 98%",
        "popover": "240 10% 3.9%",
        "popover-foreground": "0 0% 98%",
        "secondary": "240 3.7% 15.9%",
        "secondary-foreground": "0 0% 98%",
        "muted": "240 3.7% 15.9%",
        "muted-foreground": "240 5% 64.9%",
        "accent": "240 3.7% 15.9%",
        "accent-foreground": "0 0% 98%",
        "destructive": "0 62.8% 30.6%",
        "destructive-foreground": "0 0% 98%",
        "border": "240 3.7% 15.9%",
        "input": "240 3.7% 15.9%",
    }


def _make(primary_l, primary_fg_l, ring_l, primary_d, primary_fg_d, ring_d):
    """Build a full preset from its unique primary/ring values."""
    light = {
        **_base_light(),
        "primary": primary_l,
        "primary-foreground": primary_fg_l,
        "ring": ring_l,
    }
    dark = {
        **_base_dark(),
        "primary": primary_d,
        "primary-foreground": primary_fg_d,
        "ring": ring_d,
    }
    return {"light": light, "dark": dark}


FALLBACK_THEMES = {
    "zinc": _make(
        "240 5.9% 10%", "0 0% 98%", "240 5.9% 10%", "0 0% 98%", "240 5.9% 10%", "240 4.9% 83.9%"
    ),
    "slate": _make(
        "222.2 47.4% 11.2%",
        "210 40% 98%",
        "222.2 84% 4.9%",
        "210 40% 98%",
        "222.2 47.4% 11.2%",
        "212.7 26.8% 83.9%",
    ),
    "stone": _make(
        "24 9.8% 10%",
        "60 9.1% 97.8%",
        "20 14.3% 4.1%",
        "60 9.1% 97.8%",
        "24 9.8% 10%",
        "24 5.4% 63.9%",
    ),
    "gray": _make(
        "220.9 39.3% 11%",
        "210 20% 98%",
        "224 71.4% 4.1%",
        "210 20% 98%",
        "220.9 39.3% 11%",
        "215 20.2% 65.1%",
    ),
    "neutral": _make("0 0% 9%", "0 0% 98%", "0 0% 3.9%", "0 0% 98%", "0 0% 9%", "0 0% 83.1%"),
    "red": _make(
        "0 72.2% 50.6%",
        "0 85.7% 97.3%",
        "0 72.2% 50.6%",
        "0 72.2% 50.6%",
        "0 85.7% 97.3%",
        "0 72.2% 50.6%",
    ),
    "rose": _make(
        "346.8 77.2% 49.8%",
        "355.7 100% 97.3%",
        "346.8 77.2% 49.8%",
        "346.8 77.2% 49.8%",
        "355.7 100% 97.3%",
        "346.8 77.2% 49.8%",
    ),
    "orange": _make(
        "24.6 95% 53.1%",
        "60 9.1% 97.8%",
        "24.6 95% 53.1%",
        "20.5 90.2% 48.2%",
        "60 9.1% 97.8%",
        "20.5 90.2% 48.2%",
    ),
    "green": _make(
        "142.1 76.2% 36.3%",
        "355.7 100% 97.3%",
        "142.1 76.2% 36.3%",
        "142.1 70.6% 45.3%",
        "144.9 80.4% 10%",
        "142.1 70.6% 45.3%",
    ),
    "blue": _make(
        "221.2 83.2% 53.3%",
        "210 40% 98%",
        "221.2 83.2% 53.3%",
        "217.2 91.2% 59.8%",
        "222.2 47.4% 11.2%",
        "217.2 91.2% 59.8%",
    ),
    "yellow": _make(
        "47.9 95.8% 53.1%",
        "26 83.3% 14.1%",
        "47.9 95.8% 53.1%",
        "47.9 95.8% 53.1%",
        "26 83.3% 14.1%",
        "47.9 95.8% 53.1%",
    ),
    "violet": _make(
        "262.1 83.3% 57.8%",
        "210 40% 98%",
        "262.1 83.3% 57.8%",
        "263.4 70% 50.4%",
        "210 40% 98%",
        "263.4 70% 50.4%",
    ),
    "amber": _make("38 92% 50%", "0 0% 98%", "38 92% 50%", "38 92% 50%", "0 0% 9%", "38 92% 50%"),
    "lime": _make("84 85% 43%", "0 0% 98%", "84 85% 43%", "84 85% 43%", "0 0% 9%", "84 85% 43%"),
    "emerald": _make(
        "160 84% 39%", "0 0% 98%", "160 84% 39%", "160 84% 39%", "0 0% 9%", "160 84% 39%"
    ),
    "teal": _make(
        "173 80% 40%", "0 0% 98%", "173 80% 40%", "173 80% 40%", "0 0% 9%", "173 80% 40%"
    ),
    "cyan": _make(
        "192 91% 36%", "0 0% 98%", "192 91% 36%", "192 91% 36%", "0 0% 9%", "192 91% 36%"
    ),
    "sky": _make("199 89% 48%", "0 0% 98%", "199 89% 48%", "199 89% 48%", "0 0% 9%", "199 89% 48%"),
    "indigo": _make(
        "239 84% 67%", "0 0% 98%", "239 84% 67%", "239 84% 67%", "0 0% 98%", "239 84% 67%"
    ),
    "purple": _make(
        "271 91% 65%", "0 0% 98%", "271 91% 65%", "271 91% 65%", "0 0% 98%", "271 91% 65%"
    ),
    "fuchsia": _make(
        "292 84% 61%", "0 0% 98%", "292 84% 61%", "292 84% 61%", "0 0% 98%", "292 84% 61%"
    ),
    "pink": _make(
        "330 81% 60%", "0 0% 98%", "330 81% 60%", "330 81% 60%", "0 0% 98%", "330 81% 60%"
    ),
}

# Thread-safe cache
_themes_cache: Optional[dict] = None
_cache_lock = threading.Lock()


_DISK_CACHE_TTL = 86400  # 24 hours


def _disk_cache_path() -> Path:
    """Return the disk cache path for themes."""
    return Path.home() / ".cache" / "praisonaiui" / "themes.json"


def _read_disk_cache() -> Optional[dict]:
    """Read cached themes from disk if fresh enough."""
    try:
        path = _disk_cache_path()
        if not path.exists():
            return None
        import time

        age = time.time() - path.stat().st_mtime
        if age > _DISK_CACHE_TTL:
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_disk_cache(data: dict) -> None:
    """Persist fetched themes to disk cache."""
    try:
        path = _disk_cache_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass  # Non-critical — build still works


def fetch_themes() -> dict:
    """
    Fetch themes from shadcn registry.
    Falls back to disk cache, then embedded FALLBACK_THEMES.
    """
    global _themes_cache

    with _cache_lock:
        if _themes_cache is not None:
            return _themes_cache

    # Try disk cache first
    cached = _read_disk_cache()
    if cached is not None:
        with _cache_lock:
            _themes_cache = cached
        return cached

    try:
        req = urllib.request.Request(SHADCN_THEMES_URL, headers={"User-Agent": "PraisonAIUI/1.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            with _cache_lock:
                _themes_cache = data
            _write_disk_cache(data)
            return data
    except (
        urllib.error.URLError,
        urllib.error.HTTPError,
        TimeoutError,
        json.JSONDecodeError,
        OSError,
    ):
        logger.info("Using embedded theme presets (network unavailable)")
        return FALLBACK_THEMES


def get_theme_css(preset: str = "zinc", dark_mode: bool = True, radius: str = "0.5rem") -> str:
    """
    Generate the legacy shadcn HSL-triple variables for a theme preset.

    Deprecated: kept for API backward compatibility only. The frontend now
    derives colours from seeds (see :func:`get_seed_theme_css`); unlayered
    HSL triples would override the derived variables with invalid values,
    so nothing in PraisonAIUI calls this any more.

    Args:
        preset: Theme name (e.g., "zinc", "blue", "green")
        dark_mode: Whether to use dark mode colors
        radius: Border radius value

    Returns:
        CSS string with :root and optionally .dark variables
    """
    themes = fetch_themes()

    theme = themes.get(preset)
    if theme is None:
        logger.warning("Unknown theme preset '%s', falling back to 'zinc'", preset)
        theme = themes.get("zinc", FALLBACK_THEMES["zinc"])

    # Always emit :root with light colors + radius
    light_colors = theme.get("light", {})
    css_lines = [":root {"]
    css_lines.append(f"  --radius: {radius};")
    for name, value in light_colors.items():
        css_lines.append(f"  --{name}: {value};")
    css_lines.append("}")

    # Add .dark block if dark mode requested
    if dark_mode:
        dark_colors = theme.get("dark", {})
        css_lines.append("")
        css_lines.append(".dark {")
        for name, value in dark_colors.items():
            css_lines.append(f"  --{name}: {value};")
        css_lines.append("}")

    return "\n".join(css_lines)


def inject_theme_css(
    output_dir: Path,
    preset: str = "zinc",
    dark_mode: bool = True,
    radius: str = "0.5rem",
) -> None:
    """
    Write the build-time theme stylesheet (``assets/theme.css``).

    Since the token layer (ADR-0001 §7) this emits seeds only, via
    :func:`get_seed_theme_css`. ``dark_mode`` is accepted for API
    compatibility; the default mode is applied by the page's theme bootstrap
    (``__AIUI_DARK_DEFAULT__``), and every colour has light and dark values.

    Args:
        output_dir: Build output directory
        preset: Theme name
        dark_mode: Unused (kept for backward compatibility)
        radius: Border radius (a CSS length or a radius preset name)
    """
    css = get_seed_theme_css(preset, radius)

    # Write to theme.css
    theme_file = output_dir / "assets" / "theme.css"
    theme_file.parent.mkdir(parents=True, exist_ok=True)
    theme_file.write_text(css, encoding="utf-8")


def get_available_themes() -> list[str]:
    """Get list of available theme names."""
    themes = fetch_themes()
    return list(themes.keys())


# Radius presets
RADIUS_PRESETS = {
    "none": "0",
    "sm": "0.3rem",
    "md": "0.5rem",
    "lg": "0.75rem",
    "xl": "1rem",
}


def get_radius_value(preset: str = "md") -> str:
    """Get radius CSS value from preset name."""
    return RADIUS_PRESETS.get(preset, RADIUS_PRESETS["md"])


# ── Seed theme (token layer, ADR-0001 §7) ───────────────────────────────
# The frontend derives every colour from a few seeds (src/frontend/src/styles/
# theme.css). Python only emits seeds; the tables below are mirrored in
# src/frontend/src/themes.ts (tests/unit/test_seed_theme.py keeps them equal).

# Neutral presets: the accent follows the ink (monochrome), only the tint changes.
NEUTRAL_TINTS: dict[str, str] = {
    "zinc": "#71717a",
    "slate": "#64748b",
    "stone": "#78716c",
    "gray": "#6b7280",
    "neutral": "#737373",
}

# Light-mode accents: the Tailwind 600 shade of each colour preset, so the
# accent reads on white. Dark mode uses the 500 shade from
# features/theme.py PRESET_COLORS (the dashboard's accent table).
PRESET_ACCENT_LIGHT: dict[str, str] = {
    "red": "#dc2626",
    "orange": "#ea580c",
    "amber": "#d97706",
    "yellow": "#ca8a04",
    "lime": "#65a30d",
    "green": "#16a34a",
    "emerald": "#059669",
    "teal": "#0d9488",
    "cyan": "#0891b2",
    "sky": "#0284c7",
    "blue": "#2563eb",
    "indigo": "#4f46e5",
    "violet": "#7c3aed",
    "purple": "#9333ea",
    "fuchsia": "#c026d3",
    "pink": "#db2777",
    "rose": "#e11d48",
}

COLOR_PRESET_ACCENT_MIX = "4%"

DENSITY_PRESETS: dict[str, tuple[str, str]] = {
    # name: (--density, --font-size-base)
    "compact": ("0.875", "0.875rem"),
    "comfortable": ("1", "0.9375rem"),
    "spacious": ("1.125", "1rem"),
}

_HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_FUNC_COLOR = re.compile(
    r"^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-zA-Z.,%/\s+-]*\)$"
)
_NAMED_COLOR = re.compile(r"^[a-zA-Z]{3,30}$")
_CSS_LENGTH = re.compile(r"^(?:0|\d*\.?\d+(?:px|rem|em))$")


def preset_accents() -> dict[str, dict[str, str]]:
    """``{preset: {"light": 600 hex, "dark": 500 hex}}`` for every colour preset."""
    from praisonaiui.features.theme import PRESET_COLORS

    return {
        name: {"light": light, "dark": PRESET_COLORS[name]["accent"]}
        for name, light in PRESET_ACCENT_LIGHT.items()
    }


def _is_css_color(value: str) -> bool:
    v = value.strip()
    return bool(_HEX_COLOR.match(v) or _FUNC_COLOR.match(v) or _NAMED_COLOR.match(v))


def _hex_to_rgb_triple(value: str) -> Optional[str]:
    """``#3b82f6`` / ``#38f`` -> ``"59,130,246"`` (for ``rgba(var(--db-accent-rgb), a)``)."""
    v = value.strip().lstrip("#")
    if len(v) in (3, 4):
        v = "".join(c * 2 for c in v[:3])
    elif len(v) in (6, 8):
        v = v[:6]
    else:
        return None
    try:
        return ",".join(str(int(v[i : i + 2], 16)) for i in (0, 2, 4))
    except ValueError:
        return None


def _resolve_radius(radius: Optional[str]) -> Optional[str]:
    if radius is None:
        return None
    r = str(radius).strip()
    if r in RADIUS_PRESETS:
        return RADIUS_PRESETS[r]
    if _CSS_LENGTH.match(r):
        return r
    logger.warning("Ignoring invalid theme radius %r (use none|sm|md|lg|xl or a CSS length)", radius)
    return None


def get_seed_theme_css(
    preset: Optional[str] = None,
    radius: Optional[str] = None,
    accent: Optional[str] = None,
    density: Optional[str] = None,
) -> str:
    """Return the L0 seed CSS for a theme (ADR-0001 §7).

    The result is unlayered CSS (``:root { ... }`` plus an optional density
    rule) that overrides the defaults in ``styles/theme.css``. It never emits
    shadcn variables such as ``--background``; those are derived in CSS.

    Args:
        preset: A YAML colour preset (``zinc`` ... ``rose``). Neutral presets
            (zinc, slate, stone, gray, neutral) are monochrome: the accent
            follows the ink. Colour presets seed ``--seed-accent-light`` (600
            shade) and ``--seed-accent-dark`` (500 shade). ``None`` or an
            unknown name means zinc.
        radius: A radius preset (``none|sm|md|lg|xl``) or a CSS length.
        accent: Any CSS colour. Pins one accent for both modes and overrides
            the preset's accent. An accent equal to the preset's own
            ``PRESET_COLORS`` accent is treated as the preset itself, so a
            caller that always forwards ThemeManager's accent keeps the light
            600 shade (colour presets) or stays monochrome (neutral presets).
        density: ``compact``, ``comfortable`` or ``spacious``. Emitted as
            ``html:not([data-density])`` so a runtime ``data-density`` wins.

    Invalid values are logged and skipped, so the output is always safe to
    inline in a ``<style>`` tag.
    """
    from praisonaiui.features.theme import PRESET_COLORS

    name = (preset or "zinc").strip().lower()
    accents = preset_accents()
    if name not in NEUTRAL_TINTS and name not in accents:
        logger.warning("Unknown theme preset %r for seed theme; using zinc", preset)
        name = "zinc"

    custom_accent: Optional[str] = None
    if accent is not None and str(accent).strip():
        a = str(accent).strip()
        if not _is_css_color(a):
            logger.warning("Ignoring invalid theme accent %r (expected a CSS colour)", accent)
        elif a.lower() == PRESET_COLORS[name]["accent"].lower():
            # The preset's own accent (ThemeManager reports it for every
            # preset): keep the light/dark pair, or monochrome for neutrals.
            pass
        else:
            custom_accent = a

    lines = [":root {"]
    radius_value = _resolve_radius(radius)
    if radius_value is not None:
        lines.append(f"  --radius: {radius_value};")

    if name in NEUTRAL_TINTS:
        lines.append(f"  --seed-tint: {NEUTRAL_TINTS[name]};")
    else:
        lines.append(f"  --seed-tint: {NEUTRAL_TINTS['zinc']};")

    if custom_accent:
        lines.append(f"  --seed-accent: {custom_accent};")
        lines.append(f"  --accent-mix: {COLOR_PRESET_ACCENT_MIX};")
        rgb = _hex_to_rgb_triple(custom_accent) if custom_accent.startswith("#") else None
        accent_rgb = rgb or PRESET_COLORS[name]["accentRgb"]
    elif name in accents:
        lines.append(f"  --seed-accent-light: {accents[name]['light']};")
        lines.append(f"  --seed-accent-dark: {accents[name]['dark']};")
        lines.append(f"  --accent-mix: {COLOR_PRESET_ACCENT_MIX};")
        accent_rgb = PRESET_COLORS[name]["accentRgb"]
    else:
        lines.append("  --seed-accent: var(--seed-ink);")
        lines.append("  --accent-mix: 0%;")
        accent_rgb = PRESET_COLORS[name]["accentRgb"]

    # Legacy views use rgba(var(--db-accent-rgb), a), which needs a triple.
    lines.append(f"  --db-accent-rgb: {accent_rgb};")
    lines.append("}")

    if density is not None:
        d = str(density).strip().lower()
        if d in DENSITY_PRESETS:
            dens, size = DENSITY_PRESETS[d]
            lines.append(
                f"html:not([data-density]) {{ --density: {dens}; --font-size-base: {size}; }}"
            )
        else:
            logger.warning("Ignoring invalid theme density %r", density)

    return "\n".join(lines)
