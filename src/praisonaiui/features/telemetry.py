"""Telemetry feature — protocol-driven performance monitoring for PraisonAIUI.

Architecture:
    TelemetryProtocol (ABC)          <- any backend implements this
      ├── SimpleTelemetryManager     <- default in-memory (no deps)
      └── SDKTelemetryManager        <- wraps praisonaiagents.telemetry

    PraisonAITelemetry (BaseFeatureProtocol)
      └── delegates to active TelemetryProtocol implementation
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


# ── Telemetry Protocol ───────────────────────────────────────────────


class TelemetryProtocol(ABC):
    """Protocol interface for telemetry backends."""

    @abstractmethod
    def record_metric(self, entry: Dict[str, Any]) -> str:
        ...

    @abstractmethod
    def list_metrics(self, *, limit: int = 100, agent_id: Optional[str] = None) -> List[Dict[str, Any]]:
        ...

    @abstractmethod
    def get_overview(self) -> Dict[str, Any]:
        ...

    @abstractmethod
    def get_performance(self) -> Dict[str, Any]:
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Simple Telemetry Manager ─────────────────────────────────────────


class SimpleTelemetryManager(TelemetryProtocol):
    """In-memory telemetry — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._metrics: deque = deque(maxlen=1000)
        self._perf_snapshots: deque = deque(maxlen=100)

    def record_metric(self, entry: Dict[str, Any]) -> str:
        mid = entry.get("id", f"met_{int(time.time() * 1000)}")
        entry["id"] = mid
        entry.setdefault("timestamp", time.time())
        self._metrics.append(entry)
        return mid

    def list_metrics(self, *, limit: int = 100, agent_id: Optional[str] = None) -> List[Dict[str, Any]]:
        items = list(self._metrics)
        if agent_id:
            items = [m for m in items if m.get("agent_id") == agent_id]
        return items[-limit:]

    def get_overview(self) -> Dict[str, Any]:
        total_calls = len(self._metrics)
        if total_calls == 0:
            return {"total_calls": 0, "avg_latency_ms": None, "total_tokens": 0, "by_agent": {}}

        total_latency = sum(m.get("latency_ms", 0) for m in self._metrics)
        total_tokens = sum(m.get("tokens", 0) for m in self._metrics)
        by_agent: Dict[str, Dict[str, Any]] = {}
        for m in self._metrics:
            aid = m.get("agent_id", "unknown")
            if aid not in by_agent:
                by_agent[aid] = {"calls": 0, "total_latency_ms": 0, "total_tokens": 0}
            by_agent[aid]["calls"] += 1
            by_agent[aid]["total_latency_ms"] += m.get("latency_ms", 0)
            by_agent[aid]["total_tokens"] += m.get("tokens", 0)
        for s in by_agent.values():
            s["avg_latency_ms"] = s["total_latency_ms"] / s["calls"] if s["calls"] else 0
        return {
            "total_calls": total_calls,
            "avg_latency_ms": total_latency / total_calls,
            "total_tokens": total_tokens,
            "by_agent": by_agent,
        }

    def get_performance(self) -> Dict[str, Any]:
        return {"available": False, "profiling_available": False}

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleTelemetryManager",
            "total_metrics": len(self._metrics),
            "total_snapshots": len(self._perf_snapshots),
        }


# ── SDK Telemetry Manager ────────────────────────────────────────────


