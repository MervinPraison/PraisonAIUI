"""Tracing feature — protocol-driven observability for PraisonAIUI.

Architecture:
    TracingProtocol (ABC)          <- any backend implements this
      ├── SimpleTracingManager     <- default in-memory (no deps)
      └── SDKTracingManager        <- wraps praisonaiagents.obs + trace

    PraisonAITracing (BaseFeatureProtocol)
      └── delegates to active TracingProtocol implementation
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


# ── Tracing Protocol ─────────────────────────────────────────────────


class TracingProtocol(ABC):
    """Protocol interface for tracing backends."""

    @abstractmethod
    def list_traces(
        self, *, limit: int = 50, agent_id: Optional[str] = None
    ) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def list_spans(
        self, *, limit: int = 100, trace_id: Optional[str] = None
    ) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def get_trace(self, trace_id: str) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def record_trace(self, trace: Dict[str, Any]) -> str: ...

    @abstractmethod
    def record_span(self, span: Dict[str, Any]) -> str: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Simple Tracing Manager ───────────────────────────────────────────


class SimpleTracingManager(TracingProtocol):
    """In-memory tracing — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._traces: deque = deque(maxlen=200)
        self._spans: deque = deque(maxlen=2000)

    def list_traces(
        self, *, limit: int = 50, agent_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        items = list(self._traces)
        if agent_id:
            items = [t for t in items if t.get("agent_id") == agent_id]
        return items[-limit:]

    def list_spans(
        self, *, limit: int = 100, trace_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        items = list(self._spans)
        if trace_id:
            items = [s for s in items if s.get("trace_id") == trace_id]
        return items[-limit:]

    def get_trace(self, trace_id: str) -> Optional[Dict[str, Any]]:
        for t in self._traces:
            if t.get("id") == trace_id:
                return t
        return None

    def record_trace(self, trace: Dict[str, Any]) -> str:
        tid = trace.get("id", f"trace_{int(time.time() * 1000)}")
        trace["id"] = tid
        trace.setdefault("timestamp", time.time())
        self._traces.append(trace)
        return tid

    def record_span(self, span: Dict[str, Any]) -> str:
        sid = span.get("id", f"span_{int(time.time() * 1000)}")
        span["id"] = sid
        span.setdefault("timestamp", time.time())
        self._spans.append(span)
        return sid

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleTracingManager",
            "total_traces": len(self._traces),
            "total_spans": len(self._spans),
        }


# ── SDK Tracing Manager ──────────────────────────────────────────────


class SDKTracingManager(TracingProtocol):
    """Wraps praisonaiagents.obs + trace for production use."""

    def __init__(self) -> None:
        self._trace_available = False
        self._obs_available = False
        try:
            from praisonaiagents.trace import ActionEvent  # noqa: F401

            self._trace_available = True
        except (ImportError, AttributeError):
            pass
        try:
            from praisonaiagents.obs import Span, Trace  # noqa: F401

            self._obs_available = True
        except ImportError:
            pass
        if not (self._trace_available or self._obs_available):
            raise ImportError("Neither praisonaiagents.trace nor praisonaiagents.obs available")
        self._simple = SimpleTracingManager()
        logger.info(
            "SDKTracingManager initialized (trace=%s, obs=%s)",
            self._trace_available,
            self._obs_available,
        )

    def list_traces(
        self, *, limit: int = 50, agent_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        return self._simple.list_traces(limit=limit, agent_id=agent_id)

    def list_spans(
        self, *, limit: int = 100, trace_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        return self._simple.list_spans(limit=limit, trace_id=trace_id)

    def get_trace(self, trace_id: str) -> Optional[Dict[str, Any]]:
        return self._simple.get_trace(trace_id)

    def record_trace(self, trace: Dict[str, Any]) -> str:
        return self._simple.record_trace(trace)

    def record_span(self, span: Dict[str, Any]) -> str:
        return self._simple.record_span(span)

    def health(self) -> Dict[str, Any]:
        h = self._simple.health()
        h["provider"] = "SDKTracingManager"
        h["trace_available"] = self._trace_available
        h["obs_available"] = self._obs_available
        return h


# ── Manager singleton ────────────────────────────────────────────────

_tracing_manager: Optional[TracingProtocol] = None


def get_tracing_manager() -> TracingProtocol:
    """Get the active tracing manager (SDK-first, fallback to Simple)."""
    global _tracing_manager
    if _tracing_manager is None:
        try:
            _tracing_manager = SDKTracingManager()
            logger.info("Using SDKTracingManager")
        except Exception as e:
            logger.debug("SDKTracingManager init failed (%s), using SimpleTracingManager", e)
            _tracing_manager = SimpleTracingManager()
    return _tracing_manager


class TracingFeature(BaseFeatureProtocol):
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

        mgr = get_tracing_manager()
        return {
            "status": "ok",
            "feature": self.name,
            **mgr.health(),
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

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "traces",
                "help": "Manage distributed traces (list, spans, get)",
                "commands": {
                    "status": {
                        "help": "Show tracing status",
                        "handler": self._cli_status,
                    },
                    "list": {
                        "help": "List recent traces",
                        "handler": self._cli_list,
                    },
                    "spans": {
                        "help": "List recent spans",
                        "handler": self._cli_spans,
                    },
                    "get": {
                        "help": "Get a specific trace by ID",
                        "handler": self._cli_get,
                    },
                },
            }
        ]

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_status(self) -> str:
        mgr = get_tracing_manager()
        h = mgr.health()
        lines = ["Tracing Status:"]
        lines.append(f"  Provider: {h.get('provider', 'unknown')}")
        lines.append(f"  Total traces: {h.get('total_traces', 0)}")
        lines.append(f"  Total spans: {h.get('total_spans', 0)}")
        if "trace_available" in h:
            lines.append(f"  SDK trace: {'available' if h['trace_available'] else 'unavailable'}")
        if "obs_available" in h:
            lines.append(f"  SDK obs: {'available' if h['obs_available'] else 'unavailable'}")
        return "\n".join(lines)

    def _cli_list(self, limit: int = 20) -> str:
        mgr = get_tracing_manager()
        items = mgr.list_traces(limit=limit)
        if not items:
            return "No traces recorded yet."
        lines = [f"Traces ({len(items)}):"]
        for t in items:
            name = t.get("name", "")
            status = t.get("status", "?")
            dur = t.get("duration_ms", 0)
            spans = t.get("span_count", 0)
            lines.append(f"  [{t.get('id', '')}] {name} status={status} {dur}ms spans={spans}")
        return "\n".join(lines)

    def _cli_spans(self, limit: int = 20, trace_id: str = "") -> str:
        mgr = get_tracing_manager()
        items = mgr.list_spans(limit=limit, trace_id=trace_id or None)
        if not items:
            return "No spans recorded yet."
        lines = [f"Spans ({len(items)}):"]
        for s in items:
            name = s.get("name", "")
            kind = s.get("kind", "?")
            dur = s.get("duration_ms", 0)
            lines.append(f"  [{s.get('id', '')}] {name} kind={kind} {dur}ms")
        return "\n".join(lines)

    def _cli_get(self, trace_id: str = "") -> str:
        if not trace_id:
            return "Usage: traces get --trace-id <id>"
        mgr = get_tracing_manager()
        trace = mgr.get_trace(trace_id)
        if trace is None:
            return f"Trace {trace_id} not found."
        spans = mgr.list_spans(trace_id=trace_id)
        lines = [f"Trace: {trace.get('id', '')}"]
        lines.append(f"  Agent: {trace.get('agent_id', '?')}")
        lines.append(f"  Name: {trace.get('name', '')}")
        lines.append(f"  Status: {trace.get('status', '?')}")
        lines.append(f"  Duration: {trace.get('duration_ms', 0)}ms")
        lines.append(f"  Spans ({len(spans)}):")
        for s in spans:
            lines.append(f"    [{s.get('id', '')}] {s.get('name', '')} {s.get('duration_ms', 0)}ms")
        return "\n".join(lines)

    async def _list_traces(self, request: Request) -> JSONResponse:
        mgr = get_tracing_manager()
        limit = int(request.query_params.get("limit", "50"))
        agent_id = request.query_params.get("agent_id", None)
        items = mgr.list_traces(limit=limit, agent_id=agent_id)
        return JSONResponse({"traces": items, "count": len(items)})

    async def _status(self, request: Request) -> JSONResponse:
        health = await self.health()
        return JSONResponse(health)

    async def _list_spans(self, request: Request) -> JSONResponse:
        mgr = get_tracing_manager()
        limit = int(request.query_params.get("limit", "100"))
        trace_id = request.query_params.get("trace_id", None)
        items = mgr.list_spans(limit=limit, trace_id=trace_id)
        return JSONResponse({"spans": items, "count": len(items)})

    async def _get_trace(self, request: Request) -> JSONResponse:
        mgr = get_tracing_manager()
        trace_id = request.path_params["trace_id"]
        trace = mgr.get_trace(trace_id)
        if trace is None:
            return JSONResponse({"error": "trace not found"}, status_code=404)
        spans = mgr.list_spans(trace_id=trace_id)
        return JSONResponse({"trace": trace, "spans": spans})

    async def _record(self, request: Request) -> JSONResponse:
        mgr = get_tracing_manager()
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
            }
            tid = mgr.record_trace(trace)
            return JSONResponse({"recorded": tid, "type": "trace"})
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
            }
            sid = mgr.record_span(span)
            return JSONResponse({"recorded": sid, "type": "span"})


def record_span(
    trace_id: str,
    agent_id: str,
    name: str,
    duration_ms: float = 0,
    kind: str = "internal",
    attributes: Optional[Dict[str, Any]] = None,
) -> str:
    """Record a span (callable from hooks/trace integration)."""
    mgr = get_tracing_manager()
    return mgr.record_span(
        {
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
        }
    )


# Backward-compat alias
PraisonAITracing = TracingFeature
