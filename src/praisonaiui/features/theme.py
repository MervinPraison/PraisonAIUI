"""Theme feature — protocol-driven theme system.

Config-driven: users set theme via config YAML, Python SDK, or HTTP API.
Supports 22 color presets, light/dark mode, radius options, and
user-registered custom themes — all protocol-driven.

Extension points:
    • ThemeProtocol      — ABC for custom theme backends
    • ThemeManager       — default implementation with preset + custom themes
    • /api/theme/*       — HTTP API for live theme switching
    • aiui.register_theme() — Python SDK for adding custom themes
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Protocol ─────────────────────────────────────────────────────

class ThemeProtocol:
    """Protocol for theme providers."""

    def get_theme(self) -> str:
        """Return current theme name."""
        ...

    def set_theme(self, theme: str) -> None:
        """Set the active theme."""
        ...

    def list_themes(self) -> List[str]:
        """Return available theme names."""
        ...

    def get_vars(self, theme: str) -> Dict[str, str]:
        """Return CSS custom property values for a theme."""
        ...


# ── Color Presets (22 palettes) ──────────────────────────────────
# Source of truth for accent colors used across dashboard + chat.
# Each preset maps to --db-accent, --db-accent-glow, --db-accent-rgb.

PRESET_COLORS: Dict[str, Dict[str, str]] = {
    "zinc":    {"accent": "#71717a", "accentRgb": "113,113,122"},
    "slate":   {"accent": "#64748b", "accentRgb": "100,116,139"},
    "stone":   {"accent": "#78716c", "accentRgb": "120,113,108"},
    "gray":    {"accent": "#6b7280", "accentRgb": "107,114,128"},
    "neutral": {"accent": "#737373", "accentRgb": "115,115,115"},
    "red":     {"accent": "#ef4444", "accentRgb": "239,68,68"},
    "orange":  {"accent": "#f97316", "accentRgb": "249,115,22"},
    "amber":   {"accent": "#f59e0b", "accentRgb": "245,158,11"},
    "yellow":  {"accent": "#eab308", "accentRgb": "234,179,8"},
    "lime":    {"accent": "#84cc16", "accentRgb": "132,204,22"},
    "green":   {"accent": "#22c55e", "accentRgb": "34,197,94"},
    "emerald": {"accent": "#10b981", "accentRgb": "16,185,129"},
    "teal":    {"accent": "#14b8a6", "accentRgb": "20,184,166"},
    "cyan":    {"accent": "#06b6d4", "accentRgb": "6,182,212"},
    "sky":     {"accent": "#0ea5e9", "accentRgb": "14,165,233"},
    "blue":    {"accent": "#3b82f6", "accentRgb": "59,130,246"},
    "indigo":  {"accent": "#6366f1", "accentRgb": "99,102,241"},
    "violet":  {"accent": "#8b5cf6", "accentRgb": "139,92,246"},
    "purple":  {"accent": "#a855f7", "accentRgb": "168,85,247"},
    "fuchsia": {"accent": "#d946ef", "accentRgb": "217,70,239"},
    "pink":    {"accent": "#ec4899", "accentRgb": "236,72,153"},
    "rose":    {"accent": "#f43f5e", "accentRgb": "244,63,94"},
}

# Radius presets — values match themes.py RADIUS_PRESETS
RADIUS_MAP: Dict[str, str] = {
    "none": "0", "sm": "0.3rem", "md": "0.5rem", "lg": "0.75rem", "xl": "1rem",
}

# Dark / light mode CSS variable sets
# Extended with Multica-style tokens: brand, sidebar-specific, semantic colors
MODE_VARS: Dict[str, Dict[str, str]] = {
    "dark": {
        # Core background/text
        "--db-bg": "#18181b",
        "--db-sidebar-bg": "#18181b",
        "--db-text": "#ffffff",
        "--db-text-dim": "#a1a1aa",
        "--db-border": "#3f3f46",
        "--db-card-bg": "rgba(255,255,255,0.03)",
        "--db-hover": "#27272a",
        # Multica-style extended tokens
        "--db-canvas": "#000000",
        "--db-popover": "#18181b",
        "--db-muted": "#27272a",
        "--db-muted-fg": "#a1a1aa",
        # Semantic colors
        "--db-success": "#22c55e",
        "--db-success-bg": "rgba(34,197,94,0.12)",
        "--db-warning": "#eab308",
        "--db-warning-bg": "rgba(234,179,8,0.12)",
        "--db-error": "#ef4444",
        "--db-error-bg": "rgba(239,68,68,0.12)",
        "--db-info": "#3b82f6",
        "--db-info-bg": "rgba(59,130,246,0.12)",
        # Sidebar-specific
        "--db-sidebar-accent": "rgba(255,255,255,0.06)",
        "--db-sidebar-accent-fg": "#e4e4e7",
        "--db-sidebar-border": "rgba(255,255,255,0.06)",
        # Scrollbar
        "--db-scrollbar-thumb": "rgba(255,255,255,0.08)",
        "--db-scrollbar-track": "transparent",
    },
    "light": {
        # Core background/text
        "--db-bg": "#fafafa",
        "--db-sidebar-bg": "#f4f4f5",
        "--db-text": "#18181b",
        "--db-text-dim": "#71717a",
        "--db-border": "rgba(0,0,0,0.08)",
        "--db-card-bg": "rgba(0,0,0,0.02)",
        "--db-hover": "rgba(0,0,0,0.04)",
        # Multica-style extended tokens
        "--db-canvas": "#f5f5f5",
        "--db-popover": "#ffffff",
        "--db-muted": "#e4e4e7",
        "--db-muted-fg": "#71717a",
        # Semantic colors
        "--db-success": "#16a34a",
        "--db-success-bg": "rgba(22,163,74,0.12)",
        "--db-warning": "#ca8a04",
        "--db-warning-bg": "rgba(202,138,4,0.12)",
        "--db-error": "#dc2626",
        "--db-error-bg": "rgba(220,38,38,0.12)",
        "--db-info": "#2563eb",
        "--db-info-bg": "rgba(37,99,235,0.12)",
        # Sidebar-specific
        "--db-sidebar-accent": "rgba(0,0,0,0.04)",
        "--db-sidebar-accent-fg": "#18181b",
        "--db-sidebar-border": "rgba(0,0,0,0.08)",
        # Scrollbar
        "--db-scrollbar-thumb": "rgba(0,0,0,0.10)",
        "--db-scrollbar-track": "transparent",
    },
}


# ── Manager ──────────────────────────────────────────────────────

class ThemeManager(ThemeProtocol):
    """Default theme manager with 22 presets + user-registered custom themes.

    Protocol-driven: users register new themes via:
      • Python SDK: ``aiui.register_theme("ocean", {"accent": "#0077b6", ...})``
      • HTTP API:   ``POST /api/theme/register``
    """

    def __init__(self) -> None:
        self._current_preset: str = "indigo"  # default preset
        self._current_mode: str = "dark"       # dark or light
        self._current_radius: str = "md"       # radius preset
        self._custom_themes: Dict[str, Dict[str, str]] = {}

    # ── Protocol interface ───────────────────────────────────────

    def get_theme(self) -> str:
        return self._current_preset

    def set_theme(self, theme: str) -> None:
        if theme in self.list_themes():
            self._current_preset = theme

    def list_themes(self) -> List[str]:
        return list(PRESET_COLORS.keys()) + list(self._custom_themes.keys())

    def get_vars(self, theme: Optional[str] = None) -> Dict[str, str]:
        """Return full CSS variable set for a theme."""
        name = theme or self._current_preset
        preset = PRESET_COLORS.get(name) or self._custom_themes.get(name)
        if not preset:
            preset = PRESET_COLORS["indigo"]

        mode_vars = MODE_VARS.get(self._current_mode, MODE_VARS["dark"])
        radius = RADIUS_MAP.get(self._current_radius, "10px")

        return {
            **mode_vars,
            "--db-accent": preset["accent"],
            "--db-accent-glow": f"rgba({preset['accentRgb']},0.15)",
            "--db-accent-rgb": preset["accentRgb"],
            "--db-radius": radius,
        }

    # ── User extension (protocol-driven) ─────────────────────────

    def register_theme(self, name: str, variables: Dict[str, str]) -> None:
        """Register a custom theme. Must have 'accent' and 'accentRgb' keys."""
        if "accent" not in variables:
            raise ValueError("Custom theme must have 'accent' key")
        if "accentRgb" not in variables:
            # Auto-derive RGB from hex
            hex_color = variables["accent"].lstrip("#")
            r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
            variables["accentRgb"] = f"{r},{g},{b}"
        self._custom_themes[name] = variables
        logger.info("Registered custom theme: %s", name)

    def delete_theme(self, name: str) -> bool:
        """Delete a custom theme (built-in presets cannot be deleted)."""
        if name in self._custom_themes:
            del self._custom_themes[name]
            if self._current_preset == name:
                self._current_preset = "indigo"
            return True
        return False

    # ── Mode / radius ────────────────────────────────────────────

    def set_mode(self, mode: str) -> None:
        if mode in MODE_VARS:
            self._current_mode = mode

    def get_mode(self) -> str:
        return self._current_mode

    def set_radius(self, radius: str) -> None:
        if radius in RADIUS_MAP:
            self._current_radius = radius

    def get_radius(self) -> str:
        return self._current_radius

    def get_full_state(self) -> Dict[str, Any]:
        """Return complete theme state for the frontend."""
        return {
            "preset": self._current_preset,
            "mode": self._current_mode,
            "radius": self._current_radius,
            "variables": self.get_vars(),
            "presets": {
                name: {"accent": p["accent"], "accentRgb": p["accentRgb"]}
                for name, p in {**PRESET_COLORS, **self._custom_themes}.items()
            },
            "modes": list(MODE_VARS.keys()),
            "radii": list(RADIUS_MAP.keys()),
        }


_theme_manager: Optional[ThemeManager] = None
_theme_lock = threading.Lock()


def get_theme_manager() -> ThemeManager:
    global _theme_manager
    with _theme_lock:
        if _theme_manager is None:
            _theme_manager = ThemeManager()
        return _theme_manager


# ── HTTP Handlers ────────────────────────────────────────────────

async def _get_theme(request: Request) -> JSONResponse:
    """GET /api/theme — full state including presets, modes, radii."""
    mgr = get_theme_manager()
    return JSONResponse(mgr.get_full_state())


async def _set_theme(request: Request) -> JSONResponse:
    """PUT /api/theme — apply a preset, mode, or radius change."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    mgr = get_theme_manager()

    if "preset" in body:
        preset = body["preset"]
        if preset not in mgr.list_themes():
            return JSONResponse({"error": f"Unknown preset: {preset}"}, status_code=400)
        mgr.set_theme(preset)

    if "mode" in body:
        mgr.set_mode(body["mode"])

    if "radius" in body:
        mgr.set_radius(body["radius"])

    return JSONResponse(mgr.get_full_state())


