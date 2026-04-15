"""Server module - FastAPI + SSE for real-time AI chat."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Callable, Optional

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from praisonaiui.datastore import BaseDataStore, JSONFileDataStore, MemoryDataStore
from praisonaiui.features import auto_register_defaults, get_features
from praisonaiui.provider import BaseProvider, RunEventType

# Registry for callbacks
_callbacks: dict[str, Callable] = {}
_agents: dict[str, dict[str, Any]] = {}
# Registry for dashboard pages (protocol-driven)
_pages: dict[str, dict[str, Any]] = {}
# User-defined page whitelist — None means "show all built-in pages"
_enabled_pages: Optional[set[str]] = None
# Track which page IDs were added by @aiui.page() (always shown)
_custom_page_ids: set[str] = set()
# Pluggable datastore (default: SDK-backed store if available, else JSON file store)
def _init_default_datastore() -> BaseDataStore:
    """Try SDK-backed store first (unifies with praisonai-agents session store),
    fall back to AIUI's own JSONFileDataStore."""
    try:
        from praisonaiui.datastore_sdk import SDKFileDataStore
        return SDKFileDataStore()
    except (ImportError, Exception):
        return JSONFileDataStore()

_datastore: BaseDataStore = _init_default_datastore()
# Pluggable AI provider (default: PraisonAI)
_provider: Optional[BaseProvider] = None  # lazy-init to avoid circular import
# Track active tasks per session for server-side abort
_active_tasks: dict[str, asyncio.Task] = {}
# Server start time for uptime calculation
_server_start_time: float = time.time()


def _get_data_dir() -> Path:
    """Return the AIUI data directory, configurable via AIUI_DATA_DIR env var."""
    data_dir = Path(os.environ.get("AIUI_DATA_DIR", str(Path.home() / ".praisonaiui")))
    data_dir.mkdir(parents=True, exist_ok=True)
    # Align SDK data dir → same location so schedules, memory, sessions
    # all live in one place instead of split across ~/.praisonai/ and ~/.praisonaiui/
    os.environ.setdefault("PRAISONAI_HOME", str(data_dir))
    return data_dir


# In-memory log buffer for /api/logs
_log_buffer: deque = deque(maxlen=500)
# Usage tracking (token counts per session/model)
_usage_stats: dict[str, Any] = {
    "total_requests": 0,
    "total_tokens": 0,
    "by_model": {},
    "by_session": {},
}
# Server config path (set during create_app)
_config_path: Optional[Path] = None
_config_cache: Optional[dict] = None
# Explicit style set via aiui.set_style() — None means "not set"
_style: Optional[str] = None
# Branding config set via aiui.set_branding() — overrides YAML/defaults
_branding: dict[str, str] = {"title": "PraisonAI", "logo": "🦞"}
# Theme config set via aiui.set_theme() — overrides YAML site.theme
_theme: Optional[dict[str, Any]] = None
# Custom CSS set via aiui.set_custom_css()
_custom_css: Optional[str] = None
# Chat features override set via aiui.set_chat_features()
_chat_features: Optional[dict[str, Any]] = None
# Dashboard config set via aiui.set_dashboard()
_dashboard_config: Optional[dict[str, Any]] = None


def reset_state() -> None:
    """Reset all mutable server state to initial values.

    Intended for test isolation — call in test fixtures to avoid
    state leaking between tests.  Not for production use.
    """
    global _style, _branding, _theme, _custom_css, _chat_features
    global _dashboard_config, _provider, _config_path, _config_cache
    _callbacks.clear()
    _agents.clear()
    _pages.clear()
    _enabled_pages_ref = globals()
    _enabled_pages_ref["_enabled_pages"] = None
    _custom_page_ids.clear()
    _active_tasks.clear()
    _log_buffer.clear()
    _usage_stats.update({
        "total_requests": 0, "total_tokens": 0,
        "by_model": {}, "by_session": {},
    })
    _style = None
    _branding = {"title": "PraisonAI", "logo": "🦞"}
    _theme = None
    _custom_css = None
    _chat_features = None
    _dashboard_config = None
    _provider = None
    _config_path = None
    _config_cache = None


def set_style(style: str) -> None:
    """Set the UI style from Python code (call before server starts).

    Valid values: 'chat', 'agents', 'playground', 'dashboard', 'docs', 'custom'.
    This takes priority over auto-detection but is overridden by CLI --style.
    """
    global _style
    _style = style


def set_branding(title: str = "PraisonAI", logo: str = "🦞") -> None:
    """Set the sidebar branding (title and logo emoji).

    Configurable from ``app.py`` or ``config.yaml`` (under ``site.title``
    and ``site.logo``).  Call before the server starts.

    Example::

        aiui.set_branding(title="MyApp", logo="🚀")
    """
    global _branding
    _branding = {"title": title, "logo": logo}


def set_theme(
    preset: str = "zinc",
    dark_mode: bool = True,
    radius: str = "md",
) -> None:
    """Set the UI theme from Python code.

    Controls the color palette, dark/light mode, and border radius.
    Takes priority over YAML ``site.theme`` but can be overridden by
    the development dashboard.

    Args:
        preset: Color palette name. Options: zinc, slate, stone, gray,
                neutral, red, orange, amber, yellow, lime, green,
                emerald, teal, cyan, sky, blue, indigo, violet,
                purple, fuchsia, pink, rose (or any custom theme name).
        dark_mode: True for dark background, False for light.
        radius: Corner roundness. Options: none, sm, md, lg, xl.

    Example::

        import praisonaiui as aiui
        aiui.set_theme(preset="blue", dark_mode=True, radius="lg")
    """
    global _theme
    _theme = {
        "preset": preset,
        "darkMode": dark_mode,
        "radius": radius,
    }
    # Sync with ThemeManager so /api/theme returns correct state
    try:
        from praisonaiui.features.theme import get_theme_manager
        mgr = get_theme_manager()
        if preset in mgr.list_themes():
            mgr.set_theme(preset)
        mgr.set_mode("dark" if dark_mode else "light")
        mgr.set_radius(radius)
    except Exception:
        pass  # Graceful fallback if theme feature not loaded


def set_custom_css(css: str) -> None:
    """Inject custom CSS into the UI.

    The CSS string is added as an inline ``<style>`` tag in the served
    HTML page. Use this to override any default styles.

    Args:
        css: Raw CSS string.

    Example::

        import praisonaiui as aiui
        aiui.set_custom_css('''
            :root {
                --db-accent: #22c55e;
                --db-bg: #000000;
            }
            .chat-msg-user .chat-msg-content {
                background: #22c55e;
            }
        ''')
    """
    global _custom_css
    _custom_css = css


def set_chat_features(
    *,
    history: bool = True,
    streaming: bool = True,
    file_upload: bool = False,
    audio: bool = False,
    reasoning: bool = True,
    tools: bool = True,
    multimedia: bool = True,
    feedback: bool = False,
) -> None:
    """Configure which chat features are enabled in the UI.

    Controls visibility of chat sub-features like the session history
    sidebar, file upload button, audio input, etc.

    Args:
        history: Show session history sidebar (default True).
        streaming: Enable streaming responses (default True).
        file_upload: Show file upload button (default False).
        audio: Show audio input button (default False).
        reasoning: Show reasoning/thinking steps (default True).
        tools: Show tool call displays (default True).
        multimedia: Enable multimedia rendering (default True).
        feedback: Show feedback buttons (default False).

    Example::

        import praisonaiui as aiui
        aiui.set_chat_features(history=False)  # Hide session sidebar
    """
    global _chat_features
    _chat_features = {
        "history": history,
        "streaming": streaming,
        "fileUpload": file_upload,
        "audio": audio,
        "reasoning": reasoning,
        "tools": tools,
        "multimedia": multimedia,
        "feedback": feedback,
    }


