"""Theme feature — protocol-driven theme system (Gap 19).

Config-driven: users set theme via config YAML or API.
Supports light/dark/auto with CSS custom properties.
"""

from __future__ import annotations

import json
import logging
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


# ── Default Themes ───────────────────────────────────────────────

THEMES: Dict[str, Dict[str, str]] = {
    "dark": {
        "--chat-bg": "#0d1117",
        "--chat-text": "#e6edf3",
        "--chat-sidebar-bg": "#010409",
        "--chat-border": "#21262d",
        "--chat-muted": "#8b949e",
        "--chat-accent": "#58a6ff",
        "--chat-accent-hover": "#79c0ff",
        "--chat-user-bubble": "#1f6feb",
        "--chat-assist-bubble": "#161b22",
        "--chat-code-bg": "#1a1e24",
        "--chat-input-bg": "#161b22",
        "--chat-header-bg": "#010409",
        "--chat-avatar-bg": "#161b22",
        "--chat-hover": "#161b22",
        "--chat-active": "#1f6feb22",
        "--chat-error": "#f85149",
    },
    "light": {
        "--chat-bg": "#ffffff",
        "--chat-text": "#1f2328",
        "--chat-sidebar-bg": "#f6f8fa",
        "--chat-border": "#d0d7de",
        "--chat-muted": "#656d76",
        "--chat-accent": "#0969da",
        "--chat-accent-hover": "#0550ae",
        "--chat-user-bubble": "#0969da",
        "--chat-assist-bubble": "#f6f8fa",
        "--chat-code-bg": "#f6f8fa",
        "--chat-input-bg": "#f6f8fa",
        "--chat-header-bg": "#f6f8fa",
        "--chat-avatar-bg": "#eaeef2",
        "--chat-hover": "#f3f4f6",
        "--chat-active": "#ddf4ff",
        "--chat-error": "#cf222e",
    },
}


# ── Manager ──────────────────────────────────────────────────────

class ThemeManager(ThemeProtocol):
    """Default theme manager."""

    def __init__(self) -> None:
        self._current = "dark"
        self._custom_themes: Dict[str, Dict[str, str]] = {}

    def get_theme(self) -> str:
        return self._current

    def set_theme(self, theme: str) -> None:
        if theme in self.list_themes():
            self._current = theme

    def list_themes(self) -> List[str]:
        return list(THEMES.keys()) + list(self._custom_themes.keys())

    def get_vars(self, theme: Optional[str] = None) -> Dict[str, str]:
        name = theme or self._current
        if name in THEMES:
            return THEMES[name]
        return self._custom_themes.get(name, THEMES["dark"])

    def register_theme(self, name: str, variables: Dict[str, str]) -> None:
        self._custom_themes[name] = variables


_theme_manager: Optional[ThemeManager] = None


def get_theme_manager() -> ThemeManager:
    global _theme_manager
    if _theme_manager is None:
        _theme_manager = ThemeManager()
    return _theme_manager


# ── HTTP Handlers ────────────────────────────────────────────────

async def _get_theme(request: Request) -> JSONResponse:
    mgr = get_theme_manager()
    return JSONResponse({
        "theme": mgr.get_theme(),
        "themes": mgr.list_themes(),
        "variables": mgr.get_vars(),
    })


async def _set_theme(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    theme = body.get("theme", "")
    mgr = get_theme_manager()
    if theme not in mgr.list_themes():
        return JSONResponse({"error": f"Unknown theme: {theme}"}, status_code=400)

    mgr.set_theme(theme)
    return JSONResponse({
        "theme": mgr.get_theme(),
        "variables": mgr.get_vars(),
    })


# ── Feature ──────────────────────────────────────────────────────

class PraisonAITheme(BaseFeatureProtocol):
    """Theme feature — light/dark/custom theme system."""

    feature_name = "theme"
    feature_description = "Theme system with light/dark/custom support"

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
        ]
