"""Security feature — protocol-driven security monitoring for PraisonAIUI.

Architecture:
    SecurityProtocol (ABC)          <- any backend implements this
      ├── SimpleSecurityManager     <- default in-memory (no deps)
      └── SDKSecurityManager        <- wraps praisonai.security

    PraisonAISecurity (BaseFeatureProtocol)
      └── delegates to active SecurityProtocol implementation
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from collections import deque
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Security Protocol ────────────────────────────────────────────────


class SecurityProtocol(ABC):
    """Protocol interface for security backends."""

    @abstractmethod
    def get_config(self) -> Dict[str, Any]:
        ...

    @abstractmethod
    def set_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        ...

    @abstractmethod
    def log_event(self, event_type: str, data: Any = None,
                  agent_id: str = "", severity: str = "info") -> None:
        ...

    @abstractmethod
    def list_audit_log(self, *, limit: int = 50, event_type: Optional[str] = None) -> List[Dict[str, Any]]:
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Simple Security Manager ──────────────────────────────────────────


class SimpleSecurityManager(SecurityProtocol):
    """In-memory security manager — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._audit_log: deque = deque(maxlen=500)
        self._config: Dict[str, Any] = {
            "injection_defense": False,
            "audit_logging": False,
            "content_filtering": False,
        }

    def get_config(self) -> Dict[str, Any]:
        return dict(self._config)

    def set_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        for key in ("injection_defense", "audit_logging", "content_filtering"):
            if key in updates:
                self._config[key] = bool(updates[key])
        return dict(self._config)

    def log_event(self, event_type: str, data: Any = None,
                  agent_id: str = "", severity: str = "info") -> None:
        self._audit_log.append({
            "timestamp": time.time(),
            "event_type": event_type,
            "agent_id": agent_id,
            "severity": severity,
            "data": data or {},
        })

    def list_audit_log(self, *, limit: int = 50, event_type: Optional[str] = None) -> List[Dict[str, Any]]:
        items = list(self._audit_log)
        if event_type:
            items = [e for e in items if e.get("event_type") == event_type]
        return items[-limit:]

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleSecurityManager",
            "audit_entries": len(self._audit_log),
            **self._config,
        }


# ── SDK Security Manager ─────────────────────────────────────────────


class SDKSecurityManager(SecurityProtocol):
    """Wraps praisonai.security for production use."""

    def __init__(self) -> None:
        from praisonai.security import enable_security  # noqa: F401
        self._simple = SimpleSecurityManager()
        self._sdk_funcs = {}
        try:
            from praisonai.security import enable_audit_log, enable_injection_defense
            self._sdk_funcs["audit"] = enable_audit_log
            self._sdk_funcs["injection"] = enable_injection_defense
        except ImportError:
            pass
        logger.info("SDKSecurityManager initialized (praisonai.security available)")

    def get_config(self) -> Dict[str, Any]:
        return self._simple.get_config()

    def set_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        config = self._simple.set_config(updates)
        # Apply to SDK
        applied = []
        if config.get("injection_defense") and "injection" in self._sdk_funcs:
            try:
                self._sdk_funcs["injection"]()
                applied.append("injection_defense")
            except Exception:
                pass
        if config.get("audit_logging") and "audit" in self._sdk_funcs:
            try:
                self._sdk_funcs["audit"]()
                applied.append("audit_logging")
            except Exception:
                pass
        config["applied_to_sdk"] = applied
        return config

    def log_event(self, event_type: str, data: Any = None,
                  agent_id: str = "", severity: str = "info") -> None:
        self._simple.log_event(event_type, data, agent_id, severity)

    def list_audit_log(self, *, limit: int = 50, event_type: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._simple.list_audit_log(limit=limit, event_type=event_type)

    def health(self) -> Dict[str, Any]:
        h = self._simple.health()
        h["provider"] = "SDKSecurityManager"
        h["sdk_available"] = True
        h["sdk_functions"] = list(self._sdk_funcs.keys())
        return h


# ── Manager singleton ────────────────────────────────────────────────

_security_manager: Optional[SecurityProtocol] = None


def get_security_manager() -> SecurityProtocol:
    """Get the active security manager (SDK-first, fallback to Simple)."""
    global _security_manager
    if _security_manager is None:
        try:
            _security_manager = SDKSecurityManager()
            logger.info("Using SDKSecurityManager")
        except Exception as e:
            logger.debug("SDKSecurityManager init failed (%s), using SimpleSecurityManager", e)
            _security_manager = SimpleSecurityManager()
    return _security_manager


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
        mgr = get_security_manager()
        return {
            "status": "ok",
            "feature": self.name,
            **mgr.health(),
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
        mgr = get_security_manager()
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
                        "tool_count": len(getattr(agent, "tools", None) or []),
                    })
        except (ImportError, Exception):
            pass

        recent_audit = mgr.list_audit_log(limit=10)
        return JSONResponse({
            "config": mgr.get_config(),
            "agent_security": agent_security,
            "recent_audit": recent_audit,
            "total_audit_entries": len(mgr.list_audit_log(limit=10000)),
        })

    async def _status(self, request: Request) -> JSONResponse:
        health = await self.health()
        return JSONResponse(health)

    async def _audit(self, request: Request) -> JSONResponse:
        mgr = get_security_manager()
        limit = int(request.query_params.get("limit", "50"))
        event_type = request.query_params.get("type", None)
        items = mgr.list_audit_log(limit=limit, event_type=event_type)

        # Event type counts from full log
        all_items = mgr.list_audit_log(limit=10000)
        type_counts: Dict[str, int] = {}
        for e in all_items:
            et = e.get("event_type", "unknown")
            type_counts[et] = type_counts.get(et, 0) + 1

        return JSONResponse({
            "entries": items,
            "count": len(items),
            "total": len(all_items),
            "by_type": type_counts,
        })

    async def _get_config(self, request: Request) -> JSONResponse:
        mgr = get_security_manager()
        return JSONResponse({"config": mgr.get_config()})

    async def _set_config(self, request: Request) -> JSONResponse:
        mgr = get_security_manager()
        body = await request.json()
        config = mgr.set_config(body)
        mgr.log_event("security_config_update", body)
        return JSONResponse({"config": config})


def log_audit_event(event_type: str, data: Any = None,
                    agent_id: str = "", severity: str = "info") -> None:
    """Log a security audit event (callable from hooks)."""
    get_security_manager().log_event(event_type, data, agent_id, severity)
