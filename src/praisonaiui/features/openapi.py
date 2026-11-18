"""This server's own OpenAPI 3.1 document, built from its live route table.

``GET /api/openapi.json`` walks the routes the running app serves (the core,
every enabled feature, the built-ins' host routes and the plugins' routes)
when it is asked, so the document lists exactly what this server answers and
cannot drift from the code. Owned by ``builtin.api-reference``, whose API
Reference page (app shell) renders it and sends requests to this server.

- Tags: the built-in record that owns a route (``sessions``, ``api``…), a
  third-party feature's or plugin's name, else ``core``.
- Summary and description: the handler's docstring (first line, then the
  rest), read as plain text; a leading ``"POST /path — "`` is dropped.
- Path parameters from the route's convertors (``int`` → integer…).
- ``security``: bearer token, except on the public surface
  (``http_guard``), which gets ``security: []``.
- A plugin's routes the caller may not use (default-deny plugins) are left
  out. WebSocket routes are listed under ``x-websockets``.
- A feature may add request bodies and responses with an optional
  ``openapi()`` hook: ``{"POST /v1/chat/completions": {operation fields}}``.

The route follows the same auth as every other ``/api`` route.
"""

from __future__ import annotations

import inspect
import re
from typing import Any, Dict, Iterator, List, Optional, Tuple

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route, WebSocketRoute

from ._base import BaseFeatureProtocol

_OPS = ("get", "put", "post", "delete", "patch", "options")
_PARAM_TYPES = {
    "IntegerConvertor": {"type": "integer"},
    "FloatConvertor": {"type": "number"},
    "UUIDConvertor": {"type": "string", "format": "uuid"},
}
# "POST /v1/chat/completions — Chat completions": the method and path repeat
# what the document already says.
_LEAD = re.compile(r"^(?:[A-Z]+(?:/[A-Z]+)*|WebSocket)\s+/\S*\s*(?:[—–:-]+\s*)?")
# Starlette's "{name:path}" is "{name}" in OpenAPI.
_CONVERTOR = re.compile(r"\{(\w+):\w+\}")
_CORE_TAG = ("core", "Health, sign-in, sessions, runs, pages and the app shell")


def _documented(path: str) -> bool:
    """API routes only: not the page, static files or the SPA fallback."""
    from praisonaiui.http_guard import PUBLIC_PREFIXES

    if path.startswith(("/api/", "/v1")):
        return True
    if path == "/" or path.startswith(PUBLIC_PREFIXES) or ":path}" in path:
        return False
    return "." not in path.rsplit("/", 1)[-1]


def _walk(routes: List[Any], prefix: str, scope: dict) -> Iterator[Tuple[str, Any, str]]:
    """``(path, route, plugin)`` for every route this request could reach."""
    for route in routes:
        if isinstance(route, (Route, WebSocketRoute)):
            yield prefix + route.path, route, ""
        elif isinstance(route, Mount):
            app, plugin = route.app, ""
            rec = getattr(app, "rec", None)
            if rec is not None and hasattr(app, "registry"):  # a plugin's gated mount
                try:
                    restricted = bool(app.is_restricted(scope)) if app.is_restricted else False
                    if not app.registry.js_allowed(rec, restricted=restricted):
                        continue
                except Exception:  # noqa: BLE001 - fail closed: leave it out
                    continue
                app, plugin = app.app, rec.name
            for path, sub, owner in _walk(list(getattr(app, "routes", None) or ()), prefix + route.path, scope):
                yield path, sub, owner or plugin


def _methods(route: Route) -> List[str]:
    if route.methods:
        return [m.lower() for m in route.methods if m.lower() in _OPS]
    # A class endpoint (HTTPEndpoint) answers the methods it defines.
    return [m for m in _OPS if callable(getattr(route.endpoint, m, None))]


def _owners() -> Tuple[Dict[Tuple[str, str], str], Dict[str, str], Dict[str, dict]]:
    """``(path, method) → tag``, tag descriptions, and the features' ``openapi()`` extras."""
    from praisonaiui.builtin.catalog import BUILTIN_PLUGINS
    from praisonaiui.features import get_features
    from praisonaiui.plugin_registry import get_plugin_registry

    by_cls = {ref.cls: p for p in BUILTIN_PLUGINS for ref in p.feature_refs}
    owners: Dict[Tuple[str, str], str] = {}
    tags: Dict[str, str] = {_CORE_TAG[0]: _CORE_TAG[1]}
    extras: Dict[str, dict] = {}

    def own(routes: List[Any], tag: str, description: str) -> None:
        tags.setdefault(tag, description)
        for r in routes:
            for m in _methods(r) if isinstance(r, Route) else ["ws"]:
                owners.setdefault((r.path, m), tag)

    for rec in get_plugin_registry().builtin_records():
        host = getattr(rec.plugin, "host_routes", None)
        if rec.status == "ok" and callable(host):
            try:
                own(list(host()), rec.plugin.name, rec.plugin.description)
            except Exception:  # noqa: BLE001 - its routes then read as core
                pass
    for feat in get_features().values():
        record = by_cls.get(type(feat).__name__)
        try:
            routes = list(feat.routes())
            hook = getattr(feat, "openapi", None)
            extras.update(hook() if callable(hook) else {})
        except Exception:  # noqa: BLE001 - one feature never breaks the document
            continue
        if record is not None:
            own(routes, record.name, record.description)
        else:
            own(routes, feat.name, feat.description)
    return owners, tags, extras