def set_dashboard(
    *,
    sidebar: bool = True,
    page_header: bool = True,
) -> None:
    """Configure dashboard layout options.

    Controls visibility of dashboard UI elements like the sidebar
    navigation panel.

    Args:
        sidebar: Show the left sidebar navigation (default True).
        page_header: Show the page title/description header (default True).

    Example::

        import praisonaiui as aiui
        aiui.set_style("dashboard")
        aiui.set_dashboard(sidebar=False)  # Chat-only dashboard, no sidebar
    """
    global _dashboard_config
    _dashboard_config = {
        "sidebar": sidebar,
        "pageHeader": page_header,
    }


# Chat mode config set via aiui.set_chat_mode()
_chat_mode: Optional[dict[str, Any]] = None


def set_chat_mode(
    mode: str = "fullpage",
    *,
    position: tuple[int, int] | None = None,
    size: tuple[int, int] | None = None,
    resizable: bool = True,
    minimized: bool = False,
) -> None:
    """Configure chat window display mode.

    Controls how the chat interface is rendered — as a full page,
    floating window, or sidebar panel.

    Args:
        mode: Display mode. Options:
            - "fullpage" (default): Chat fills the main content area
            - "floating": Resizable floating window (bottom-right)
            - "sidebar": Fixed panel on the right side
        position: (bottom, right) pixel offset for floating mode.
            Default: (20, 20)
        size: (width, height) initial size for floating mode.
            Default: (400, 500)
        resizable: Allow resizing the floating window. Default True.
        minimized: Start minimized (floating mode only). Default False.

    Example::

        import praisonaiui as aiui
        aiui.set_chat_mode("floating", position=(20, 20), size=(420, 550))
    """
    global _chat_mode
    _chat_mode = {
        "mode": mode,
        "position": list(position) if position else [20, 20],
        "size": list(size) if size else [400, 500],
        "resizable": resizable,
        "minimized": minimized,
    }


# Brand color set via aiui.set_brand_color()
_brand_color: Optional[str] = None


def set_brand_color(color: str) -> None:
    """Set the brand/primary accent color.

    This color is used for primary buttons, links, and highlights
    throughout the UI. Overrides the theme's default accent color.

    Args:
        color: Hex color (e.g. "#6366f1") or CSS color value.

    Example::

        import praisonaiui as aiui
        aiui.set_brand_color("#818cf8")  # Indigo-400
    """
    global _brand_color
    _brand_color = color


def set_sidebar_config(
    *,
    collapsible: bool = True,
    default_collapsed: bool = False,
    width: int = 260,
    min_width: int = 200,
    max_width: int = 360,
) -> None:
    """Configure sidebar behavior.

    Args:
        collapsible: Allow sidebar to be collapsed. Default True.
        default_collapsed: Start with sidebar collapsed. Default False.
        width: Default sidebar width in pixels. Default 260.
        min_width: Minimum width when resizing. Default 200.
        max_width: Maximum width when resizing. Default 360.

    Example::

        import praisonaiui as aiui
        aiui.set_sidebar_config(collapsible=True, width=280)
    """
    global _dashboard_config
    if _dashboard_config is None:
        _dashboard_config = {}
    _dashboard_config.update({
        "sidebarCollapsible": collapsible,
        "sidebarCollapsed": default_collapsed,
        "sidebarWidth": width,
        "sidebarMinWidth": min_width,
        "sidebarMaxWidth": max_width,
    })


def register_theme(name: str, variables: dict[str, str]) -> None:
    """Register a custom theme preset via the protocol-driven ThemeManager.

    The theme becomes available in the theme picker UI and via the
    ``/api/theme`` API.  Only ``accent`` is required — ``accentRgb`` is
    auto-derived from the hex color if not provided.

    Args:
        name: Unique theme name (e.g. "ocean", "sunset").
        variables: Dict with at least ``{"accent": "#hexcolor"}``.

    Example::

        import praisonaiui as aiui
        aiui.register_theme("ocean", {"accent": "#0077b6"})
        aiui.register_theme("sunset", {"accent": "#ff6b35", "accentRgb": "255,107,53"})
    """
    from praisonaiui.features.theme import get_theme_manager
    get_theme_manager().register_theme(name, variables)


def set_pages(page_ids: list[str]) -> None:
    """Whitelist which built-in sidebar pages to show.

    Only the specified built-in page IDs will appear in the sidebar.
    Custom pages registered via ``@aiui.page()`` always appear regardless.
    Call before the server starts (typically in your ``app.py``).

    Example::

        import praisonaiui as aiui
        aiui.set_pages(["chat", "sessions", "agents", "usage", "config"])

    Pass an empty list to hide **all** built-in pages (only custom pages shown).
    If never called, all built-in pages are shown (backward compatible).
    """
    global _enabled_pages
    _enabled_pages = set(page_ids)


def remove_page(page_id: str) -> None:
    """Remove a page from the sidebar by its ID.

    Works for both built-in and custom pages.
    """
    _pages.pop(page_id, None)
    _custom_page_ids.discard(page_id)


def get_style() -> Optional[str]:
    """Get the explicitly set style, or None if not set."""
    return _style


def detect_style() -> str:
    """Auto-detect the best UI style from registered callbacks and agents.

    Detection heuristics (in priority order):
      1. profiles callback + registered agents → 'agents'
      2. page:* callbacks registered → 'dashboard'
      3. reply callback → 'chat'
      4. fallback → 'chat'
    """
    has_profiles = "profiles" in _callbacks
    has_agents = bool(_agents)
    has_pages = any(k.startswith("page:") for k in _callbacks)

    if has_profiles and has_agents:
        return "agents"
    if has_pages:
        return "dashboard"
    return "chat"


# ── Shared config helpers ────────────────────────────────────────────

def _get_site_section() -> dict:
    """Read the 'site' section from the config store, or return {}."""
    try:
        from praisonaiui.config_store import get_config_store
        cs = get_config_store()
        return (cs.get_section("site") if cs else {}) or {}
    except Exception:
        return {}


# ── Dynamic HTML & plugin config generation ─────────────────────────

def _build_html(style: str) -> str:
    """Generate the host HTML based on style. No template files needed.

    The SDK owns the HTML — just like Chainlit. Users never write HTML.
    """
    # Branding-driven title: set_branding() → YAML config → default
    _site_section = _get_site_section()
    _site_title = (
        _site_section.get("title", _branding["title"]) if _site_section
        else _branding["title"]
    )
    title = f"{_site_title} Dashboard" if style == "dashboard" else _site_title
    cache_bust = int(_server_start_time)

    # Anti-flicker: dark background + hide React content until plugins render
    anti_flicker = ""
    if style == "docs":
        anti_flicker = (
            '<style id="aiui-anti-flicker">'
            'html,body{background:#0f172a!important;color:#e2e8f0}'
            '#root>*{opacity:0;transition:opacity .15s ease}'
            '</style>'
        )
    # Dashboard style: legacy plugins own #root — skip React to prevent DOM war
    react_script = (
        '' if style == 'dashboard' else
        f'<script type="module" crossorigin src="/assets/index.js?v={cache_bust}"></script>'
    )

    # Inject custom CSS if set via set_custom_css() or YAML site.custom_css
    custom_css_tag = ''
    _css = _custom_css
    if not _css and _site_section:
        _css = _site_section.get("custom_css") or _site_section.get("customCss")
    if _css:
        custom_css_tag = f'<style id="aiui-custom-css">{_css}</style>'

    return (
        '<!doctype html><html lang="en" style="background:#0f172a;color:#e2e8f0"><head>'
        '<meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
        f'<link rel="stylesheet" href="/assets/index.css?v={cache_bust}">'
        f'{anti_flicker}'
        f'{custom_css_tag}'
        f'<title>{title}</title>'
        '</head><body style="background:#0f172a;margin:0">'
        '<div id="root"></div>'
        f'{react_script}'
        f'<script src="/plugins/plugin-loader.js?v={cache_bust}"></script>'
        '</body></html>'
    )


