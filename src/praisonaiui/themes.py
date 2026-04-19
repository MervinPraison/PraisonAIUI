"""
Theme system for PraisonAIUI.

Generates CSS variables for shadcn/ui themes at build time.
All 22 official color presets are embedded — no network required.
"""

import json
import logging
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
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _write_disk_cache(data: dict) -> None:
    """Persist fetched themes to disk cache."""
    try:
        path = _disk_cache_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
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
    Generate CSS variables for a given theme preset.

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
    Inject theme CSS into the output directory.

    Args:
        output_dir: Build output directory
        preset: Theme name
        dark_mode: Whether to use dark mode
        radius: Border radius
    """
    css = get_theme_css(preset, dark_mode, radius)

    # Write to theme.css
    theme_file = output_dir / "assets" / "theme.css"
    theme_file.parent.mkdir(parents=True, exist_ok=True)
    theme_file.write_text(css)


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
