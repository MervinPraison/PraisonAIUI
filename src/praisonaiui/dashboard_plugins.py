"""Discover and serve third-party dashboard UI plugins (manifest + static assets)."""

from __future__ import annotations

import json
import logging
import os
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


# Discovery runs on every page, manifest and plugin-file request. These caches
# keep it to one stat per search folder and one per manifest: a folder's list
# of children is re-read when its mtime changes, a manifest when its own does.
_children_cache: dict[Path, tuple[int, list[Path]]] = {}
_manifest_cache: dict[Path, tuple[int, int, Any]] = {}


def _child_dirs(root: Path) -> list[Path]:
    try:
        mtime = root.stat().st_mtime_ns
    except OSError:
        return []
    hit = _children_cache.get(root)
    if hit is not None and hit[0] == mtime:
        return hit[1]
    children = sorted(c for c in root.iterdir() if c.is_dir())
    _children_cache[root] = (mtime, children)
    return children


def _read_manifest(manifest_path: Path) -> Any:
    """Parsed manifest.json, ``None`` when missing; raises on a bad file."""
    try:
        st = manifest_path.stat()
    except OSError:
        return None
    hit = _manifest_cache.get(manifest_path)
    if hit is not None and hit[:2] == (st.st_mtime_ns, st.st_size):
        if isinstance(hit[2], Exception):
            raise hit[2]
        return hit[2]
    try:
        data: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _manifest_cache[manifest_path] = (st.st_mtime_ns, st.st_size, exc)
        raise
    _manifest_cache[manifest_path] = (st.st_mtime_ns, st.st_size, data)
    return data


def discover_dashboard_plugins(
    extra_dirs: list[str] | None = None,
    allowed: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Scan dashboard-plugins folders for manifest.json files.

    ``allowed`` restricts results to the given plugin names; ``None`` keeps
    every discovered plugin and ``[]`` disables all of them.
    """
    if allowed is not None and not allowed:
        return []
    allow = set(allowed) if allowed is not None else None
    manifests: list[dict[str, Any]] = []
    seen: set[str] = set()

    for root in _plugin_search_dirs(extra_dirs):
        for child in _child_dirs(root):
            manifest_path = child / "manifest.json"
            try:
                data = _read_manifest(manifest_path)
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Invalid dashboard plugin manifest %s: %s", manifest_path, exc)
                continue
            if not isinstance(data, dict):
                continue
            name = data.get("name") or child.name
            if name in seen:
                continue
            seen.add(name)
            if allow is not None and name not in allow:
                continue
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


def _resolve_plugin_file(
    name: str,
    subpath: str,
    extra_dirs: list[str] | None,
    allowed: list[str] | None = None,
) -> Path | None:
    for manifest in discover_dashboard_plugins(extra_dirs, allowed):
        if manifest["name"] != name:
            continue
        root = Path(manifest["root"]).resolve()
        target = (root / subpath).resolve()
        # Path containment, not a string prefix: ``foo/../foo-private`` shares
        # the prefix of ``foo`` but is outside it.
        if not target.is_relative_to(root):
            return None
        if target.is_file():
            return target
    return None


def make_dashboard_plugin_routes(
    get_extra_dirs,
    get_allowed=None,
) -> list[Route]:
    """Factory: ``get_extra_dirs`` returns plugin dir list from server config.

    ``get_allowed`` optionally returns the plugin-name allowlist (``None`` = all).
    """

    def _allowed() -> list[str] | None:
        return get_allowed() if get_allowed else None

    async def list_plugins(request: Request) -> JSONResponse:
        extra = get_extra_dirs()
        return JSONResponse({"plugins": discover_dashboard_plugins(extra, _allowed())})

    async def serve_plugin_asset(request: Request) -> Response:
        name = request.path_params["name"]
        subpath = request.path_params["path"]
        extra = get_extra_dirs()
        file_path = _resolve_plugin_file(name, subpath, extra, _allowed())
        if not file_path:
            return Response(status_code=404)
        media = "text/javascript"
        if file_path.suffix == ".css":
            media = "text/css"
        elif file_path.suffix == ".json":
            media = "application/json"
        from praisonaiui.static_gzip import gzip_file_response

        response = FileResponse(
            file_path,
            media_type=media,
            stat_result=os.stat(file_path),
            headers={"Cache-Control": "no-cache"},
        )
        return await gzip_file_response(response, request.scope)

    return [
        Route("/api/dashboard/plugins", list_plugins, methods=["GET"]),
        Route(
            "/dashboard-plugins/{name}/{path:path}",
            serve_plugin_asset,
            methods=["GET"],
        ),
    ]
