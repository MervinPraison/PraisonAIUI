"""Guardrails feature — input/output safety monitoring for PraisonAIUI.

Surfaces guardrail configuration, violation logs, and active safety
policies from the praisonaiagents.guardrails module via gateway.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory violation log
_violations: deque = deque(maxlen=200)
_guardrail_registry: Dict[str, Dict[str, Any]] = {}


class PraisonAIGuardrails(BaseFeatureProtocol):
    """Guardrails safety dashboard feature."""

    feature_name = "guardrails"
    feature_description = "Input/output safety guardrails monitoring"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health, gateway_agents

        active_guardrails = 0
        total_violations = len(_violations)
        # Count agents that have guardrails configured
        for agent in gateway_agents():
            if (
                getattr(agent, "guardrail", None)
                or getattr(agent, "guardrails", None)
                or getattr(agent, "output_guardrail", None)
            ):
                active_guardrails += 1
        # Also count registered guardrails
        active_guardrails += len(_guardrail_registry)
        return {
            "status": "ok",
            "feature": self.name,
            "active_guardrails": active_guardrails,
            "total_violations": total_violations,
            **gateway_health(),
        }

    def routes(self) -> List[Route]:
        return [
            Route("/api/guardrails", self._list, methods=["GET"]),
            Route("/api/guardrails/status", self._status, methods=["GET"]),
            Route("/api/guardrails/violations", self._violations, methods=["GET"]),
            Route("/api/guardrails/register", self._register, methods=["POST"]),
        ]

    async def _list(self, request: Request) -> JSONResponse:
        """List all active guardrails across agents."""
        guardrails = []

        # Gateway-sourced guardrails
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    agent = gw.get_agent(aid)
                    if agent is None:
                        continue
                    name = getattr(agent, "name", aid)

                    # Input guardrail
                    gr = getattr(agent, "guardrail", None)
                    if gr:
                        guardrails.append({
                            "id": f"{aid}_input",
                            "agent_id": aid,
                            "agent_name": name,
                            "type": "input",
                            "guardrail": str(type(gr).__name__),
                            "source": "gateway",
                        })

                    # Output guardrail
                    ogr = getattr(agent, "output_guardrail", None)
                    if ogr:
                        guardrails.append({
                            "id": f"{aid}_output",
                            "agent_id": aid,
                            "agent_name": name,
                            "type": "output",
                            "guardrail": str(type(ogr).__name__),
                            "source": "gateway",
                        })

                    # Guardrails list
                    grs = getattr(agent, "guardrails", None)
                    if grs and isinstance(grs, (list, tuple)):
                        for i, g in enumerate(grs):
                            guardrails.append({
                                "id": f"{aid}_gr_{i}",
                                "agent_id": aid,
                                "agent_name": name,
                                "type": "custom",
                                "guardrail": str(type(g).__name__),
                                "source": "gateway",
                            })
        except (ImportError, Exception):
            pass

        # Locally registered guardrails
        for gid, ginfo in _guardrail_registry.items():
            guardrails.append({"id": gid, "source": "local", **ginfo})

        return JSONResponse({"guardrails": guardrails, "count": len(guardrails)})

    async def _status(self, request: Request) -> JSONResponse:
        """Guardrail system status."""
        health = await self.health()
        return JSONResponse(health)

    async def _violations(self, request: Request) -> JSONResponse:
        """List recent violations."""
        limit = int(request.query_params.get("limit", "50"))
        level = request.query_params.get("level", None)

        items = list(_violations)
        if level:
            items = [v for v in items if v.get("level") == level]
        items = items[-limit:]

        return JSONResponse({
            "violations": items,
            "count": len(items),
            "total": len(_violations),
        })

    async def _register(self, request: Request) -> JSONResponse:
        """Register or log a guardrail event."""
        body = await request.json()
        gid = body.get("id", f"gr_{int(time.time())}")
        _guardrail_registry[gid] = {
            "type": body.get("type", "custom"),
            "guardrail": body.get("guardrail", "unknown"),
            "agent_name": body.get("agent_name", ""),
            "created_at": time.time(),
        }
        return JSONResponse({"registered": gid})


def log_violation(agent_id: str, guardrail: str, message: str,
                  level: str = "WARNING") -> None:
    """Log a guardrail violation (callable from hooks/guardrails)."""
    _violations.append({
        "timestamp": time.time(),
        "agent_id": agent_id,
        "guardrail": guardrail,
        "message": message,
        "level": level,
    })
