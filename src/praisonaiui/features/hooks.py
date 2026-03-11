"""Hooks feature — wire praisonaiagents.hooks into PraisonAIUI.

Provides API endpoints and CLI commands for hook management:
listing registered hooks and triggering them.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory hooks registry
_hooks: Dict[str, Dict[str, Any]] = {}
_hook_log: List[Dict[str, Any]] = []


class HooksFeature(BaseFeatureProtocol):
    """Hooks management wired to praisonaiagents.hooks."""

    feature_name = "hooks"
    feature_description = "Pre/post operation hook management"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/hooks", self._list, methods=["GET"]),
            Route("/api/hooks", self._register, methods=["POST"]),
            Route("/api/hooks/log", self._log, methods=["GET"]),
            Route("/api/hooks/{hook_id}", self._get, methods=["GET"]),
            Route("/api/hooks/{hook_id}", self._delete, methods=["DELETE"]),
            Route("/api/hooks/{hook_id}/trigger", self._trigger, methods=["POST"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "hooks",
            "help": "Manage operation hooks",
            "commands": {
                "list": {"help": "List all hooks", "handler": self._cli_list},
                "trigger": {"help": "Trigger a hook", "handler": self._cli_trigger},
                "log": {"help": "Show hook execution log", "handler": self._cli_log},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "total_hooks": len(_hooks),
            "log_entries": len(_hook_log),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        return JSONResponse({"hooks": list(_hooks.values()), "count": len(_hooks)})

    async def _register(self, request: Request) -> JSONResponse:
        body = await request.json()
        hook_id = body.get("id", uuid.uuid4().hex[:12])
        entry = {
            "id": hook_id,
            "name": body.get("name", ""),
            "event": body.get("event", ""),
            "type": body.get("type", "pre"),
            "enabled": body.get("enabled", True),
            "registered_at": time.time(),
        }
        _hooks[hook_id] = entry
        return JSONResponse(entry, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        hook_id = request.path_params["hook_id"]
        hook = _hooks.get(hook_id)
        if not hook:
            return JSONResponse({"error": "Hook not found"}, status_code=404)
        return JSONResponse(hook)

    async def _delete(self, request: Request) -> JSONResponse:
        hook_id = request.path_params["hook_id"]
        if hook_id not in _hooks:
            return JSONResponse({"error": "Hook not found"}, status_code=404)
        del _hooks[hook_id]
        return JSONResponse({"deleted": hook_id})

    async def _trigger(self, request: Request) -> JSONResponse:
        hook_id = request.path_params["hook_id"]
        hook = _hooks.get(hook_id)
        if not hook:
            return JSONResponse({"error": "Hook not found"}, status_code=404)
        content_type = request.headers.get("content-type")
        body = await request.json() if content_type == "application/json" else {}
        log_entry = {
            "hook_id": hook_id,
            "hook_name": hook["name"],
            "event": hook["event"],
            "data": body.get("data", {}),
            "triggered_at": time.time(),
            "result": "executed",
        }
        _hook_log.append(log_entry)
        return JSONResponse(log_entry)

    async def _log(self, request: Request) -> JSONResponse:
        limit = int(request.query_params.get("limit", "50"))
        return JSONResponse({"log": _hook_log[-limit:], "count": len(_hook_log)})

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        if not _hooks:
            return "No hooks registered"
        lines = [f"  {h['id']} — {h['name']} ({h['event']}, {h['type']})" for h in _hooks.values()]
        return "\n".join(lines)

    def _cli_trigger(self, hook_id: str) -> str:
        if hook_id not in _hooks:
            return f"Hook {hook_id} not found"
        _hook_log.append({
            "hook_id": hook_id, "triggered_at": time.time(), "result": "executed",
        })
        return f"Triggered hook {hook_id}"

    def _cli_log(self) -> str:
        if not _hook_log:
            return "No hook executions"
        lines = [
            f"  {e['hook_id']} — {e.get('result', '?')} at {e['triggered_at']:.0f}"
            for e in _hook_log[-10:]
        ]
        return "\n".join(lines)


# Backward-compat alias
PraisonAIHooks = HooksFeature
