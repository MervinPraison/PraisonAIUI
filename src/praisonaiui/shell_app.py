"""Shell-only ASGI app factory and inline-script CSP helpers.

Use :func:`create_shell_app` when an application wants PraisonAIUI's React app
shell, selected pages, plugin assets, and custom routes *without* mounting the
general agent server surface (``/sessions``, ``/run``, ``/agents``, ``/teams``,
``/api/chat/*``, or the 48 backend agent features).

:func:`shell_inline_script_hashes`, :func:`shell_csp_header`, and
:func:`render_shell_html` expose the exact ``'sha256-…'`` hashes of the shell's
own inline bootstrap/importmap scripts (reusing
:func:`praisonaiui.compiler.csp.inline_hashes`) so host apps can enforce a
strict ``Content-Security-Policy`` without buffering HTML responses or parsing
``<script>`` tags themselves.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any, Optional, Union

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.routing import BaseRoute, Mount, Route

from praisonaiui.compiler import csp as _csp

logger = logging.getLogger(__name__)

#: Strict default Content-Security-Policy for a mounted shell app.
#: Inline scripts are authorised solely by sha256 hashes computed from the
#: rendered shell HTML (never ``'unsafe-inline'`` in ``script-src``).
STRICT_SHELL_CSP: dict[str, list[str]] = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
}

CspOption = Union[
    None,
    str,
    Mapping[str, Sequence[str]],
    Callable[[str, tuple[str, ...]], str],
]


def shell_inline_script_hashes(html: str) -> tuple[str, ...]:
    """Return sorted ``'sha256-…'`` hashes for every executable inline script in ``html``.

    Non-executed data blocks such as ``<script id="aiui-boot" type="application/json">``
    and external ``<script src="…">`` tags are ignored.
    """
    return tuple(sorted(_csp.inline_hashes(html)))


def shell_csp_header(
    html: str,
    *,
    base: Mapping[str, Sequence[str]] | None = None,
    extra: Mapping[str, Sequence[str]] | None = None,
) -> str:
    """Build a ``Content-Security-Policy`` header value for rendered shell ``html``.

    Starts from :data:`STRICT_SHELL_CSP` (or ``base`` when provided), appends the
    exact ``'sha256-…'`` hashes of the shell's executable inline scripts to
    ``script-src``, merges any ``extra`` directives, and renders the header.
    """
    policy: dict[str, list[str]] = {
        d: list(v) for d, v in (base if base is not None else STRICT_SHELL_CSP).items()
    }
    hashes = shell_inline_script_hashes(html)
    additions: list[tuple[str, Sequence[str]]] = []
    if hashes:
        additions.append(("script-src", hashes))
    if extra:
        additions.extend(extra.items())
    for directive, raw_values in additions:
        values = list(raw_values)
        if "'none'" in values:
            policy[directive] = ["'none'"]
            continue
        have = [v for v in policy.get(directive, []) if v != "'none'"]
        policy[directive] = have + sorted(set(values) - set(have))
    return _csp.render(policy)


def render_shell_html(
    request: Optional[Request] = None,
    *,
    style: str = "app",
) -> tuple[str, tuple[str, ...]]:
    """Render the shell HTML document and return ``(html, inline_script_hashes)``."""
    from praisonaiui import server as srv

    html = srv._build_html(style, request)
    return html, shell_inline_script_hashes(html)


def _resolve_csp(csp: CspOption, html: str, hashes: tuple[str, ...]) -> Optional[str]:
    if csp is None:
        return None
    if callable(csp):
        return csp(html, hashes)
    if isinstance(csp, str):
        if csp == "strict":
            return shell_csp_header(html)
        raise ValueError(
            f"Unsupported csp preset {csp!r}; pass 'strict', a directive mapping, or a callable"
        )
    if isinstance(csp, Mapping):
        return shell_csp_header(html, extra=csp)
    raise TypeError(f"Unsupported csp option of type {type(csp).__name__}")


def _build_shell_middleware(
    config: Optional[dict[str, Any]],
    require_auth: bool,
) -> tuple[list[Middleware], bool]:
    """Construct the same security and auth middleware stack used by create_app (R8)."""
    from praisonaiui import server as srv
    from praisonaiui.auth import (
        AuthMiddleware,
        TokenQueryMiddleware,
        allow_signup_from_config,
        configure_sessions,
    )
    from praisonaiui.http_guard import (
        BodySizeLimitMiddleware,
        HostGuardMiddleware,
        JSONObjectBodyMiddleware,
        OriginGuardMiddleware,
        configured_origins,
        install_secret_redaction,
    )

    config_requires_token = False
    if config:
        auth_config = config.get("auth", {}) or {}
        if auth_config.get("requireAuth") or auth_config.get("require_auth"):
            require_auth = True
        if auth_config.get("requireToken") or auth_config.get("require_token"):
            config_requires_token = True
    configure_sessions(config)

    allowed_origins = configured_origins()
    middleware: list[Middleware] = [
        Middleware(HostGuardMiddleware),
        Middleware(BodySizeLimitMiddleware),
        Middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        ),
        Middleware(OriginGuardMiddleware, allowed_origins=allowed_origins),
    ]
    install_secret_redaction()
    middleware.append(Middleware(srv.AuthEnforcementMiddleware))

    tok = os.environ.get("AIUI_URL_TOKEN") or os.environ.get("GATEWAY_AUTH_TOKEN")
    token_auth_opt_in = (
        os.environ.get("AIUI_REQUIRE_TOKEN", "").lower() in ("true", "1", "yes")
        or config_requires_token
        or require_auth
    )
    if tok and token_auth_opt_in:
        middleware.append(Middleware(TokenQueryMiddleware, expected_token=tok))

    if require_auth:
        middleware.append(
            Middleware(
                AuthMiddleware,
                require_auth=True,
                exclude_paths=["/health", "/login", "/register"],
                allow_signup=allow_signup_from_config(config),
            )
        )

    middleware.append(Middleware(JSONObjectBodyMiddleware))
    auth_required = bool(require_auth or (tok and token_auth_opt_in))
    return middleware, auth_required


def _shell_ui_config_payload() -> dict[str, Any]:
    """Minimal ``/ui-config.json`` payload for shell-only apps."""
    from praisonaiui import server as srv

    site_section = srv._get_site_section() or {}
    title = site_section.get("title", srv._branding["title"])
    logo = site_section.get("logo", srv._branding["logo"])
    theme_cfg = srv._theme or site_section.get("theme") or {
        "preset": "zinc",
        "darkMode": True,
        "radius": "md",
    }
    theme_default = srv._shell_default_theme()
    theme_cfg = {**theme_cfg, "mode": theme_default}
    css = srv._custom_css or site_section.get("custom_css") or site_section.get("customCss")
    dash = srv._resolved_dashboard_config()
    payload: dict[str, Any] = {
        "style": "app",
        "site": {
            "title": title,
            "logo": logo,
            "theme": theme_cfg,
            "themeDefault": theme_default,
            "customCss": css,
            **({"brandColor": srv._brand_color} if srv._brand_color else {}),
        },
        "chat": {"enabled": False, "mode": srv._chat_mode or {"mode": "fullpage"}},
        "debug": False,
    }
    if dash:
        payload["dashboard"] = dash
    return payload


def create_shell_app(
    *,
    config: Optional[dict[str, Any]] = None,
    pages: Optional[Iterable[str]] = None,
    plugins: Optional[Iterable[Any]] = None,
    routes: Optional[Sequence[BaseRoute]] = None,
    csp: CspOption = None,
    require_auth: bool = False,
    config_path: Optional[Path] = None,
) -> Starlette:
    """Create a minimal Starlette app mounting only the React app shell, selected
    pages, plugin assets/routes, and caller-supplied ``routes``.

    Unlike :func:`praisonaiui.server.create_app`, this factory does **not**
    mount the general agent server endpoints (``/sessions``, ``/run``,
    ``/agents``, ``/teams``, ``/api/chat/*``) or auto-register the 48 backend
    agent features; unmatched paths return HTTP ``404``.

    Args:
        config: Optional configuration dictionary (same shape as ``create_app``).
        pages: Built-in page IDs to keep alongside the app's own ``@aiui.page``
            and plugin pages. Defaults to ``[]`` (only your own + plugin pages)
            when neither ``pages`` nor :func:`praisonaiui.set_pages` was set.
        plugins: Optional in-process plugin objects to register before building
            the route table (via :func:`praisonaiui.register_plugin`).
        routes: Optional extra Starlette routes (e.g. host ``/api/*`` endpoints)
            mounted before the shell's SPA page routes.
        csp: Optional ``Content-Security-Policy`` for shell HTML responses:
            ``"strict"`` (strict policy + exact sha256 inline script hashes),
            a directive mapping merged onto :data:`STRICT_SHELL_CSP`, or a
            callable ``(html, hashes) -> header_value``.
        require_auth: Enable session/bearer auth on every non-public route (R8).
        config_path: Optional YAML config file path (loaded when ``config`` is
            ``None``).
    """
    from praisonaiui import server as srv
    from praisonaiui.auth import login_handler, logout_handler, me_handler, register_handler
    from praisonaiui.builtin import register_builtin_plugins
    from praisonaiui.http_guard import json_exception_handlers, mark_public
    from praisonaiui.plugin_registry import get_plugin_registry, register_plugin

    if config_path and config is None:
        config = srv.load_config_from_yaml(config_path)

    middleware, auth_required = _build_shell_middleware(config, require_auth)
    srv._auth_required_by_app = auth_required
    srv._effective_style = "app"
    if config:
        srv._config_cache = config
    if config_path is not None:
        srv._config_path = config_path

    # Register any explicitly supplied in-process plugins.
    registry = get_plugin_registry()
    if plugins is not None:
        for plugin in plugins:
            register_plugin(plugin)

    ext_section = config.get("extensions") if isinstance(config, dict) else None
    registry.apply_config(ext_section)
    register_builtin_plugins(registry)
    srv._sync_yaml_theme_for_shell(config)

    # Apply page scoping: default to only the app's own + plugin pages ([]).
    if pages is not None:
        srv.set_pages(list(pages))
    elif srv._enabled_pages is None:
        srv.set_pages([])

    # Sync built-in pages against the whitelist without touching app pages.
    builtin_specs = registry.pages(origin="builtin")
    builtin_pages = [srv._builtin_page_entry(s) for s in builtin_specs]
    srv._NATIVE_PAGES.clear()
    srv._NATIVE_PAGES.update(s.id for s in builtin_specs if s.kind == "native")
    contributed = {p["id"] for p in builtin_pages}
    whitelist = srv._enabled_pages
    for pid in list(srv._builtin_page_ids):
        if pid in srv._custom_page_ids:
            continue
        if pid not in contributed or (whitelist is not None and pid not in whitelist):
            srv._pages.pop(pid, None)
    for page_entry in builtin_pages:
        if page_entry["id"] in srv._pages:
            continue
        if whitelist is not None and page_entry["id"] not in whitelist:
            continue
        srv._pages[page_entry["id"]] = page_entry
    srv._builtin_page_ids.clear()
    srv._builtin_page_ids.update(
        pid for pid in contributed if pid in srv._pages and pid not in srv._custom_page_ids
    )

    for rec in registry.active():
        setup_fn = getattr(rec.plugin, "setup", None)
        if callable(setup_fn):
            try:
                setup_fn({"style": "app", "config": config or {}})
            except Exception as exc:  # noqa: BLE001
                logger.warning("plugin %s.setup failed: %s", rec.name, exc)

    async def _ui_config(_request: Request) -> JSONResponse:
        return JSONResponse(_shell_ui_config_payload())

    async def _empty_docs_nav(_request: Request) -> JSONResponse:
        return JSONResponse({"items": []})

    async def _empty_route_manifest(_request: Request) -> JSONResponse:
        return JSONResponse({})

    frontend_dir = srv._frontend_templates_dir()
    package_frontend_dir = Path(__file__).parent / "templates" / "frontend"
    icon_file = frontend_dir / "icon.svg"
    if not icon_file.is_file():
        icon_file = package_frontend_dir / "icon.svg"

    async def _serve_icon(_request: Request) -> Response:
        if icon_file.is_file():
            return FileResponse(str(icon_file), media_type="image/svg+xml")
        return JSONResponse({"error": "Not Found"}, status_code=404)

    def _allowed_page_ids(request: Request) -> set[str]:
        restricted = srv._plugin_js_restricted(getattr(request, "scope", None))
        manifest = srv._build_shell_manifest(restricted=restricted, include_errors=False)
        return {str(p["id"]) for p in manifest.get("pages", []) if isinstance(p, dict) and p.get("id")}

    async def _serve_shell_page(request: Request) -> Response:
        raw_path = request.url.path.strip("/")
        if raw_path:
            # Only serve the SPA shell for single-segment registered page IDs.
            if "/" in raw_path or raw_path not in _allowed_page_ids(request):
                return JSONResponse({"error": "Not Found"}, status_code=404)
        if request.method not in ("GET", "HEAD"):
            return JSONResponse({"error": "Method Not Allowed"}, status_code=405)
        html, hashes = render_shell_html(request, style="app")
        headers: dict[str, str] = {}
        csp_val = _resolve_csp(csp, html, hashes)
        if csp_val:
            headers["Content-Security-Policy"] = csp_val
        return HTMLResponse(html, headers=headers)

    mark_public(_serve_shell_page, when=lambda scope: scope.get("method") in ("GET", "HEAD"))
    mark_public(_serve_icon, when=lambda scope: scope.get("method") in ("GET", "HEAD"))

    app_routes: list[BaseRoute] = []
    # 1. Caller-supplied host routes first.
    if routes:
        app_routes.extend(routes)

    # 2. Minimal health, identity, and auth routes (when auth is active).
    app_routes.extend(
        [
            Route("/health", srv.health, methods=["GET"]),
            Route("/api/health", srv.health_cached, methods=["GET"]),
            Route("/health/live", srv.health_live, methods=["GET"]),
            Route("/health/ready", srv.health_ready, methods=["GET"]),
            Route("/api/health/live", srv.health_live, methods=["GET"]),
            Route("/api/health/ready", srv.health_ready, methods=["GET"]),
            Route("/me", me_handler, methods=["GET"]),
        ]
    )
    if auth_required or os.environ.get("AUTH_ENFORCE", "").lower() in ("true", "1", "yes"):
        app_routes.extend(
            [
                Route("/login", login_handler, methods=["POST"]),
                Route("/register", register_handler, methods=["POST"]),
                Route("/logout", logout_handler, methods=["POST"]),
                Route("/api/auth/ws-ticket", srv.ws_ticket_handler, methods=["POST"]),
            ]
        )

    # 3. Shell manifest, page data/action, component schemas, and config routes.
    app_routes.extend(
        [
            Route("/api/shell/manifest", srv.api_shell_manifest, methods=["GET"]),
            Route("/api/plugins", srv.api_plugins_list, methods=["GET"]),
            Route("/api/pages", srv.api_pages, methods=["GET"]),
            Route("/api/pages/{page_id}/data", srv.api_page_data, methods=["GET"]),
            Route("/api/pages/{page_id}/action", srv.api_page_action, methods=["POST"]),
            Route("/api/components/schemas", srv.api_component_schemas, methods=["GET"]),
            Route("/ui-config.json", _ui_config, methods=["GET"]),
            Route("/docs-nav.json", _empty_docs_nav, methods=["GET"]),
            Route("/route-manifest.json", _empty_route_manifest, methods=["GET"]),
            Route("/plugins/plugins.json", srv._plugins_config, methods=["GET"]),
            Route("/custom.js", srv._serve_custom_js, methods=["GET"]),
            Route("/_aiui/externals/{name}", srv._serve_shell_external, methods=["GET"]),
            Route("/icon.svg", _serve_icon, methods=["GET"]),
        ]
    )

    # 4. Plugin API routes (/api/plugins/<name>/*) and static assets (/_plugins/<name>/*).
    app_routes.extend(registry.starlette_routes(srv._plugin_js_restricted))

    # 5. Packaged frontend assets (/assets/* and /plugins/*).
    plugins_dir = frontend_dir / "plugins"
    if not plugins_dir.is_dir():
        plugins_dir = package_frontend_dir / "plugins"
    assets_dir = frontend_dir / "assets"
    if not assets_dir.is_dir():
        assets_dir = package_frontend_dir / "assets"

    if plugins_dir.exists():
        app_routes.append(
            Mount("/plugins", app=srv.gzip_static(srv.CachedGzipStaticFiles(directory=str(plugins_dir))))
        )
    if assets_dir.exists():
        app_routes.append(
            Mount(
                "/assets",
                app=srv.gzip_static(
                    srv._AssetStaticFiles(directory=str(assets_dir), frontend_dir=frontend_dir)
                ),
            )
        )

    # 6. Registered shell pages only; unknown paths (including /sessions) return 404.
    _ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
    app_routes.append(Route("/", _serve_shell_page, methods=["GET", "HEAD"]))
    app_routes.append(Route("/{path:path}", _serve_shell_page, methods=_ALL_METHODS))

    return Starlette(
        routes=app_routes,
        middleware=middleware,
        exception_handlers=json_exception_handlers(),
    )
