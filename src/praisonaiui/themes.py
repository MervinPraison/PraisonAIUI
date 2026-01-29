"""
Theme system for PraisonAIUI.

Fetches official shadcn/ui themes and generates CSS variables at build time.
This follows the principle of not hardcoding designs.
"""

import urllib.request
import urllib.error
import json
from pathlib import Path
from typing import Optional

# Shadcn themes registry URL - official source
SHADCN_THEMES_URL = "https://ui.shadcn.com/registry/colors.json"

# Fallback themes if network unavailable - minimal set
FALLBACK_THEMES = {
    "zinc": {
        "light": {
            "background": "0 0% 100%",
            "foreground": "240 10% 3.9%",
            "card": "0 0% 100%",
            "card-foreground": "240 10% 3.9%",
            "popover": "0 0% 100%",
            "popover-foreground": "240 10% 3.9%",
            "primary": "240 5.9% 10%",
            "primary-foreground": "0 0% 98%",
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
            "ring": "240 5.9% 10%",
        },
        "dark": {
            "background": "240 10% 3.9%",
            "foreground": "0 0% 98%",
            "card": "240 10% 3.9%",
            "card-foreground": "0 0% 98%",
            "popover": "240 10% 3.9%",
            "popover-foreground": "0 0% 98%",
            "primary": "0 0% 98%",
            "primary-foreground": "240 5.9% 10%",
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
            "ring": "240 4.9% 83.9%",
        },
    }
}

# Cache for fetched themes
_themes_cache: Optional[dict] = None


def fetch_themes() -> dict:
    """
    Fetch themes from shadcn registry.
    Falls back to cached/fallback themes if network unavailable.
    """
    global _themes_cache
    
    if _themes_cache is not None:
        return _themes_cache
    
    try:
        req = urllib.request.Request(
            SHADCN_THEMES_URL,
            headers={"User-Agent": "PraisonAIUI/1.0"}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            _themes_cache = data
            return data
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        # Use fallback themes if network fails
        return FALLBACK_THEMES


def get_theme_css(preset: str = "zinc", dark_mode: bool = True, radius: str = "0.5rem") -> str:
    """
    Generate CSS variables for a given theme preset.
    
    Args:
        preset: Theme name (e.g., "zinc", "blue", "green")
        dark_mode: Whether to use dark mode colors
        radius: Border radius value
        
    Returns:
        CSS string with :root variables
    """
    themes = fetch_themes()
    
    # Get the theme or fallback to zinc
    theme = themes.get(preset, themes.get("zinc", FALLBACK_THEMES["zinc"]))
    
    mode = "dark" if dark_mode else "light"
    colors = theme.get(mode, theme.get("light", {}))
    
    # Build CSS
    css_lines = [":root {"]
    css_lines.append(f"  --radius: {radius};")
    
    for name, value in colors.items():
        css_lines.append(f"  --{name}: {value};")
    
    css_lines.append("}")
    
    # Add dark mode class if needed
    if dark_mode:
        css_lines.insert(0, ".dark {")
        css_lines.append("")
    
    return "\n".join(css_lines)


def inject_theme_css(output_dir: Path, preset: str = "zinc", dark_mode: bool = True, radius: str = "0.5rem") -> None:
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