# Shared effective style — set by create_app(), read by _plugins_config()
_effective_style: str = "chat"

async def _plugins_config(request: Request) -> JSONResponse:
    """Dynamic plugins.json — style-aware, protocol-driven.

    Replaces the static plugins.json file. Each style loads only the
    plugins it needs, keeping the frontend lean.
    Uses _effective_style (set by create_app) so it stays in sync with
    the /ui-config.json endpoint.
    """
    style = _effective_style
    # Base plugins (always loaded)
    plugins: list[str] = ["fetch-retry"]
    if style == "dashboard":
        plugins += [
            "dashboard",
        ]
    elif style == "docs":
        plugins += [
            "topnav", "syntax-highlight", "code-copy",
            "content-loader", "toc", "mermaid",
            "nav-intercept", "mkdocs-compat", "homepage",
        ]
    else:
        # chat / agents / playground — minimal plugins
        plugins += ["syntax-highlight", "code-copy"]
    return JSONResponse({"plugins": plugins})


async def _serve_index(request: Request) -> HTMLResponse:
    """Serve dynamically generated HTML based on active style."""
    style = _effective_style  # Single source of truth (set by create_app)
    return HTMLResponse(_build_html(style))



def set_datastore(store: BaseDataStore) -> None:
    """Set the datastore implementation (call before server starts)."""
    global _datastore
    _datastore = store


def get_datastore() -> BaseDataStore:
    """Get the current datastore instance."""
    return _datastore


def set_provider(provider: BaseProvider) -> None:
    """Set the AI provider (call before server starts).

    Any class implementing ``BaseProvider`` can be plugged in.
    Default: ``PraisonAIProvider`` (uses the @aiui.reply callback system).
    """
    global _provider
    _provider = provider


def get_provider() -> BaseProvider:
    """Get the current AI provider, lazy-initialising the default."""
    global _provider
    if _provider is None:
        from praisonaiui.providers import PraisonAIProvider
        _provider = PraisonAIProvider()
    return _provider


def register_callback(event: str, func: Callable) -> None:
    """Register a callback for an event."""
    _callbacks[event] = func


def register_agent(name: str, agent: Any) -> None:
    """Register an agent."""
    _agents[name] = {
        "name": name,
        "agent": agent,
        "created_at": datetime.utcnow().isoformat(),
    }


def register_page(
    id: str,
    *,
    title: str,
    icon: str = "📄",
    group: str = "Custom",
    description: str = "",
    api_endpoint: Optional[str] = None,
    handler: Optional[Callable] = None,
    order: int = 100,
) -> None:
    """Register a dashboard page.

    Built-in pages and user-defined pages use the same protocol.
    Users can override built-in pages by registering with the same id.

    Args:
        id: Unique page identifier (e.g. 'metrics')
        title: Display title in sidebar
        icon: Emoji icon for sidebar
        group: Tab group name (e.g. 'Control', 'Settings', 'Custom')
        description: Brief subtitle shown in header
        api_endpoint: API path for page data (default: /api/pages/{id}/data)
        handler: Optional async function that returns page data as dict
        order: Sort order within group (lower = first, default 100)
    """
    endpoint = api_endpoint or f"/api/pages/{id}/data"
    _pages[id] = {
        "id": id,
        "title": title,
        "icon": icon,
        "group": group,
        "description": description,
        "api_endpoint": endpoint,
        "order": order,
    }
    _custom_page_ids.add(id)
    if handler:
        register_callback(f"page:{id}", handler)


async def health(request: Request) -> JSONResponse:
    """Health check endpoint."""
    provider = get_provider()
    provider_info = {"name": type(provider).__name__}
    try:
        provider_health = await provider.health()
        provider_info.update(provider_health)
    except Exception:
        pass
    return JSONResponse({
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "provider": provider_info,
    })


async def list_agents(request: Request) -> JSONResponse:
    """List all registered agents (merges registry + provider)."""
    agents = [
        {
            "name": info["name"],
            "created_at": info["created_at"],
        }
        for info in _agents.values()
    ]
    # Also ask the provider for agents
    try:
        provider = get_provider()
        provider_agents = await provider.list_agents()
        existing_names = {a["name"] for a in agents}
        for pa in provider_agents:
            if pa.get("name") not in existing_names:
                agents.append(pa)
    except Exception:
        pass
    return JSONResponse({"agents": agents})


async def list_sessions(request: Request) -> JSONResponse:
    """List all sessions."""
    sessions = await _datastore.list_sessions()
    return JSONResponse({"sessions": sessions})


async def get_session(request: Request) -> JSONResponse:
    """Get a specific session."""
    session_id = request.path_params["session_id"]
    session = await _datastore.get_session(session_id)
    if session is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse(session)


async def get_session_runs(request: Request) -> JSONResponse:
    """Get runs (message history) for a session."""
    session_id = request.path_params["session_id"]
    session = await _datastore.get_session(session_id)
    if session is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    messages = await _datastore.get_messages(session_id)
    return JSONResponse({"runs": messages})


async def delete_session(request: Request) -> JSONResponse:
    """Delete a session."""
    session_id = request.path_params["session_id"]
    deleted = await _datastore.delete_session(session_id)
    if not deleted:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse({"status": "deleted"})


async def create_session(request: Request) -> JSONResponse:
    """Create a new session."""
    session = await _datastore.create_session()
    return JSONResponse({"session_id": session["id"]})


async def patch_session(request: Request) -> JSONResponse:
    """Update session metadata (rename, tag)."""
    session_id = request.path_params["session_id"]
    session = await _datastore.get_session(session_id)
    if session is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    title = body.get("title")
    if title is not None:
        await _datastore.update_session(session_id, title=title)
    return JSONResponse({"status": "updated", "session_id": session_id})


# ---------------------------------------------------------------------------
# Dashboard API endpoints
# ---------------------------------------------------------------------------

async def api_overview(request: Request) -> JSONResponse:
    """Dashboard overview — health, version, stats."""
    sessions = await _datastore.list_sessions()
    profiles_cb = _callbacks.get("profiles")
    profiles = []
    if profiles_cb:
        result = profiles_cb()
        if asyncio.iscoroutine(result):
            result = await result
        profiles = result if isinstance(result, list) else []
    provider = get_provider()
    provider_name = type(provider).__name__
    # Fetch provider health data for richer dashboard info
    try:
        provider_health = await provider.health()
    except Exception:
        provider_health = {"status": "unknown"}

    # Gather loaded features and channel status
    features = get_features()
    channels_info = {"total": 0, "running": 0}
    for feat in features.values():
        if feat.name == "channels":
            try:
                h = await feat.health()
                channels_info = {
                    "total": h.get("total_channels", 0),
                    "running": h.get("running_channels", 0),
                }
            except Exception:
                pass
            break

    return JSONResponse({
        "status": "ok",
        "runtimeType": "AIUI",
        "version": _get_version(),
        "uptime_seconds": round(time.time() - _server_start_time, 1),
        "python_version": sys.version,
        "provider": provider_name,
        "provider_health": provider_health,
        "features_loaded": len(features),
        "channels": channels_info,
        "stats": {
            "total_sessions": len(sessions),
            "active_tasks": len(_active_tasks),
            "registered_agents": len(_agents),
            "registered_profiles": len(profiles),
            "total_requests": _usage_stats["total_requests"],
        },
        "agents": list(_agents.keys()),
        "config": {
            "model": os.environ.get("PRAISONAI_MODEL", os.environ.get("DEFAULT_AI_MODEL", "gpt-4o-mini")),
            "data_dir": str(_get_data_dir()),
        },
    })


