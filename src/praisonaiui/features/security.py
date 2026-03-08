"""Security feature — security monitoring and audit log for PraisonAIUI.

Surfaces security status, audit log entries, injection defense stats,
and security configuration from praisonai.security via gateway.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory audit log
_audit_log: deque = deque(maxlen=500)
_security_config: Dict[str, Any] = {
    "injection_defense": False,
    "audit_logging": False,
    "content_filtering": False,
}


class PraisonAISecurity(BaseFeatureProtocol):
    """Security monitoring and audit log feature."""

    feature_name = "security"
    feature_description = "Security monitoring and audit log"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        # Check if security module is available
        security_available = False
        security_features: List[str] = []
        try:
            from praisonai.security import (
                enable_security, enable_audit_log, enable_injection_defense,
            )
            security_available = True
            security_features = ["enable_security", "enable_audit_log",
                                 "enable_injection_defense"]
        except ImportError:
            pass

        return {
            "status": "ok",
            "feature": self.name,
            "security_available": security_available,
            "security_features": security_features,
            "injection_defense": _security_config.get("injection_defense", False),
            "audit_logging": _security_config.get("audit_logging", False),
            "audit_entries": len(_audit_log),
            **gateway_health(),
        }

    def routes(self) -> List[Route]:
        return [
            Route("/api/security", self._overview, methods=["GET"]),
            Route("/api/security/status", self._status, methods=["GET"]),
            Route("/api/security/audit", self._audit, methods=["GET"]),
            Route("/api/security/config", self._get_config, methods=["GET"]),
            Route("/api/security/config", self._set_config, methods=["POST"]),
        ]

    async def _overview(self, request: Request) -> JSONResponse:
        """Security overview — status, recent events, agent security."""
        agent_security = []
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    agent = gw.get_agent(aid)
                    if agent is None:
                        continue
                    name = getattr(agent, "name", aid)
                    has_guardrail = bool(
                        getattr(agent, "guardrail", None)
                        or getattr(agent, "guardrails", None)
                    )
                    has_tools = bool(getattr(agent, "tools", None))
                    agent_security.append({
                        "id": aid,
                        "name": name,
                        "has_guardrail": has_guardrail,
                        "has_tools": has_tools,
                        "tool_count": len(
                            getattr(agent, "tools", None) or []
                        ),
                    })
        except (ImportError, Exception):
            pass

        recent_audit = list(_audit_log)[-10:]

        return JSONResponse({
            "config": _security_config,
            "agent_security": agent_security,
            "recent_audit": recent_audit,
            "total_audit_entries": len(_audit_log),
        })

    async def _status(self, request: Request) -> JSONResponse:
        """Security system status."""
        health = await self.health()
        return JSONResponse(health)

    async def _audit(self, request: Request) -> JSONResponse:
        """List audit log entries."""
        limit = int(request.query_params.get("limit", "50"))
        event_type = request.query_params.get("type", None)

        items = list(_audit_log)
        if event_type:
            items = [e for e in items if e.get("event_type") == event_type]
        items = items[-limit:]

        # Event type counts
        type_counts: Dict[str, int] = {}
        for e in _audit_log:
            et = e.get("event_type", "unknown")
            type_counts[et] = type_counts.get(et, 0) + 1

        return JSONResponse({
            "entries": items,
            "count": len(items),
            "total": len(_audit_log),
            "by_type": type_counts,
        })

    async def _get_config(self, request: Request) -> JSONResponse:
        """Get security configuration."""
        return JSONResponse({"config": _security_config})

    async def _set_config(self, request: Request) -> JSONResponse:
        """Update security configuration."""
        body = await request.json()
        for key in ("injection_defense", "audit_logging", "content_filtering"):
            if key in body:
                _security_config[key] = bool(body[key])

        # Try to apply SDK security settings
        applied = []
        try:
            from praisonai.security import (
                enable_security, enable_audit_log, enable_injection_defense,
            )
            if _security_config.get("injection_defense"):
                enable_injection_defense()
                applied.append("injection_defense")
            if _security_config.get("audit_logging"):
                enable_audit_log()
                applied.append("audit_logging")
        except (ImportError, Exception):
            pass

        log_audit_event("security_config_update", body)
        return JSONResponse({
            "config": _security_config,
            "applied_to_sdk": applied,
        })


def log_audit_event(event_type: str, data: Any = None,
                    agent_id: str = "", severity: str = "info") -> None:
    """Log a security audit event (callable from hooks)."""
    _audit_log.append({
        "timestamp": time.time(),
        "event_type": event_type,
        "agent_id": agent_id,
        "severity": severity,
        "data": data or {},
    })