class SDKTelemetryManager(TelemetryProtocol):
    """Wraps praisonaiagents.telemetry + profiling for production use."""

    def __init__(self) -> None:
        self._telemetry_available = False
        self._profiling_available = False
        try:
            from praisonaiagents.telemetry import PerformanceMonitor  # noqa: F401
            self._telemetry_available = True
        except ImportError:
            pass
        try:
            from praisonaiagents.profiling import Profiler  # noqa: F401
            self._profiling_available = True
        except ImportError:
            pass
        if not (self._telemetry_available or self._profiling_available):
            raise ImportError("Neither praisonaiagents.telemetry nor profiling available")
        self._simple = SimpleTelemetryManager()
        logger.info("SDKTelemetryManager initialized (telemetry=%s, profiling=%s)",
                     self._telemetry_available, self._profiling_available)

    def record_metric(self, entry: Dict[str, Any]) -> str:
        return self._simple.record_metric(entry)

    def list_metrics(self, *, limit: int = 100, agent_id: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._simple.list_metrics(limit=limit, agent_id=agent_id)

    def get_overview(self) -> Dict[str, Any]:
        return self._simple.get_overview()

    def get_performance(self) -> Dict[str, Any]:
        perf_data: Dict[str, Any] = {"available": False}
        if self._telemetry_available:
            try:
                from praisonaiagents.telemetry import get_performance_data
                data = get_performance_data()
                perf_data = {"available": True, "data": data}
            except (ImportError, AttributeError, Exception):
                pass
        perf_data["profiling_available"] = self._profiling_available
        return perf_data

    def health(self) -> Dict[str, Any]:
        h = self._simple.health()
        h["provider"] = "SDKTelemetryManager"
        h["telemetry_available"] = self._telemetry_available
        h["profiling_available"] = self._profiling_available
        return h


# ── Manager singleton ────────────────────────────────────────────────

_telemetry_manager: Optional[TelemetryProtocol] = None


def get_telemetry_manager() -> TelemetryProtocol:
    """Get the active telemetry manager (SDK-first, fallback to Simple)."""
    global _telemetry_manager
    if _telemetry_manager is None:
        try:
            _telemetry_manager = SDKTelemetryManager()
            logger.info("Using SDKTelemetryManager")
        except Exception as e:
            logger.debug("SDKTelemetryManager init failed (%s), using SimpleTelemetryManager", e)
            _telemetry_manager = SimpleTelemetryManager()
    return _telemetry_manager


class PraisonAITelemetry(BaseFeatureProtocol):
    """Telemetry and performance monitoring feature."""

    feature_name = "telemetry"
    feature_description = "Performance monitoring and profiling"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health
        mgr = get_telemetry_manager()
        return {
            "status": "ok",
            "feature": self.name,
            **mgr.health(),
            **gateway_health(),
        }

    def routes(self) -> List[Route]:
        return [
            Route("/api/telemetry", self._overview, methods=["GET"]),
            Route("/api/telemetry/status", self._status, methods=["GET"]),
            Route("/api/telemetry/metrics", self._metrics_list, methods=["GET"]),
            Route("/api/telemetry/record", self._record, methods=["POST"]),
            Route("/api/telemetry/performance", self._performance, methods=["GET"]),
            Route("/api/telemetry/profiling", self._profiling, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "telemetry",
            "help": "Performance monitoring and metrics",
            "commands": {
                "status": {"help": "Show telemetry status", "handler": self._cli_status},
                "metrics": {"help": "Show recent metrics", "handler": self._cli_metrics},
                "overview": {"help": "Show telemetry overview", "handler": self._cli_overview},
            },
        }]

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_status(self) -> str:
        mgr = get_telemetry_manager()
        h = mgr.health()
        lines = [
            f"Status: {h.get('status', 'ok')}",
            f"Provider: {h.get('provider', 'unknown')}",
            f"Total metrics: {h.get('total_metrics', 0)}",
        ]
        return "\n".join(lines)

    def _cli_metrics(self, limit: int = 20, agent_id: str = "") -> str:
        mgr = get_telemetry_manager()
        items = mgr.list_metrics(limit=limit, agent_id=agent_id or None)
        if not items:
            return "No metrics recorded"
        lines = []
        for m in items:
            mtype = m.get("type", "?")
            agent = m.get("agent_id", "?")
            latency = m.get("latency_ms", 0)
            tokens = m.get("tokens", 0)
            lines.append(f"  {mtype} agent={agent} latency={latency}ms tokens={tokens}")
        return f"{len(items)} metrics:\n" + "\n".join(lines)

    def _cli_overview(self) -> str:
        mgr = get_telemetry_manager()
        overview = mgr.get_overview()
        lines = [
            f"Total calls: {overview.get('total_calls', 0)}",
            f"Avg latency: {overview.get('avg_latency_ms', 'N/A')}ms",
            f"Total tokens: {overview.get('total_tokens', 0)}",
        ]
        by_agent = overview.get("by_agent", {})
        if by_agent:
            lines.append("By agent:")
            for aid, stats in by_agent.items():
                lines.append(f"  {aid}: {stats.get('calls', 0)} calls, avg {stats.get('avg_latency_ms', 0):.0f}ms")
        return "\n".join(lines)

    async def _overview(self, request: Request) -> JSONResponse:
        mgr = get_telemetry_manager()
        overview = mgr.get_overview()
        # Add gateway agents
        gateway_agents = []
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    agent = gw.get_agent(aid)
                    name = getattr(agent, "name", aid) if agent else aid
                    gateway_agents.append({"id": aid, "name": name})
        except (ImportError, Exception):
            pass
        overview["gateway_agents"] = gateway_agents
        return JSONResponse(overview)

    async def _status(self, request: Request) -> JSONResponse:
        health = await self.health()
        return JSONResponse(health)

    async def _metrics_list(self, request: Request) -> JSONResponse:
        mgr = get_telemetry_manager()
        limit = int(request.query_params.get("limit", "100"))
        agent_id = request.query_params.get("agent_id", None)
        items = mgr.list_metrics(limit=limit, agent_id=agent_id)
        return JSONResponse({"metrics": items, "count": len(items)})

    async def _record(self, request: Request) -> JSONResponse:
        mgr = get_telemetry_manager()
        body = await request.json()
        entry = {
            "agent_id": body.get("agent_id", "unknown"),
            "type": body.get("type", "llm_call"),
            "latency_ms": body.get("latency_ms", 0),
            "tokens": body.get("tokens", 0),
            "model": body.get("model", ""),
        }
        mid = mgr.record_metric(entry)
        return JSONResponse({"recorded": mid})

    async def _performance(self, request: Request) -> JSONResponse:
        mgr = get_telemetry_manager()
        perf_data = mgr.get_performance()
        return JSONResponse(perf_data)

    async def _profiling(self, request: Request) -> JSONResponse:
        try:
            from praisonaiagents.profiling import Profiler
            profiler = Profiler()
            mgr = get_telemetry_manager()
            snapshots = mgr.list_metrics(limit=20)
            return JSONResponse({
                "available": True,
                "profiler": type(profiler).__name__,
                "snapshots": snapshots,
            })
        except (ImportError, Exception) as e:
            mgr = get_telemetry_manager()
            return JSONResponse({
                "available": False,
                "error": str(e),
                "snapshots": mgr.list_metrics(limit=20),
            })


def record_metric(agent_id: str, metric_type: str = "llm_call",
                  latency_ms: float = 0, tokens: int = 0,
                  model: str = "") -> None:
    """Record a telemetry metric (callable from hooks)."""
    get_telemetry_manager().record_metric({
        "agent_id": agent_id,
        "type": metric_type,
        "latency_ms": latency_ms,
        "tokens": tokens,
        "model": model,
    })
