"""Tracing feature — distributed tracing and observability for PraisonAIUI.

Surfaces execution spans, call trees, and trace visualization from
the praisonaiagents.trace + obs modules via gateway.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory trace store
_traces: deque = deque(maxlen=200)
_spans: deque = deque(maxlen=2000)


class PraisonAITracing(BaseFeatureProtocol):
    """Tracing and observability feature."""

    feature_name = "tracing"
    feature_description = "Distributed tracing and observability"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        # Check SDK availability
        trace_available = False
        obs_available = False
        try:
            from praisonaiagents.trace import Trace  # noqa: F401
            trace_available = True
        except ImportError:
            pass
        try:
            from praisonaiagents.obs import Span, Trace as ObsTrace  # noqa: F401
            obs_available = True
        except ImportError:
            pass

        return {
            "status": "ok",
            "feature": self.name,
            "trace_available": trace_available,
            "obs_available": obs_available,
            "total_traces": len(_traces),
            "total_spans": len(_spans),
            **gateway_health(),
        }

    def routes(self) -> List[Route]:
        return [
            Route("/api/traces", self._list_traces, methods=["GET"]),
            Route("/api/traces/status", self._status, methods=["GET"]),
            Route("/api/traces/spans", self._list_spans, methods=["GET"]),
            Route("/api/traces/record", self._record, methods=["POST"]),
            Route("/api/traces/{trace_id:path}", self._get_trace, methods=["GET"]),
        ]

    async def _list_traces(self, request: Request) -> JSONResponse:
        """List recent traces."""
        limit = int(request.query_params.get("limit", "50"))
        agent_id = request.query_params.get("agent_id", None)

        items = list(_traces)
        if agent_id:
            items = [t for t in items if t.get("agent_id") == agent_id]
        items = items[-limit:]

        return JSONResponse({"traces": items, "count": len(items)})

    async def _status(self, request: Request) -> JSONResponse:
        """Tracing system status."""
        health = await self.health()
        return JSONResponse(health)

    async def _list_spans(self, request: Request) -> JSONResponse:
        """List recent spans."""
        limit = int(request.query_params.get("limit", "100"))
        trace_id = request.query_params.get("trace_id", None)

        items = list(_spans)
        if trace_id:
            items = [s for s in items if s.get("trace_id") == trace_id]
        items = items[-limit:]

        return JSONResponse({"spans": items, "count": len(items)})

    async def _get_trace(self, request: Request) -> JSONResponse:
        """Get a single trace with its spans."""
        trace_id = request.path_params["trace_id"]
        
        trace = None
        for t in _traces:
            if t.get("id") == trace_id:
                trace = t
                break

        if trace is None:
            return JSONResponse({"error": "trace not found"}, status_code=404)

        spans = [s for s in _spans if s.get("trace_id") == trace_id]
        return JSONResponse({"trace": trace, "spans": spans})

    async def _record(self, request: Request) -> JSONResponse:
        """Record a trace/span (from hooks/callbacks)."""
        body = await request.json()
        record_type = body.get("type", "span")

        if record_type == "trace":
            trace = {
                "id": body.get("id", f"trace_{int(time.time() * 1000)}"),
                "agent_id": body.get("agent_id", "unknown"),
                "name": body.get("name", ""),
                "status": body.get("status", "completed"),
                "start_time": body.get("start_time", time.time()),
                "end_time": body.get("end_time", time.time()),
                "duration_ms": body.get("duration_ms", 0),
                "span_count": body.get("span_count", 0),
                "metadata": body.get("metadata", {}),
                "timestamp": time.time(),
            }
            _traces.append(trace)
            return JSONResponse({"recorded": trace["id"], "type": "trace"})
        else:
            span = {
                "id": body.get("id", f"span_{int(time.time() * 1000)}"),
                "trace_id": body.get("trace_id", ""),
                "parent_span_id": body.get("parent_span_id", None),
                "agent_id": body.get("agent_id", "unknown"),
                "name": body.get("name", ""),
                "kind": body.get("kind", "internal"),
                "status": body.get("status", "ok"),
                "start_time": body.get("start_time", time.time()),
                "end_time": body.get("end_time", time.time()),
                "duration_ms": body.get("duration_ms", 0),
                "attributes": body.get("attributes", {}),
                "events": body.get("events", []),
                "timestamp": time.time(),
            }
            _spans.append(span)
            return JSONResponse({"recorded": span["id"], "type": "span"})


def record_span(trace_id: str, agent_id: str, name: str,
                duration_ms: float = 0, kind: str = "internal",
                attributes: Optional[Dict[str, Any]] = None) -> str:
    """Record a span (callable from hooks/trace integration)."""
    span_id = f"span_{int(time.time() * 1000)}"
    _spans.append({
        "id": span_id,
        "trace_id": trace_id,
        "agent_id": agent_id,
        "name": name,
        "kind": kind,
        "status": "ok",
        "start_time": time.time() - (duration_ms / 1000),
        "end_time": time.time(),
        "duration_ms": duration_ms,
        "attributes": attributes or {},
        "events": [],
        "timestamp": time.time(),
    })
    return span_id