async def _get_presets(request: Request) -> JSONResponse:
    """GET /api/theme/presets — list all available presets."""
    mgr = get_theme_manager()
    all_presets = {**PRESET_COLORS, **mgr._custom_themes}
    return JSONResponse({
        "presets": {
            name: {"accent": p["accent"], "accentRgb": p["accentRgb"]}
            for name, p in all_presets.items()
        },
        "builtin": list(PRESET_COLORS.keys()),
        "custom": list(mgr._custom_themes.keys()),
    })


async def _register_theme(request: Request) -> JSONResponse:
    """POST /api/theme/register — register a user-defined custom theme."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    name = body.get("name", "").strip()
    if not name:
        return JSONResponse({"error": "Theme name is required"}, status_code=400)
    if name in PRESET_COLORS:
        return JSONResponse({"error": f"Cannot override built-in preset: {name}"}, status_code=400)

    accent = body.get("accent", "")
    if not accent:
        return JSONResponse({"error": "'accent' hex color is required"}, status_code=400)

    mgr = get_theme_manager()
    mgr.register_theme(name, {
        "accent": accent,
        "accentRgb": body.get("accentRgb", ""),
    })
    return JSONResponse({"registered": name, **mgr.get_full_state()})


async def _delete_custom_theme(request: Request) -> JSONResponse:
    """DELETE /api/theme/{name} — delete a custom theme."""
    name = request.path_params.get("name", "")
    if name in PRESET_COLORS:
        return JSONResponse({"error": "Cannot delete built-in preset"}, status_code=400)

    mgr = get_theme_manager()
    if mgr.delete_theme(name):
        return JSONResponse({"deleted": name, **mgr.get_full_state()})
    return JSONResponse({"error": f"Theme not found: {name}"}, status_code=404)


# ── Feature ──────────────────────────────────────────────────────

class ThemeFeature(BaseFeatureProtocol):
    """Theme feature — 22 presets + user-registered custom themes.

    Protocol-driven: users extend via register_theme() or POST /api/theme/register.
    """

    feature_name = "theme"
    feature_description = "Protocol-driven theme system with 22 presets and custom theme registration"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/theme", _get_theme, methods=["GET"]),
            Route("/api/theme", _set_theme, methods=["PUT"]),
            Route("/api/theme/presets", _get_presets, methods=["GET"]),
            Route("/api/theme/register", _register_theme, methods=["POST"]),
            Route("/api/theme/{name}", _delete_custom_theme, methods=["DELETE"]),
        ]


# Backward-compat alias
PraisonAITheme = ThemeFeature
