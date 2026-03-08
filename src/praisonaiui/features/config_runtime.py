"""Config runtime feature — live config management without restart.

Provides API endpoints and CLI commands for runtime configuration:
get, set, patch, schema-driven form editing, and validation.
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

# JSON Schema for config form editor
CONFIG_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "PraisonAI Configuration",
    "type": "object",
    "properties": {
        "provider": {
            "type": "object",
            "title": "Provider Settings",
            "properties": {
                "name": {
                    "type": "string",
                    "title": "Provider Name",
                    "enum": ["openai", "anthropic", "google", "azure", "ollama", "litellm"],
                    "default": "openai",
                },
                "api_key": {
                    "type": "string",
                    "title": "API Key",
                    "format": "password",
                },
                "api_base": {
                    "type": "string",
                    "title": "API Base URL",
                    "format": "uri",
                },
            },
        },
        "model": {
            "type": "object",
            "title": "Model Settings",
            "properties": {
                "name": {
                    "type": "string",
                    "title": "Model Name",
                    "enum": [
                        "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo",
                        "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022",
                        "gemini-2.0-flash", "gemini-1.5-pro",
                    ],
                    "default": "gpt-4o-mini",
                },
                "temperature": {
                    "type": "number",
                    "title": "Temperature",
                    "minimum": 0,
                    "maximum": 2,
                    "default": 0.7,
                },
                "max_tokens": {
                    "type": "integer",
                    "title": "Max Tokens",
                    "minimum": 1,
                    "maximum": 128000,
                },
            },
        },
        "server": {
            "type": "object",
            "title": "Server Settings",
            "properties": {
                "host": {
                    "type": "string",
                    "title": "Host",
                    "default": "0.0.0.0",
                },
                "port": {
                    "type": "integer",
                    "title": "Port",
                    "minimum": 1,
                    "maximum": 65535,
                    "default": 8000,
                },
                "debug": {
                    "type": "boolean",
                    "title": "Debug Mode",
                    "default": False,
                },
            },
        },
        "auth": {
            "type": "object",
            "title": "Authentication",
            "properties": {
                "require_auth": {
                    "type": "boolean",
                    "title": "Require Authentication",
                    "default": False,
                },
                "api_key": {
                    "type": "string",
                    "title": "API Key",
                    "format": "password",
                },
            },
        },
        "logging": {
            "type": "object",
            "title": "Logging",
            "properties": {
                "level": {
                    "type": "string",
                    "title": "Log Level",
                    "enum": ["DEBUG", "INFO", "WARNING", "ERROR"],
                    "default": "INFO",
                },
                "format": {
                    "type": "string",
                    "title": "Log Format",
                    "default": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
                },
            },
        },
    },
}


def validate_config(config: Dict[str, Any], schema: Dict[str, Any] = None) -> List[str]:
    """Validate config against schema. Returns list of errors."""
    errors = []
    schema = schema or CONFIG_SCHEMA
    
    props = schema.get("properties", {})
    for key, prop_schema in props.items():
        if key in config:
            value = config[key]
            prop_type = prop_schema.get("type")
            
            # Type validation
            if prop_type == "string" and not isinstance(value, str):
                errors.append(f"{key}: expected string, got {type(value).__name__}")
            elif prop_type == "number" and not isinstance(value, (int, float)):
                errors.append(f"{key}: expected number, got {type(value).__name__}")
            elif prop_type == "integer" and not isinstance(value, int):
                errors.append(f"{key}: expected integer, got {type(value).__name__}")
            elif prop_type == "boolean" and not isinstance(value, bool):
                errors.append(f"{key}: expected boolean, got {type(value).__name__}")
            elif prop_type == "object" and isinstance(value, dict):
                # Recursive validation
                sub_errors = validate_config(value, prop_schema)
                errors.extend([f"{key}.{e}" for e in sub_errors])
            
            # Enum validation
            if "enum" in prop_schema and value not in prop_schema["enum"]:
                errors.append(f"{key}: must be one of {prop_schema['enum']}")
            
            # Range validation
            if prop_type in ("number", "integer"):
                if "minimum" in prop_schema and value < prop_schema["minimum"]:
                    errors.append(f"{key}: must be >= {prop_schema['minimum']}")
                if "maximum" in prop_schema and value > prop_schema["maximum"]:
                    errors.append(f"{key}: must be <= {prop_schema['maximum']}")
    
    return errors


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
            # Schema-driven form editor endpoints
            Route("/api/config/schema", self._schema, methods=["GET"]),
            Route("/api/config/validate", self._validate, methods=["POST"]),
            Route("/api/config/apply", self._apply, methods=["POST"]),
            Route("/api/config/defaults", self._defaults, methods=["GET"]),
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
        from ._gateway_helpers import gateway_health

        return {
            "status": "ok",
            "feature": self.name,
            "keys": len(_runtime_config),
            "changes": len(_config_history),
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _get(self, request: Request) -> JSONResponse:
        # Include gateway info in config response
        gateway_info = {"connected": False, "agents": []}
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                gateway_info["connected"] = True
                for aid in gw.list_agents():
                    agent = gw.get_agent(aid)
                    name = getattr(agent, "name", aid) if agent else aid
                    gateway_info["agents"].append({"id": aid, "name": name})
        except (ImportError, Exception):
            pass
        config_with_gateway = dict(_runtime_config)
        config_with_gateway["gateway"] = gateway_info
        return JSONResponse({"config": config_with_gateway})

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

    # ── Schema-driven form editor endpoints ──────────────────────────

    async def _schema(self, request: Request) -> JSONResponse:
        """GET /api/config/schema — Return JSON Schema for form rendering."""
        return JSONResponse({"schema": CONFIG_SCHEMA})

    async def _validate(self, request: Request) -> JSONResponse:
        """POST /api/config/validate — Validate config without applying."""
        body = await request.json()
        config = body.get("config", body)
        errors = validate_config(config)
        return JSONResponse({
            "valid": len(errors) == 0,
            "errors": errors,
        })

    async def _apply(self, request: Request) -> JSONResponse:
        """POST /api/config/apply — Validate and apply config changes."""
        body = await request.json()
        config = body.get("config", body)
        
        # Validate first
        errors = validate_config(config)
        if errors:
            return JSONResponse({
                "applied": False,
                "errors": errors,
            }, status_code=400)
        
        # Apply changes
        _config_history.append({
            "action": "apply",
            "old_config": dict(_runtime_config),
            "new_config": config,
            "timestamp": time.time(),
        })
        _runtime_config.clear()
        _runtime_config.update(config)
        
        return JSONResponse({
            "applied": True,
            "config": _runtime_config,
        })

    async def _defaults(self, request: Request) -> JSONResponse:
        """GET /api/config/defaults — Return default values from schema."""
        defaults = {}
        for key, prop in CONFIG_SCHEMA.get("properties", {}).items():
            if prop.get("type") == "object":
                defaults[key] = {}
                for sub_key, sub_prop in prop.get("properties", {}).items():
                    if "default" in sub_prop:
                        defaults[key][sub_key] = sub_prop["default"]
            elif "default" in prop:
                defaults[key] = prop["default"]
        return JSONResponse({"defaults": defaults})

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