async def api_config_handler(request: Request) -> JSONResponse:
    """Read or write server config."""
    global _config_cache
    if request.method == "GET":
        config = _config_cache or {}
        if _config_path and _config_path.exists():
            config = load_config_from_yaml(_config_path) or {}
            _config_cache = config
        return JSONResponse({
            "config": config,
            "config_path": str(_config_path) if _config_path else None,
        })
    elif request.method == "PUT":
        if not _config_path:
            return JSONResponse({"error": "No config file path set"}, status_code=400)
        try:
            body = await request.json()
            config_data = body.get("config", body)
            import yaml
            with open(_config_path, "w") as f:
                yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
            _config_cache = config_data
            return JSONResponse({"status": "saved", "config_path": str(_config_path)})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    return JSONResponse({"error": "Method not allowed"}, status_code=405)


async def api_logs(request: Request) -> JSONResponse:
    """Return recent log entries."""
    level = request.query_params.get("level", "").upper()
    limit = int(request.query_params.get("limit", "100"))
    logs = list(_log_buffer)
    if level:
        logs = [entry for entry in logs if entry.get("level", "") == level]
    logs = logs[-limit:]
    return JSONResponse({"logs": logs, "total": len(_log_buffer)})


async def api_usage(request: Request) -> JSONResponse:
    """Return usage statistics."""
    return JSONResponse({
        "usage": _usage_stats,
        "sessions": {
            "total": len(await _datastore.list_sessions()),
            "active": len(_active_tasks),
        },
    })


async def api_debug(request: Request) -> JSONResponse:
    """Debug info — versions, env, loaded modules."""
    import platform
    pkg_versions = {}
    for pkg in ["praisonaiui", "praisonaiagents", "openai", "starlette", "uvicorn"]:
        try:
            from importlib.metadata import version as pkg_version
            pkg_versions[pkg] = pkg_version(pkg)
        except Exception:
            pkg_versions[pkg] = "not installed"
    return JSONResponse({
        "python": sys.version,
        "platform": platform.platform(),
        "packages": pkg_versions,
        "callbacks_registered": list(_callbacks.keys()),
        "agents_registered": list(_agents.keys()),
        "datastore_type": type(_datastore).__name__,
        "config_path": str(_config_path) if _config_path else None,
        "log_buffer_size": len(_log_buffer),
    })


async def api_provider(request: Request) -> JSONResponse:
    """Return provider info: name, health, supported features."""
    provider = get_provider()
    info = {
        "name": type(provider).__name__,
        "module": type(provider).__module__,
    }
    try:
        health_data = await provider.health()
        info.update(health_data)
    except Exception as exc:
        info["health_error"] = str(exc)
    try:
        agents = await provider.list_agents()
        info["agents"] = agents
    except Exception:
        info["agents"] = []
    return JSONResponse(info)


async def api_pages(request: Request) -> JSONResponse:
    """List registered dashboard pages (protocol-driven)."""
    # Sort by order within each group
    pages = sorted(_pages.values(), key=lambda p: (p.get("order", 100), p["id"]))
    return JSONResponse({"pages": pages})


async def api_features(request: Request) -> JSONResponse:
    """List all registered feature protocols."""
    features = get_features()
    infos = []
    for f in features.values():
        try:
            info = await f.info()
            infos.append(info)
        except Exception:
            infos.append({"name": f.name, "status": "error"})
    return JSONResponse({"features": infos, "count": len(infos)})


async def api_gateway_status(request: Request) -> JSONResponse:
    """GET /api/gateway/status — real gateway connectivity and agent info."""
    try:
        from praisonaiui.features._gateway_ref import get_gateway
        gw = get_gateway()
        if gw is None:
            return JSONResponse({
                "status": "not_connected",
                "connected": False,
                "agents": [],
                "agent_count": 0,
                "message": "Gateway instance not initialized",
            })
        agents = []
        try:
            for aid in gw.list_agents():
                agent = gw.get_agent(aid)
                name = getattr(agent, "name", aid) if agent else aid
                agents.append({"id": aid, "name": name})
        except Exception:
            pass
        return JSONResponse({
            "status": "connected",
            "connected": True,
            "agents": agents,
            "agent_count": len(agents),
        })
    except ImportError:
        return JSONResponse({
            "status": "unavailable",
            "connected": False,
            "agents": [],
            "agent_count": 0,
            "message": "Gateway module not installed",
        })


async def api_page_data(request: Request) -> JSONResponse:
    """Serve data for a custom user-registered page."""
    page_id = request.path_params["page_id"]
    handler = _callbacks.get(f"page:{page_id}")
    if not handler:
        return JSONResponse({"error": f"No handler for page '{page_id}'"}, status_code=404)
    try:
        import asyncio as _aio
        result = handler()
        if _aio.iscoroutine(result):
            result = await result
        if not isinstance(result, dict):
            result = {"data": result}
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


def _get_version() -> str:
    """Get praisonaiui version."""
    try:
        from importlib.metadata import version
        return version("praisonaiui")
    except Exception:
        return "dev"


def track_usage(session_id: str = "unknown", model: str = "unknown", tokens: int = 0):
    """Track token usage stats. Called from callbacks."""
    _usage_stats["total_requests"] += 1
    _usage_stats["total_tokens"] += tokens
    if model not in _usage_stats["by_model"]:
        _usage_stats["by_model"][model] = {"requests": 0, "tokens": 0}
    _usage_stats["by_model"][model]["requests"] += 1
    _usage_stats["by_model"][model]["tokens"] += tokens
    if session_id not in _usage_stats["by_session"]:
        _usage_stats["by_session"][session_id] = {"requests": 0, "tokens": 0}
    _usage_stats["by_session"][session_id]["requests"] += 1
    _usage_stats["by_session"][session_id]["tokens"] += tokens


class LogBufferHandler(logging.Handler):
    """Logging handler that captures log entries into the in-memory buffer."""
    def emit(self, record: logging.LogRecord) -> None:
        entry = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": self.format(record),
        }
        _log_buffer.append(entry)


async def get_starters(request: Request) -> JSONResponse:
    """Return starter messages from registered callback."""
    callback = _callbacks.get("starters")
    if callback:
        try:
            result = callback()
            if asyncio.iscoroutine(result):
                result = await result
            return JSONResponse({"starters": result or []})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    return JSONResponse({"starters": []})


async def get_profiles(request: Request) -> JSONResponse:
    """Return chat profiles from registered callback."""
    callback = _callbacks.get("profiles")
    if callback:
        try:
            result = callback()
            if asyncio.iscoroutine(result):
                result = await result
            return JSONResponse({"profiles": result or []})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    return JSONResponse({"profiles": []})


# Track currently selected profile per session
_selected_profile: dict = {"id": None}


async def select_profile(request: Request) -> JSONResponse:
    """Handle profile selection from UI."""
    try:
        body = await request.json()
        profile_id = body.get("profile_id")
        if not profile_id:
            return JSONResponse({"error": "profile_id required"}, status_code=400)
        _selected_profile["id"] = profile_id
        # Call profile_select callback if registered
        callback = _callbacks.get("profile_select")
        if callback:
            result = callback(profile_id)
            if asyncio.iscoroutine(result):
                await result
        return JSONResponse({"status": "ok", "profile_id": profile_id})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


def get_selected_profile() -> str | None:
    """Get the currently selected profile ID."""
    return _selected_profile.get("id")


