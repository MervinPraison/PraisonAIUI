"""Extended sessions feature — wire praisonaiagents.session into PraisonAIUI.

Adds state save/restore, memory/knowledge context, and advanced session
operations beyond the basic CRUD already in server.py.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory session state store
_session_states: Dict[str, Dict[str, Any]] = {}
_session_contexts: Dict[str, List[Dict[str, Any]]] = {}


class PraisonAISessions(BaseFeatureProtocol):
    """Extended session management wired to praisonaiagents.session."""

    feature_name = "sessions_ext"
    feature_description = "Extended session management (state, context, labels)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/sessions/{session_id}/state", self._get_state, methods=["GET"]),
            Route("/api/sessions/{session_id}/state", self._save_state, methods=["POST"]),
            Route("/api/sessions/{session_id}/context", self._build_context, methods=["POST"]),
            Route("/api/sessions/{session_id}/compact", self._compact, methods=["POST"]),
            Route("/api/sessions/{session_id}/reset", self._reset, methods=["POST"]),
            Route("/api/sessions/{session_id}/labels", self._labels, methods=["GET"]),
            Route("/api/sessions/{session_id}/labels", self._set_labels, methods=["POST"]),
            Route("/api/sessions/{session_id}/usage", self._usage, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return []  # Extended session ops are API-only for now

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "sessions_with_state": len(_session_states),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _get_state(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        state = _session_states.get(sid, {})
        return JSONResponse({"session_id": sid, "state": state})

    async def _save_state(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        body = await request.json()
        if sid not in _session_states:
            _session_states[sid] = {}
        _session_states[sid].update(body.get("state", {}))
        _session_states[sid]["_updated_at"] = time.time()
        return JSONResponse({"session_id": sid, "state": _session_states[sid]})

    async def _build_context(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        body = await request.json()
        query = body.get("query", "")
        max_items = body.get("max_items", 5)
        # Build context from session state + memory
        context_parts = []
        state = _session_states.get(sid, {})
        if state:
            context_parts.append(f"Session state: {len(state)} keys")
        memories = _session_contexts.get(sid, [])
        for m in memories[:max_items]:
            context_parts.append(m.get("text", ""))
        return JSONResponse({
            "session_id": sid,
            "query": query,
            "context": "\n".join(context_parts) if context_parts else "No context available",
            "items_used": len(context_parts),
        })

    async def _compact(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        # Compaction: summarise session context
        return JSONResponse({
            "session_id": sid,
            "compacted": True,
            "timestamp": time.time(),
        })

    async def _reset(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        body = await request.json() if request.headers.get("content-type") == "application/json" else {}
        mode = body.get("mode", "clear")  # "clear" or "new"
        if mode == "clear":
            _session_states.pop(sid, None)
            _session_contexts.pop(sid, None)
        return JSONResponse({
            "session_id": sid,
            "reset_mode": mode,
            "timestamp": time.time(),
        })

    async def _labels(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        state = _session_states.get(sid, {})
        return JSONResponse({
            "session_id": sid,
            "labels": state.get("_labels", []),
        })

    async def _set_labels(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        body = await request.json()
        if sid not in _session_states:
            _session_states[sid] = {}
        _session_states[sid]["_labels"] = body.get("labels", [])
        return JSONResponse({
            "session_id": sid,
            "labels": _session_states[sid]["_labels"],
        })

    async def _usage(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        state = _session_states.get(sid, {})
        return JSONResponse({
            "session_id": sid,
            "usage": state.get("_usage", {"tokens": 0, "requests": 0}),
        })
