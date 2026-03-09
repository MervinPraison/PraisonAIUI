"""Guardrails feature — protocol-driven safety monitoring for PraisonAIUI.

Architecture:
    GuardrailProtocol (ABC)          <- any backend implements this
      ├── SimpleGuardrailManager     <- default in-memory (no deps)
      └── SDKGuardrailManager        <- wraps praisonaiagents.guardrails

    PraisonAIGuardrails (BaseFeatureProtocol)
      └── delegates to active GuardrailProtocol implementation
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


# ── Guardrail Protocol ───────────────────────────────────────────────


class GuardrailProtocol(ABC):
    """Protocol interface for guardrail backends."""

    @abstractmethod
    def list_guardrails(self) -> List[Dict[str, Any]]:
        """List all registered guardrails."""
        ...

    @abstractmethod
    def get_violations(self, *, limit: int = 50, level: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get recent violations."""
        ...

    @abstractmethod
    def log_violation(self, agent_id: str, guardrail: str, message: str, level: str = "WARNING") -> None:
        """Log a guardrail violation."""
        ...

    @abstractmethod
    def register_guardrail(self, guardrail_id: str, info: Dict[str, Any]) -> str:
        """Register a guardrail. Returns the ID."""
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Simple Guardrail Manager (Default, no deps) ─────────────────────


class SimpleGuardrailManager(GuardrailProtocol):
    """In-memory guardrail manager with unified YAML persistence."""

    _SECTION = "guardrails"

    def __init__(self) -> None:
        self._violations: deque = deque(maxlen=200)
        from ._persistence import load_section
        saved = load_section(self._SECTION)
        self._registry: Dict[str, Dict[str, Any]] = saved.get("registry", {}) if isinstance(saved, dict) else {}

    def list_guardrails(self) -> List[Dict[str, Any]]:
        return [{"id": gid, "source": "local", **info} for gid, info in self._registry.items()]

    def get_violations(self, *, limit: int = 50, level: Optional[str] = None) -> List[Dict[str, Any]]:
        items = list(self._violations)
        if level:
            items = [v for v in items if v.get("level") == level]
        return items[-limit:]

    def log_violation(self, agent_id: str, guardrail: str, message: str, level: str = "WARNING") -> None:
        self._violations.append({
            "timestamp": time.time(),
            "agent_id": agent_id,
            "guardrail": guardrail,
            "message": message,
            "level": level,
        })

    def register_guardrail(self, guardrail_id: str, info: Dict[str, Any]) -> str:
        self._registry[guardrail_id] = {**info, "created_at": time.time()}
        self._persist()
        return guardrail_id

    def _persist(self) -> None:
        from ._persistence import save_section
        save_section(self._SECTION, {"registry": self._registry})

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleGuardrailManager",
            "total_violations": len(self._violations),
            "registered_guardrails": len(self._registry),
        }


# ── SDK Guardrail Manager ────────────────────────────────────────────


