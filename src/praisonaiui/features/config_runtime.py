"""Config runtime feature — live config management without restart.

Provides API endpoints and CLI commands for runtime configuration:
get, set, and patch config values dynamically.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory runtime config (overlays the static YAML config)
_runtime_config: Dict[str, Any] = {}
_config_history: List[Dict[str, Any]] = []


class PraisonAIConfigRuntime(BaseFeatureProtocol):
    """Runtime configuration management."""

    feature_name = "config_runtime"
    feature_description = "Live runtime configuration (get, set, patch without restart)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/config/runtime", self._get, methods=["GET"]),
            Route("/api/config/runtime", self._patch, methods=["PATCH"]),
            Route("/api/config/runtime", self._set, methods=["PUT"]),
            Route("/api/config/runtime/history", self._history, methods=["GET"]),
            Route("/api/config/runtime/{key}", self._get_key, methods=["GET"]),
            Route("/api/config/runtime/{key}", self._set_key, methods=["PUT"]),
            Route("/api/config/runtime/{key}", self._delete_key, methods=["DELETE"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "config",
            "help": "Manage runtime configuration",
            "commands": {
                "get": {"help": "Get runtime config", "handler": self._cli_get},
                "set": {"help": "Set a config value", "handler": self._cli_set},
                "list": {"help": "List all config keys", "handler": self._cli_list},
                "history": {"help": "Show config change history", "handler": self._cli_history},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "keys": len(_runtime_config),
            "changes": len(_config_history),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _get(self, request: Request) -> JSONResponse:
        return JSONResponse({"config": _runtime_config})

    async def _patch(self, request: Request) -> JSONResponse:
        body = await request.json()
        changes = body.get("config", body)
        for k, v in changes.items():
            old = _runtime_config.get(k)
            _runtime_config[k] = v
            _config_history.append({
                "key": k, "old": old, "new": v, "timestamp": time.time(),
            })
        return JSONResponse({"config": _runtime_config, "applied": len(changes)})

    async def _set(self, request: Request) -> JSONResponse:
        body = await request.json()
        _config_history.append({
            "action": "replace_all",
            "old_keys": list(_runtime_config.keys()),
            "new_keys": list(body.keys()),
            "timestamp": time.time(),
        })
        _runtime_config.clear()
        _runtime_config.update(body)
        return JSONResponse({"config": _runtime_config})

    async def _history(self, request: Request) -> JSONResponse:
        limit = int(request.query_params.get("limit", "50"))
        return JSONResponse({"history": _config_history[-limit:], "count": len(_config_history)})

    async def _get_key(self, request: Request) -> JSONResponse:
        key = request.path_params["key"]
        if key not in _runtime_config:
            return JSONResponse({"error": f"Key '{key}' not found"}, status_code=404)
        return JSONResponse({"key": key, "value": _runtime_config[key]})

    async def _set_key(self, request: Request) -> JSONResponse:
        key = request.path_params["key"]
        body = await request.json()
        old = _runtime_config.get(key)
        _runtime_config[key] = body.get("value", body)
        _config_history.append({
            "key": key, "old": old, "new": _runtime_config[key], "timestamp": time.time(),
        })
        return JSONResponse({"key": key, "value": _runtime_config[key]})

    async def _delete_key(self, request: Request) -> JSONResponse:
        key = request.path_params["key"]
        if key not in _runtime_config:
            return JSONResponse({"error": f"Key '{key}' not found"}, status_code=404)
        old = _runtime_config.pop(key)
        _config_history.append({
            "key": key, "old": old, "new": None, "action": "delete", "timestamp": time.time(),
        })
        return JSONResponse({"deleted": key})

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_get(self, key: str = "") -> str:
        if key:
            val = _runtime_config.get(key, "<not set>")
            return f"{key} = {val}"
        if not _runtime_config:
            return "No runtime config set"
        lines = [f"  {k} = {v}" for k, v in _runtime_config.items()]
        return "\n".join(lines)

    def _cli_set(self, key: str, value: str) -> str:
        _runtime_config[key] = value
        return f"Set {key} = {value}"

    def _cli_list(self) -> str:
        if not _runtime_config:
            return "No runtime config keys"
        return "\n".join(f"  {k}" for k in sorted(_runtime_config.keys()))

    def _cli_history(self) -> str:
        if not _config_history:
            return "No config changes"
        lines = [f"  {e['key']}: {e.get('old')} → {e.get('new')}" for e in _config_history[-10:]]
        return "\n".join(lines)