async def welcome_handler(request: Request) -> StreamingResponse:
    """Run welcome callback via SSE stream."""
    callback = _callbacks.get("welcome")

    async def event_stream() -> AsyncGenerator[str, None]:
        if callback:
            try:
                # Create a temporary context for welcome
                msg = MessageContext(text="", session_id="")
                stream_queue: asyncio.Queue = asyncio.Queue()
                msg._stream_queue = stream_queue

                async def run_welcome():
                    try:
                        # Set context so aiui.say() works
                        from praisonaiui.callbacks import _set_context
                        _set_context(msg)
                        result = callback()
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        await stream_queue.put({"type": "error", "error": str(e)})
                    finally:
                        from praisonaiui.callbacks import _set_context
                        _set_context(None)
                        await stream_queue.put({"type": "done"})

                task = asyncio.create_task(run_welcome())
                while True:
                    try:
                        event = await asyncio.wait_for(stream_queue.get(), timeout=30.0)
                        if event.get("type") == "done":
                            break
                        yield f"data: {json.dumps(event)}\n\n"
                    except asyncio.TimeoutError:
                        break
                await task
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        yield f"data: {json.dumps({'type': 'end'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def run_agent_by_id(request: Request) -> StreamingResponse:
    """Run a specific agent by ID with SSE streaming."""
    agent_id = request.path_params["agent_id"]
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    body["agent"] = agent_id
    # Delegate to run_agent
    request._body = body
    return await run_agent(request, body)