def _texts(endpoint: Any) -> Tuple[str, str]:
    doc = inspect.getdoc(endpoint) or ""
    first, _, rest = doc.strip().partition("\n")
    summary = _LEAD.sub("", first.strip()).rstrip(".")
    if not summary:
        name = getattr(endpoint, "__name__", "") or type(endpoint).__name__
        words = re.sub(r"^(?:api|handle)_|_handler$", "", name.strip("_")).replace("_", " ")
        summary = words[:1].upper() + words[1:]
    return summary, rest.strip()


def _public(path: str, method: str, endpoint: Any) -> bool:
    from praisonaiui.http_guard import (
        PUBLIC_API_PREFIXES,
        PUBLIC_ATTR,
        PUBLIC_EXACT_PATHS,
        PUBLIC_PREFIXES,
    )

    if path in PUBLIC_EXACT_PATHS:
        return True
    if method != "get":
        return False
    if path.startswith(PUBLIC_PREFIXES + PUBLIC_API_PREFIXES):
        return True
    return not path.startswith("/api/") and getattr(endpoint, PUBLIC_ATTR, None) is True


def build_spec(app: Any, scope: Optional[dict] = None) -> Dict[str, Any]:
    """The OpenAPI 3.1 document of *app* as the request in *scope* sees it."""
    from praisonaiui import __version__

    scope = scope or {"type": "http", "path": "/api/openapi.json", "headers": []}
    owners, tag_text, extras = _owners()
    paths: Dict[str, Dict[str, Any]] = {}
    sockets: List[Dict[str, str]] = []
    used: Dict[str, None] = {}
    for path, route, plugin in _walk(list(getattr(app, "routes", ())), "", scope):
        if not _documented(path):
            continue
        summary, description = _texts(route.endpoint)
        path = _CONVERTOR.sub(r"{\1}", path)
        if isinstance(route, WebSocketRoute):
            tag = plugin or owners.get((route.path, "ws")) or _CORE_TAG[0]
            sockets.append({"path": path, "tag": tag, "summary": summary})
            used[tag] = None
            continue
        params = [
            {"name": name, "in": "path", "required": True, "schema": dict(_PARAM_TYPES.get(type(conv).__name__, {"type": "string"}))}
            for name, conv in route.param_convertors.items()
        ]
        for method in _methods(route):
            item = paths.setdefault(path, {})
            if method in item:  # Starlette answers with the first match
                continue
            op_tag = plugin or owners.get((route.path, method)) or _CORE_TAG[0]
            used[op_tag] = None
            op: Dict[str, Any] = {
                "operationId": re.sub(r"[^A-Za-z0-9]+", "_", f"{method} {path}").strip("_"),
                "summary": summary,
                "tags": [op_tag],
                "responses": {"200": {"description": "Success"}},
            }
            if description:
                op["description"] = description
            if params:
                op["parameters"] = [dict(p) for p in params]
            if _public(path, method, route.endpoint):
                op["security"] = []
            op.update(extras.get(f"{method.upper()} {path}", {}))
            item[method] = op
    spec: Dict[str, Any] = {
        "openapi": "3.1.0",
        "info": {
            "title": "aiui server API",
            "version": __version__,
            "description": "Every HTTP route this server answers, read from its live route table.",
        },
        # Relative: requests go to the server that served this document.
        "servers": [{"url": "/"}],
        "tags": [{"name": t, "description": tag_text.get(t, "")} for t in used],
        "paths": {p: paths[p] for p in sorted(paths) if paths[p]},
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "description": "Needed when the server requires sign-in or a token.",
                }
            }
        },
        "security": [{"bearerAuth": []}],
    }
    if sockets:
        spec["x-websockets"] = sockets
    return spec


class ApiReferenceFeature(BaseFeatureProtocol):
    feature_name = "openapi"
    feature_description = "This server's OpenAPI document, read from its live route table"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [Route("/api/openapi.json", self._spec, methods=["GET"])]

    async def _spec(self, request: Request) -> JSONResponse:
        """This server's OpenAPI 3.1 document.

        Lists every route the caller can reach, read from the live route table.
        """
        return JSONResponse(build_spec(request.app, request.scope))
