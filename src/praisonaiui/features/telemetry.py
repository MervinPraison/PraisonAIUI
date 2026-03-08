"""Telemetry feature — performance monitoring for PraisonAIUI.

Surfaces LLM call latency, token throughput, function flow analysis,
and profiling data from praisonaiagents.telemetry + profiling via gateway.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory metrics store
_metrics: deque = deque(maxlen=1000)
_perf_snapshots: deque = deque(maxlen=100)


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
        gateway_connected = False
        gateway_agent_count = 0
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                gateway_connected = True
                gateway_agent_count = len(list(gw.list_agents()))
        except (ImportError, Exception):
            pass

        # Check SDK telemetry availability
        telemetry_available = False
        profiling_available = False
        try:
            from praisonaiagents.telemetry import PerformanceMonitor
            telemetry_available = True
        except ImportError:
            pass
        try:
            from praisonaiagents.profiling import Profiler
            profiling_available = True
        except ImportError:
            pass

        return {
            "status": "ok",
            "feature": self.name,
            "telemetry_available": telemetry_available,
            "profiling_available": profiling_available,
            "total_metrics": len(_metrics),
            "total_snapshots": len(_perf_snapshots),
            "gateway_connected": gateway_connected,
            "gateway_agent_count": gateway_agent_count,
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

    async def _overview(self, request: Request) -> JSONResponse:
        """Telemetry overview with aggregate stats."""
        # Compute aggregates
        total_calls = len(_metrics)
        if total_calls == 0:
            return JSONResponse({
                "total_calls": 0,
                "avg_latency_ms": None,
                "total_tokens": 0,
                "by_agent": {},
                "gateway_agents": [],
            })

        total_latency = sum(m.get("latency_ms", 0) for m in _metrics)
        total_tokens = sum(m.get("tokens", 0) for m in _metrics)
        by_agent: Dict[str, Dict[str, Any]] = {}
        for m in _metrics:
            aid = m.get("agent_id", "unknown")
            if aid not in by_agent:
                by_agent[aid] = {"calls": 0, "total_latency_ms": 0, "total_tokens": 0}
            by_agent[aid]["calls"] += 1
            by_agent[aid]["total_latency_ms"] += m.get("latency_ms", 0)
            by_agent[aid]["total_tokens"] += m.get("tokens", 0)

        for s in by_agent.values():
            s["avg_latency_ms"] = s["total_latency_ms"] / s["calls"] if s["calls"] else 0

        # Gateway agents
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

        return JSONResponse({
            "total_calls": total_calls,
            "avg_latency_ms": total_latency / total_calls,
            "total_tokens": total_tokens,
            "by_agent": by_agent,
            "gateway_agents": gateway_agents,
        })

    async def _status(self, request: Request) -> JSONResponse:
        """Telemetry system status."""
        health = await self.health()
        return JSONResponse(health)

    async def _metrics_list(self, request: Request) -> JSONResponse:
        """List recent metrics entries."""
        limit = int(request.query_params.get("limit", "100"))
        agent_id = request.query_params.get("agent_id", None)

        items = list(_metrics)
        if agent_id:
            items = [m for m in items if m.get("agent_id") == agent_id]
        items = items[-limit:]

        return JSONResponse({"metrics": items, "count": len(items)})

    async def _record(self, request: Request) -> JSONResponse:
        """Record a telemetry metric (from hooks/callbacks)."""
        body = await request.json()
        entry = {
            "id": f"met_{int(time.time() * 1000)}",
            "agent_id": body.get("agent_id", "unknown"),
            "type": body.get("type", "llm_call"),
            "latency_ms": body.get("latency_ms", 0),
            "tokens": body.get("tokens", 0),
            "model": body.get("model", ""),
            "timestamp": time.time(),
        }
        _metrics.append(entry)
        return JSONResponse({"recorded": entry["id"]})

    async def _performance(self, request: Request) -> JSONResponse:
        """Get performance data from SDK."""
        perf_data: Dict[str, Any] = {"available": False}
        try:
            from praisonaiagents.telemetry import (
                get_performance_data,
                analyze_performance_trends,
            )
            data = get_performance_data()
            perf_data = {"available": True, "data": data}
        except (ImportError, AttributeError, Exception):
            pass

        # Also try profiling
        try:
            from praisonaiagents.profiling import Profiler
            perf_data["profiling_available"] = True
        except ImportError:
            perf_data["profiling_available"] = False

        return JSONResponse(perf_data)

    async def _profiling(self, request: Request) -> JSONResponse:
        """Get profiling data from SDK."""
        try:
            from praisonaiagents.profiling import Profiler
            profiler = Profiler()
            # Return profiler capabilities
            return JSONResponse({
                "available": True,
                "profiler": type(profiler).__name__,
                "snapshots": list(_perf_snapshots)[-20:],
            })
        except (ImportError, Exception) as e:
            return JSONResponse({
                "available": False,
                "error": str(e),
                "snapshots": list(_perf_snapshots)[-20:],
            })


def record_metric(agent_id: str, metric_type: str = "llm_call",
                  latency_ms: float = 0, tokens: int = 0,
                  model: str = "") -> None:
    """Record a telemetry metric (callable from hooks)."""
    _metrics.append({
        "id": f"met_{int(time.time() * 1000)}",
        "agent_id": agent_id,
        "type": metric_type,
        "latency_ms": latency_ms,
        "tokens": tokens,
        "model": model,
        "timestamp": time.time(),
    })