async def run_agent(request: Request, body: dict = None) -> StreamingResponse:
    """Run an agent with SSE streaming."""
    if body is None:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    message = body.get("message", "")
    session_id = body.get("session_id")
    agent_name = body.get("agent")

    # Create session if not exists
    if not session_id:
        session = await _datastore.create_session()
        session_id = session["id"]
    else:
        existing = await _datastore.get_session(session_id)
        if existing is None:
            session = await _datastore.create_session(session_id)
            session_id = session["id"]

    # Add user message to session
    await _datastore.add_message(session_id, {
        "role": "user",
        "content": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    async def event_stream() -> AsyncGenerator[str, None]:
        """Generate SSE events via the pluggable provider."""
        # Send session info
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"

        provider = get_provider()
        full_response = ""
        tool_step_counter = 0
        seen_tool_ids: set = set()
        collected_tool_calls: list = []  # Collect for persistence

        # Inject knowledge context if available (non-blocking)
        augmented_message = message
        try:
            from praisonaiui.features.knowledge import get_knowledge_manager
            k_mgr = get_knowledge_manager()
            k_entries = k_mgr.list_all()
            if k_entries:
                k_results = k_mgr.search(message, limit=5)
                if k_results:
                    context_lines = [r.get("text", "") for r in k_results if r.get("text")]
                    if context_lines:
                        context_block = "\n".join(context_lines)
                        augmented_message = (
                            f"[Knowledge Context]\n{context_block}\n"
                            f"[/Knowledge Context]\n\n{message}"
                        )
        except BaseException:
            pass  # Knowledge failures (incl. pyo3 Rust panics) must never break chat

        try:
            async for run_event in provider.run(
                augmented_message,
                session_id=session_id,
                agent_name=agent_name,
            ):
                # Accumulate full response from content events
                if run_event.type == RunEventType.RUN_CONTENT:
                    if run_event.token:
                        full_response += run_event.token
                    elif run_event.content:
                        if full_response:
                            full_response += "\n"
                        full_response += run_event.content
                elif run_event.type == RunEventType.RUN_COMPLETED:
                    # Prefer SDKs final response over accumulated tokens —
                    # this matches what finalizeDelta() shows in the live view.
                    if run_event.content:
                        full_response = run_event.content

                # Enrich tool call events with description/icon/step_number
                if run_event.type in (
                    RunEventType.TOOL_CALL_STARTED,
                    RunEventType.TOOL_CALL_COMPLETED,
                    RunEventType.TEAM_TOOL_CALL_STARTED,
                    RunEventType.TEAM_TOOL_CALL_COMPLETED,
                ):
                    payload = run_event.to_dict()
                    is_completed = run_event.type in (
                        RunEventType.TOOL_CALL_COMPLETED,
                        RunEventType.TEAM_TOOL_CALL_COMPLETED,
                    )
                    if not is_completed:
                        tc_id = payload.get("tool_call_id")
                        if tc_id and tc_id not in seen_tool_ids:
                            tool_step_counter += 1
                            seen_tool_ids.add(tc_id)
                        elif not tc_id:
                            tool_step_counter += 1
                    try:
                        from praisonaiui.features.chat import _enrich_tool_payload
                        _enrich_tool_payload(payload, tool_step_counter, is_completed=is_completed)
                    except ImportError:
                        # Fallback: basic enrichment if chat module unavailable
                        name = payload.get("name", "")
                        payload.setdefault("icon", "🔧")
                        payload.setdefault("description", f"🔧 Using {name}")
                        payload.setdefault("step_number", tool_step_counter)
                    collected_tool_calls.append(payload)
                    yield f"data: {json.dumps(payload)}\n\n"
                else:
                    # Emit the event as SSE
                    yield f"data: {json.dumps(run_event.to_dict())}\n\n"

        except asyncio.CancelledError:
            # Client disconnected
            cancel_cb = _callbacks.get("cancel")
            if cancel_cb:
                try:
                    r = cancel_cb()
                    if asyncio.iscoroutine(r):
                        await r
                except Exception:
                    pass
            yield f"data: {json.dumps({'type': 'run_cancelled'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

        # Save assistant response to session (include tool calls for persistence)
        if full_response:
            msg_data: dict = {
                "role": "assistant",
                "content": full_response,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            if collected_tool_calls:
                msg_data["toolCalls"] = collected_tool_calls
            await _datastore.add_message(session_id, msg_data)

            # Auto-store conversation turn in memory (non-blocking)
            try:
                from praisonaiui.features.memory import get_memory_manager
                mgr = get_memory_manager()
                mgr.store(
                    message,
                    memory_type="short",
                    session_id=session_id,
                    agent_id=agent_name,
                    metadata={"role": "user"},
                )
                mgr.store(
                    full_response,
                    memory_type="short",
                    session_id=session_id,
                    agent_id=agent_name,
                    metadata={"role": "assistant"},
                )
            except Exception:
                pass  # Memory failures must never break chat

        yield f"data: {json.dumps({'type': 'end'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def cancel_run(request: Request) -> JSONResponse:
    """Cancel an active run for a session (server-side abort).

    This endpoint allows clients to cancel an ongoing LLM call,
    stopping the task and cleaning up resources.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    session_id = body.get("session_id")
    if not session_id:
        return JSONResponse({"error": "session_id required"}, status_code=400)

    task = _active_tasks.get(session_id)
    if task and not task.done():
        task.cancel()
        _active_tasks.pop(session_id, None)
        return JSONResponse({
            "status": "cancelled",
            "session_id": session_id,
        })

    return JSONResponse({
        "status": "no_active_run",
        "session_id": session_id,
    })


class MessageContext:
    """Context object passed to reply callbacks."""

    def __init__(
        self,
        text: str,
        session_id: Optional[str] = None,
        agent_name: Optional[str] = None,
    ):
        self.text = text
        self.content = text  # Alias for compatibility
        self.session_id = session_id
        self.agent_name = agent_name
        self._stream_queue: Optional[asyncio.Queue] = None
        self._response_queue: Optional[asyncio.Queue] = None
        self._pending_ask: Optional[asyncio.Future] = None

    def __str__(self) -> str:
        return self.text

    def __repr__(self) -> str:
        return (
            f"MessageContext(text={self.text!r}, "
            f"session_id={self.session_id!r}, "
            f"agent_name={self.agent_name!r})"
        )

    def reply(self, text: str) -> str:
        """Return a reply string.

        Convenience helper so handlers can write ``return msg.reply('...')``.
        """
        return text

    async def stream(self, token: str) -> None:
        """Stream a token to the client."""
        if self._stream_queue:
            await self._stream_queue.put({"type": "token", "token": token})

    async def think(self, step: str) -> None:
        """Send a thinking/reasoning step."""
        if self._stream_queue:
            await self._stream_queue.put({"type": "thinking", "step": step})

    async def tool(self, name: str, args: dict = None, result: Any = None) -> None:
        """Send a tool call event."""
        if self._stream_queue:
            await self._stream_queue.put({
                "type": "tool_call",
                "name": name,
                "args": args or {},
                "result": result,
            })

    async def ask(self, question: str, options: list = None, timeout: float = 300.0) -> str:
        """Ask user a question and wait for response.

        Args:
            question: The question to ask
            options: Optional list of choices
            timeout: Timeout in seconds (default 5 minutes)

        Returns:
            The user's response text
        """
        if not self._stream_queue:
            return ""

        # Create a future to wait for the response
        loop = asyncio.get_event_loop()
        self._pending_ask = loop.create_future()

        # Send the ask event to the client
        await self._stream_queue.put({
            "type": "ask",
            "question": question,
            "options": options or [],
        })

        try:
            # Wait for user response with timeout
            response = await asyncio.wait_for(self._pending_ask, timeout=timeout)
            return response
        except asyncio.TimeoutError:
            return ""
        finally:
            self._pending_ask = None

    def resolve_ask(self, response: str) -> None:
        """Resolve a pending ask with the user's response."""
        if self._pending_ask and not self._pending_ask.done():
            self._pending_ask.set_result(response)


def load_config_from_yaml(config_path: Path) -> Optional[dict]:
    """Load configuration from YAML file."""
    if not config_path.exists():
        return None
    try:
        import yaml
        with open(config_path) as f:
            return yaml.safe_load(f)
    except Exception:
        return None


def _init_gateway_standalone(config: Optional[dict] = None) -> None:
    """Initialize gateway in standalone mode if not already set.

    Gap S1: When running standalone (not via AIUIGateway.start()), we need to
    initialize a gateway so that gateway-dependent features work.

    Tries ``praisonai.gateway.WebSocketGateway`` first (full gateway), then
    falls back to ``StandaloneGateway`` (in-process, no wrapper needed).
    """
    _log = logging.getLogger(__name__)
    try:
        from praisonaiui.features._gateway_ref import get_gateway, set_gateway

        # Skip if gateway already initialized (e.g., by AIUIGateway.start())
        if get_gateway() is not None:
            return

        gw = None

        # Strategy 1: Full WebSocketGateway from praisonai wrapper
        try:
            from praisonai.gateway import WebSocketGateway

            gateway_config = {}
            if config and isinstance(config, dict):
                gateway_config = config.get("gateway", {})

            if gateway_config:
                gw = WebSocketGateway(
                    host=gateway_config.get("host", "127.0.0.1"),
                    port=gateway_config.get("port", 8765),
                )
            else:
                gw = WebSocketGateway()

            set_gateway(gw)
            _log.info("Gateway auto-initialized (WebSocketGateway)")
        except ImportError as exc:
            _log.info(
                "praisonai.gateway not available (%s) — using StandaloneGateway",
                exc,
            )

        # Strategy 2: Lightweight StandaloneGateway (no praisonai needed)
        if gw is None:
            try:
                from praisonaiui.features._standalone_gateway import (
                    StandaloneGateway,
                )

                gw = StandaloneGateway()
                set_gateway(gw)
                _log.info(
                    "Gateway auto-initialized (StandaloneGateway — "
                    "in-process, no praisonai wrapper)"
                )
            except Exception as exc:
                _log.warning("Could not create StandaloneGateway: %s", exc)

        if gw is None:
            _log.warning(
                "No gateway available — 35+ gateway-dependent features "
                "will be degraded (cron, channels, agents, etc.)"
            )
    except ImportError:
        # _gateway_ref module not available
        pass


class AuthEnforcementMiddleware:
    """Optional middleware that enforces auth on /api/* routes when AUTH_ENFORCE=true."""

    EXEMPT_PATHS = {
        "/health", "/api/health",
        "/api/auth/login", "/login",
        "/api/protocol", "/api/protocol/negotiate",
    }

    def __init__(self, app):
        self.app = app
        self.enforce = os.environ.get("AUTH_ENFORCE", "").lower() in ("true", "1", "yes")

    async def __call__(self, scope, receive, send):
        if self.enforce and scope["type"] == "http":
            path = scope.get("path", "")
            if path.startswith("/api/") and path not in self.EXEMPT_PATHS:
                # Check for Bearer token in Authorization header
                headers = dict(scope.get("headers", []))
                auth_header = headers.get(b"authorization", b"").decode()
                if not auth_header.startswith("Bearer "):
                    # Return 401 Unauthorized
                    response = JSONResponse(
                        {"error": "Authorization required",
                         "hint": "Set Authorization: Bearer <token>"},
                        status_code=401,
                    )
                    await response(scope, receive, send)
                    return
                else:
                    token = auth_header[7:]
                    from praisonaiui.features.auth import verify_api_key
                    if not verify_api_key(token):
                        response = JSONResponse(
                            {"error": "Invalid or expired token"},
                            status_code=401,
                        )
                        await response(scope, receive, send)
                        return
        await self.app(scope, receive, send)


def create_app(
    config: Optional[dict] = None,
    static_dir: Optional[Path] = None,
    require_auth: bool = False,
    config_path: Optional[Path] = None,
) -> Starlette:
    """Create the Starlette application."""
    from praisonaiui.auth import (
        AuthMiddleware,
        login_handler,
        logout_handler,
        me_handler,
        register_handler,
    )

    # Load config from YAML if path provided
    if config_path and config is None:
        config = load_config_from_yaml(config_path)

    # Extract auth settings from config
    if config:
        auth_config = config.get("auth", {})
        if auth_config.get("requireAuth") or auth_config.get("require_auth"):
            require_auth = True

    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        ),
    ]

    # Add optional AUTH_ENFORCE middleware (env var driven)
    middleware.append(Middleware(AuthEnforcementMiddleware))

    if require_auth:
        middleware.append(
            Middleware(
                AuthMiddleware,
                require_auth=True,
                exclude_paths=["/health", "/login", "/register", "/"],
            )
        )

    # Store config path globally for the config endpoint
    global _config_path, _config_cache
    _config_path = config_path
    # Default to standard config location if not explicitly provided
    if _config_path is None:
        _default_cfg = _get_data_dir() / "config.yaml"
        if _default_cfg.exists():
            _config_path = _default_cfg
    if config:
        _config_cache = config

    # Install log buffer handler to capture logs for /api/logs
    _install_log_handler()

    # ── Dynamic JSON config endpoints ──────────────────────────────
    # The React frontend ALWAYS fetches these 3 JSON files before rendering.
    # In docs mode the compiler generates static files. In dashboard/chat/agents
    # modes we serve dynamic responses so the frontend knows which style to use.
    global _effective_style
    effective_style = _style or "dashboard"  # default when running server directly
    if config and isinstance(config, dict):
        effective_style = config.get("style", effective_style)
    _effective_style = effective_style  # share with _plugins_config()

    async def _ui_config_json(request: Request) -> JSONResponse:
        # Branding: YAML config overrides defaults, set_branding() overrides YAML
        _title = _branding["title"]
        _logo = _branding["logo"]
        _debug = True
        try:
            from praisonaiui.config_store import get_config_store
            _cs = get_config_store()
            _site_section = _cs.get_section("site") if _cs else {}
            if _site_section:
                _title = _site_section.get("title", _title)
                _logo = _site_section.get("logo", _logo)
            # Read debug flag from config.yaml top-level key (default: True)
            if _cs:
                _dbg_val = _cs.get_section("debug")
                if _dbg_val is not None:
                    _debug = bool(_dbg_val)
        except Exception:
            pass
        # Theme: set_theme() > YAML site.theme > defaults
        _theme_cfg = _theme  # Python API takes priority
        if not _theme_cfg:
            try:
                _theme_section = _site_section.get("theme") if _site_section else None
                if _theme_section and isinstance(_theme_section, dict):
                    _theme_cfg = _theme_section
            except Exception:
                pass
        if not _theme_cfg:
            _theme_cfg = {"preset": "zinc", "darkMode": True, "radius": "md"}

        # Custom CSS: set_custom_css() > YAML site.custom_css
        _css = _custom_css
        if not _css:
            try:
                _css = _site_section.get("custom_css") or _site_section.get("customCss") if _site_section else None
            except Exception:
                pass

        # Dashboard config: set_dashboard() > YAML dashboard section > defaults
        _dash_cfg = _dashboard_config  # Python API takes priority
        if not _dash_cfg:
            try:
                _dash_section = _cs.get_section("dashboard") if _cs else None
                if _dash_section and isinstance(_dash_section, dict):
                    _dash_cfg = {
                        "sidebar": _dash_section.get("sidebar", _dash_section.get("sidebar", True)),
                        "pageHeader": _dash_section.get("pageHeader", _dash_section.get("page_header", True)),
                    }
            except Exception:
                pass

        # Chat mode config
        _chat_mode_cfg = _chat_mode or {"mode": "fullpage"}

        # Brand color
        _brand = _brand_color

        return JSONResponse({
            "style": effective_style,
            "site": {
                "title": _title,
                "logo": _logo,
                "theme": _theme_cfg,
                "customCss": _css,
                **({
                    "brandColor": _brand,
                } if _brand else {}),
            },
            "chat": {
                "enabled": effective_style in ("chat", "agents", "playground", "dashboard"),
                "mode": _chat_mode_cfg,
                **({
                    "features": _chat_features,
                } if _chat_features else {}),
            },
            **({
                "dashboard": _dash_cfg,
            } if _dash_cfg else {}),
            "debug": _debug,
        })

    async def _docs_nav_json(request: Request) -> JSONResponse:
        return JSONResponse({"items": []})

    async def _route_manifest_json(request: Request) -> JSONResponse:
        return JSONResponse({})

    routes = [
        Route("/health", health, methods=["GET"]),
        Route("/api/health", health, methods=["GET"]),
        Route("/login", login_handler, methods=["POST"]),
        Route("/register", register_handler, methods=["POST"]),
        Route("/logout", logout_handler, methods=["POST"]),
        Route("/me", me_handler, methods=["GET"]),
        Route("/agents", list_agents, methods=["GET"]),
        Route("/api/agents", list_agents, methods=["GET"]),
        Route("/starters", get_starters, methods=["GET"]),
        Route("/profiles", get_profiles, methods=["GET"]),
        Route("/profiles/select", select_profile, methods=["POST"]),
        Route("/welcome", welcome_handler, methods=["POST"]),
        Route("/sessions", list_sessions, methods=["GET"]),
        Route("/sessions", create_session, methods=["POST"]),
        Route("/sessions/{session_id}", get_session, methods=["GET"]),
        Route("/sessions/{session_id}", patch_session, methods=["PATCH"]),
        Route("/sessions/{session_id}", delete_session, methods=["DELETE"]),
        Route("/sessions/{session_id}/runs", get_session_runs, methods=["GET"]),
        Route("/run", run_agent, methods=["POST"]),
        Route("/cancel", cancel_run, methods=["POST"]),
        Route("/agents/{agent_id}/runs", run_agent_by_id, methods=["POST"]),
        Route("/api/agents/{agent_id}/runs", run_agent_by_id, methods=["POST"]),
        # Dashboard API
        Route("/api/overview", api_overview, methods=["GET"]),
        Route("/api/status", api_overview, methods=["GET"]),  # alias for CLI parity
        Route("/api/config", api_config_handler, methods=["GET", "PUT"]),
        Route("/api/logs", api_logs, methods=["GET"]),
        # Note: /api/usage is now provided by PraisonAIUsage feature
        Route("/api/debug", api_debug, methods=["GET"]),
        Route("/api/provider", api_provider, methods=["GET"]),
        # Page registry protocol
        Route("/api/pages", api_pages, methods=["GET"]),
        Route("/api/pages/{page_id}/data", api_page_data, methods=["GET"]),
        # Feature protocol registry
        Route("/api/features", api_features, methods=["GET"]),
        # Gateway status
        Route("/api/gateway/status", api_gateway_status, methods=["GET"]),
        # Frontend config JSON (dynamic fallback — static files override if present)
        Route("/ui-config.json", _ui_config_json, methods=["GET"]),
        Route("/docs-nav.json", _docs_nav_json, methods=["GET"]),
        Route("/route-manifest.json", _route_manifest_json, methods=["GET"]),
    ]

    # ── Gap S1: Auto-initialize gateway in standalone mode ──────────
    # When running standalone (not via AIUIGateway.start()), we need to
    # initialize a gateway so that gateway-dependent features work.
    _init_gateway_standalone(config)

    # ── Initialize unified YAML config store ────────────────────────
    # All CRUD features (agents, skills, etc.) persist their state to
    # a single YAML file (AIUI_DATA_DIR/config.yaml or ~/.praisonaiui/config.yaml).
    # Features load lazily via get_config_store() on first access.
    try:
        from praisonaiui.config_store import init_config_store
        _default_data_dir = _get_data_dir()
        _config_store = init_config_store(_default_data_dir / "config.yaml")

        # Connect hot-reload watcher to the config store YAML file
        try:
            from praisonaiui.features.config_hot_reload import (
                ConfigWatcher, set_config_watcher,
            )
            def _on_config_reload():
                """Reload config store and reset feature lazy-load flags."""
                _config_store.reload()
                # Reset agent registry so it re-reads from store
                try:
                    from praisonaiui.features.agents import get_agent_registry
                    reg = get_agent_registry()
                    if hasattr(reg, "_config_loaded"):
                        reg._config_loaded = False
                except Exception:
                    pass
                # Reset skills lazy-load
                try:
                    from praisonaiui.features import skills as _skills_mod
                    _skills_mod._skills_loaded = False
                except Exception:
                    pass
                # Reload channels from config and reset auto-start flag
                try:
                    from praisonaiui.features.channels import (
                        _channels, _CHANNELS_SECTION, ChannelsFeature,
                    )
                    from praisonaiui.features._persistence import load_section
                    updated = load_section(_CHANNELS_SECTION)
                    _channels.clear()
                    _channels.update(updated)
                    ChannelsFeature._auto_started = False
                except Exception:
                    pass

            watcher = ConfigWatcher(
                config_path=_config_store.path,
                poll_interval=3.0,
            )
            watcher.on_reload(_on_config_reload)
            set_config_watcher(watcher)
        except Exception:
            pass
    except Exception as e:
        import logging as _log
        _log.getLogger(__name__).warning("Failed to init config store: %s", e)

    # Legacy: keep usage persistence via its own JSON (not yet migrated)
    try:
        from praisonaiui.features.usage import set_data_file as set_usage_data_file
        set_usage_data_file(_get_data_dir() / "usage.json")
    except ImportError:
        pass

    # ── Auto-register and mount feature protocol routes ──────────────
    auto_register_defaults()
    for feature in get_features().values():
        routes.extend(feature.routes())

    # Register built-in dashboard pages via the same protocol
    _builtin_pages = [
        {"id": "overview", "title": "Overview", "icon": "📊", "group": "Control",
         "description": "System health and statistics", "order": 10},
        {"id": "chat", "title": "Chat", "icon": "💬", "group": "Agent",
         "description": "AI agent chat", "order": 1},
        {"id": "channels", "title": "Channels", "icon": "📡", "group": "Agent",
         "description": "Messaging platform connections", "order": 5},
        {"id": "sessions", "title": "Sessions", "icon": "📋", "group": "Control",
         "description": "Manage conversation sessions", "order": 20},
        {"id": "usage", "title": "Usage", "icon": "📈", "group": "Control",
         "description": "Token usage and metrics", "order": 30},
        {"id": "cron", "title": "Cron", "icon": "⏰", "group": "Agent",
         "description": "Scheduled jobs", "order": 35},
        {"id": "jobs", "title": "Jobs", "icon": "📋", "group": "Control",
         "description": "Async agent jobs", "order": 40},
        {"id": "approvals", "title": "Approvals", "icon": "✅", "group": "Control",
         "description": "Execution approval queue", "order": 45},
        {"id": "api", "title": "API", "icon": "🔌", "group": "Control",
         "description": "OpenAI-compatible API endpoints", "order": 50},
        {"id": "agents", "title": "Agents", "icon": "🤖", "group": "Agent",
         "description": "Configured AI agents", "order": 10},
        {"id": "skills", "title": "Skills", "icon": "⚡", "group": "Agent",
         "description": "Agent skills & plugins", "order": 20},
        {"id": "memory", "title": "Memory", "icon": "🧠", "group": "Agent",
         "description": "Agent memory & knowledge store", "order": 25},
        {"id": "knowledge", "title": "Knowledge", "icon": "📚", "group": "Agent",
         "description": "Knowledge base & RAG", "order": 27},
        {"id": "nodes", "title": "Nodes", "icon": "🖥️", "group": "Control",
         "description": "Execution nodes & presence", "order": 15},
        {"id": "config", "title": "Config", "icon": "⚙️", "group": "Settings",
         "description": "Server configuration", "order": 10},
        {"id": "auth", "title": "Auth", "icon": "🔐", "group": "Settings",
         "description": "Authentication settings", "order": 15},
        {"id": "logs", "title": "Logs", "icon": "📜", "group": "Settings",
         "description": "Server logs and events", "order": 20},
        {"id": "debug", "title": "Debug", "icon": "🐛", "group": "Settings",
         "description": "Debug information", "order": 30},
        {"id": "guardrails", "title": "Guardrails", "icon": "🛡️", "group": "Agent",
         "description": "Input/output safety guardrails", "order": 35},
        {"id": "eval", "title": "Eval", "icon": "📊", "group": "Control",
         "description": "Agent evaluation & accuracy", "order": 40},
        {"id": "telemetry", "title": "Telemetry", "icon": "📈", "group": "Settings",
         "description": "Performance monitoring & profiling", "order": 25},
        {"id": "traces", "title": "Traces", "icon": "🔍", "group": "Settings",
         "description": "Distributed tracing & observability", "order": 27},
        {"id": "security", "title": "Security", "icon": "🔒", "group": "Settings",
         "description": "Security monitoring & audit log", "order": 12},
        {"id": "inspector", "title": "Inspector", "icon": "🔍", "group": "Control",
         "description": "Interactive API inspector", "order": 99, "position": "footer"},
        {"id": "theme-picker", "title": "Theme", "icon": "🎨", "group": "Settings",
         "description": "Live color scheme picker", "order": 35},
    ]
    _page_api_overrides = {"sessions": "/sessions", "cron": "/api/schedules", "channels": "/api/channels"}

    # Read page whitelist from config.yaml if set_pages() was not called
    if _enabled_pages is None:
        try:
            from praisonaiui.config_store import get_config_store
            _cfg = get_config_store()
            _pages_cfg = _cfg.get("pages", {}) if _cfg else {}
            if isinstance(_pages_cfg, dict):
                _enabled_list = _pages_cfg.get("enabled")
                _disabled_list = _pages_cfg.get("disabled")
                if _enabled_list and isinstance(_enabled_list, list):
                    set_pages(_enabled_list)
                elif _disabled_list and isinstance(_disabled_list, list):
                    # Blacklist: all pages except disabled ones
                    set_pages([p["id"] for p in _builtin_pages if p["id"] not in _disabled_list])
        except (ImportError, Exception):
            pass

    for p in _builtin_pages:
        if p["id"] in _pages:  # user already overrode this page
            continue
        # If whitelist is set, skip pages not in the whitelist
        if _enabled_pages is not None and p["id"] not in _enabled_pages:
            continue
        _pages[p["id"]] = {
            **p,
            "api_endpoint": _page_api_overrides.get(p["id"], f"/api/{p['id']}"),
        }

    # Always mount built-in frontend plugins and assets BEFORE catch-all /
    _frontend_dir = Path(__file__).parent / "templates" / "frontend"
    _plugins_dir = _frontend_dir / "plugins"
    _assets_dir = _frontend_dir / "assets"

    # Dynamic plugins.json route — MUST come before static /plugins mount
    # so the dynamic endpoint takes priority over the static file.
    routes.append(Route("/plugins/plugins.json", _plugins_config, methods=["GET"]))

    if _plugins_dir.exists():
        routes.append(Mount("/plugins", app=StaticFiles(directory=str(_plugins_dir))))
    if _assets_dir.exists():
        routes.append(Mount("/assets", app=StaticFiles(directory=str(_assets_dir))))

    # Add static file serving if static_dir provided (catch-all, must be last)
    # Wrap StaticFiles so WebSocket requests don't crash with AssertionError
    # (StaticFiles only handles HTTP, not WebSocket scope types)
    if static_dir and static_dir.exists():
        # For non-docs styles, always serve _build_html for root "/" instead
        # of the static index.html.  The static index.html includes React but
        # NOT plugin-loader.js, which breaks dashboard/chat/agents/playground.
        if _effective_style != "docs":
            routes.append(Route("/", _serve_index, methods=["GET"]))

        _static_app = StaticFiles(directory=str(static_dir), html=True)

        async def _http_only_static(scope, receive, send):
            if scope["type"] != "http":
                # Reject non-HTTP (WebSocket) gracefully instead of crashing
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                return

            # Try StaticFiles first; on 404, fall back to SPA index
            # (paths like /chat, /memory don't have static files but need
            # the SPA shell so JS routing can take over).
            response_started = False
            response_status = 0
            response_headers = []
            response_body = b""

            async def _capture_send(message):
                nonlocal response_started, response_status, response_headers, response_body
                if message["type"] == "http.response.start":
                    response_status = message.get("status", 200)
                    response_headers = message.get("headers", [])
                    response_started = True
                elif message["type"] == "http.response.body":
                    response_body += message.get("body", b"")

            try:
                await _static_app(scope, receive, _capture_send)
            except Exception:
                response_status = 404

            if response_status == 404:
                # SPA fallback — serve the generated index page
                from starlette.responses import HTMLResponse
                style = _effective_style  # Single source of truth
                html_content = _build_html(style)
                response = HTMLResponse(html_content)
                await response(scope, receive, send)
            else:
                # Forward the captured response as-is
                await send({
                    "type": "http.response.start",
                    "status": response_status,
                    "headers": response_headers,
                })
                await send({
                    "type": "http.response.body",
                    "body": response_body,
                })

        routes.append(Mount("/", app=_http_only_static))
    else:
        # No static_dir — serve SDK-generated HTML (dashboard, chat, etc.)
        routes.append(Route("/", _serve_index, methods=["GET"]))
        # Catch-all for SPA path-based routing (e.g. /chat, /memory, /knowledge)
        routes.append(Route("/{path:path}", _serve_index, methods=["GET"]))

    app = Starlette(
        routes=routes,
        middleware=middleware,
    )

    return app


def _install_log_handler():
    """Install the log buffer handler on the root logger.

    Installs BOTH the server-local LogBufferHandler (for /api/logs legacy)
    and the feature's WebSocketLogHandler (for the Logs page websocket).
    """
    handler = LogBufferHandler()
    handler.setFormatter(logging.Formatter("%(name)s - %(message)s"))
    handler.setLevel(logging.INFO)
    root = logging.getLogger()
    # Avoid duplicate handlers
    if not any(isinstance(h, LogBufferHandler) for h in root.handlers):
        root.addHandler(handler)

    # Also install the feature WebSocket handler so the /logs page works
    try:
        from praisonaiui.features.logs import install_log_handler as _install_ws
        _install_ws()
    except ImportError:
        pass