class SDKGuardrailManager(GuardrailProtocol):
    """Wraps praisonaiagents.guardrails for production use."""

    def __init__(self) -> None:
        from praisonaiagents.guardrails import GuardrailResult  # noqa: F401
        self._simple = SimpleGuardrailManager()  # local tracking
        logger.info("SDKGuardrailManager initialized (praisonaiagents.guardrails available)")

    def list_guardrails(self) -> List[Dict[str, Any]]:
        guardrails = list(self._simple.list_guardrails())
        # Also surface gateway-registered agent guardrails
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    agent = gw.get_agent(aid)
                    if agent is None:
                        continue
                    name = getattr(agent, "name", aid)
                    for attr, gtype in [("guardrail", "input"), ("output_guardrail", "output")]:
                        gr = getattr(agent, attr, None)
                        if gr:
                            guardrails.append({
                                "id": f"{aid}_{gtype}",
                                "agent_id": aid, "agent_name": name,
                                "type": gtype,
                                "guardrail": type(gr).__name__,
                                "source": "gateway",
                            })
                    grs = getattr(agent, "guardrails", None)
                    if grs and isinstance(grs, (list, tuple)):
                        for i, g in enumerate(grs):
                            guardrails.append({
                                "id": f"{aid}_gr_{i}",
                                "agent_id": aid, "agent_name": name,
                                "type": "custom",
                                "guardrail": type(g).__name__,
                                "source": "gateway",
                            })
        except (ImportError, Exception):
            pass
        return guardrails

    def get_violations(self, *, limit: int = 50, level: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._simple.get_violations(limit=limit, level=level)

    def log_violation(self, agent_id: str, guardrail: str, message: str, level: str = "WARNING") -> None:
        self._simple.log_violation(agent_id, guardrail, message, level)

    def register_guardrail(self, guardrail_id: str, info: Dict[str, Any]) -> str:
        return self._simple.register_guardrail(guardrail_id, info)

    def health(self) -> Dict[str, Any]:
        h = self._simple.health()
        h["provider"] = "SDKGuardrailManager"
        h["sdk_available"] = True
        return h


# ── Manager singleton ────────────────────────────────────────────────

_guardrail_manager: Optional[GuardrailProtocol] = None


def get_guardrail_manager() -> GuardrailProtocol:
    """Get the active guardrail manager (SDK-first, fallback to Simple)."""
    global _guardrail_manager
    if _guardrail_manager is None:
        try:
            _guardrail_manager = SDKGuardrailManager()
            logger.info("Using SDKGuardrailManager")
        except Exception as e:
            logger.debug("SDKGuardrailManager init failed (%s), using SimpleGuardrailManager", e)
            _guardrail_manager = SimpleGuardrailManager()
    return _guardrail_manager


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

        mgr = get_guardrail_manager()
        mgr_health = mgr.health()
        active_guardrails = len(mgr.list_guardrails())
        return {
            "status": "ok",
            "feature": self.name,
            "active_guardrails": active_guardrails,
            **mgr_health,
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
        mgr = get_guardrail_manager()
        guardrails = mgr.list_guardrails()
        return JSONResponse({"guardrails": guardrails, "count": len(guardrails)})

    async def _status(self, request: Request) -> JSONResponse:
        """Guardrail system status."""
        health = await self.health()
        return JSONResponse(health)

    async def _violations(self, request: Request) -> JSONResponse:
        """List recent violations."""
        mgr = get_guardrail_manager()
        limit = int(request.query_params.get("limit", "50"))
        level = request.query_params.get("level", None)
        items = mgr.get_violations(limit=limit, level=level)
        return JSONResponse({
            "violations": items,
            "count": len(items),
        })

    async def _register(self, request: Request) -> JSONResponse:
        """Register a new guardrail — supports LLM-based guardrails from the UI.

        Accepts JSON with:
          - description (str): Natural language validation criteria
          - type (str): "llm" or "custom" (default: "llm")
          - agent_name (str): Target agent (applies to all if empty)
          - id (str): Optional guardrail ID

        When type="llm", creates an LLMGuardrail from the SDK and
        attaches it to matching gateway agents.
        """
        mgr = get_guardrail_manager()
        body = await request.json()
        gid = body.get("id", f"gr_{int(time.time())}")
        gr_type = body.get("type", "llm")
        description = body.get("description", "")
        agent_name = body.get("agent_name", "")

        if not description:
            return JSONResponse(
                {"error": "description is required"},
                status_code=400,
            )

        info: Dict[str, Any] = {
            "type": gr_type,
            "description": description,
            "agent_name": agent_name,
            "guardrail": "LLMGuardrail" if gr_type == "llm" else body.get("guardrail", "custom"),
        }

        # Attempt to create a live LLMGuardrail and attach to agents
        attached_to: List[str] = []
        if gr_type == "llm":
            try:
                from praisonaiagents.guardrails.llm_guardrail import LLMGuardrail
                import os

                llm_model = body.get("llm", os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"))
                guardrail_fn = LLMGuardrail(description=description, llm=llm_model)
                info["llm_model"] = llm_model

                # Attach to gateway agents
                try:
                    from ._gateway_ref import get_gateway
                    gw = get_gateway()
                    if gw is not None:
                        for aid in gw.list_agents():
                            ag = gw.get_agent(aid)
                            if ag is None:
                                continue
                            name = getattr(ag, "name", aid)
                            if agent_name and name != agent_name:
                                continue
                            # Append to agent's guardrails list
                            existing = getattr(ag, "guardrails", None)
                            if existing is None:
                                ag.guardrails = [guardrail_fn]
                            elif isinstance(existing, list):
                                existing.append(guardrail_fn)
                            attached_to.append(name)
                except (ImportError, Exception) as e:
                    logger.debug(f"Failed to attach guardrail to gateway agents: {e}")
            except ImportError:
                logger.warning("LLMGuardrail not available — registering metadata only")

        mgr.register_guardrail(gid, info)
        return JSONResponse({
            "registered": gid,
            "info": info,
            "attached_to": attached_to,
        })


def log_violation(agent_id: str, guardrail: str, message: str,
                  level: str = "WARNING") -> None:
    """Log a guardrail violation (callable from hooks/guardrails)."""
    get_guardrail_manager().log_violation(agent_id, guardrail, message, level)
