"""Discover and serve third-party dashboard UI plugins (manifest + static assets)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route

logger = logging.getLogger(__name__)

_BUILTIN_PLUGIN_ROOT = (
    Path(__file__).resolve().parent / "templates" / "frontend" / "dashboard-plugins"
)


def _plugin_search_dirs(extra_dirs: list[str] | None = None) -> list[Path]:
    dirs: list[Path] = []
    home = Path.home() / ".praisonai" / "dashboard-plugins"
    if home.is_dir():
        dirs.append(home)
    if _BUILTIN_PLUGIN_ROOT.is_dir():
        dirs.append(_BUILTIN_PLUGIN_ROOT)
    for raw in extra_dirs or []:
        p = Path(raw).expanduser()
        if p.is_dir():
            dirs.append(p)
    return dirs


def discover_dashboard_plugins(extra_dirs: list[str] | None = None) -> list[dict[str, Any]]:
    """Scan dashboard-plugins folders for manifest.json files."""
    manifests: list[dict[str, Any]] = []
    seen: set[str] = set()

    for root in _plugin_search_dirs(extra_dirs):
        for child in sorted(root.iterdir()):
            if not child.is_dir():
                continue
            manifest_path = child / "manifest.json"
            if not manifest_path.is_file():
                continue
            try:
                data = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Invalid dashboard plugin manifest %s: %s", manifest_path, exc)
                continue
            name = data.get("name") or child.name
            if name in seen:
                continue
            seen.add(name)
            tab = data.get("tab") or {}
            path = tab.get("path") or f"/{name}"
            page_id = path.strip("/").split("/")[0] or name
            manifests.append(
                {
                    "name": name,
                    "label": data.get("label", name),
                    "description": data.get("description", ""),
                    "icon": data.get("icon", "📦"),
                    "version": data.get("version", "0.0.0"),
                    "entry": data.get("entry", "index.js"),
                    "css": data.get("css"),
                    "has_api": bool(data.get("api")),
                    "tab": tab,
                    "root": str(child.resolve()),
                    "page": {
                        "id": page_id,
                        "title": data.get("label", name),
                        "icon": data.get("icon", "📦"),
                        "group": data.get("group", "Plugins"),
                        "description": data.get("description", ""),
                    },
                }
            )
    return manifests


def _resolve_plugin_file(name: str, subpath: str, extra_dirs: list[str] | None) -> Path | None:
    for manifest in discover_dashboard_plugins(extra_dirs):
        if manifest["name"] != name:
            continue
        root = Path(manifest["root"])
        target = (root / subpath).resolve()
        if not str(target).startswith(str(root.resolve())):
            return None
        if target.is_file():
            return target
    return None


def make_dashboard_plugin_routes(
    get_extra_dirs,
) -> list[Route]:
    """Factory: ``get_extra_dirs`` returns plugin dir list from server config."""

    async def list_plugins(request: Request) -> JSONResponse:
        extra = get_extra_dirs()
        return JSONResponse({"plugins": discover_dashboard_plugins(extra)})

    async def serve_plugin_asset(request: Request) -> Response:
        name = request.path_params["name"]
        subpath = request.path_params["path"]
        extra = get_extra_dirs()
        file_path = _resolve_plugin_file(name, subpath, extra)
        if not file_path:
            return Response(status_code=404)
        media = "text/javascript"
        if file_path.suffix == ".css":
            media = "text/css"
        elif file_path.suffix == ".json":
            media = "application/json"
        return FileResponse(file_path, media_type=media)

    return [
        Route("/api/dashboard/plugins", list_plugins, methods=["GET"]),
        Route(
            "/dashboard-plugins/{name}/{path:path}",
            serve_plugin_asset,
            methods=["GET"],
        ),
    ]
