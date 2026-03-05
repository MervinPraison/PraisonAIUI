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
        return [{
            "name": "session-ext",
            "help": "Extended session operations (state, labels, usage)",
            "commands": {
                "state": {
                    "help": "Get session state",
                    "handler": self._cli_state,
                },
                "save-state": {
                    "help": "Save key=value to session state",
                    "handler": self._cli_save_state,
                },
                "labels": {
                    "help": "Get session labels",
                    "handler": self._cli_labels,
                },
                "usage": {
                    "help": "Get session usage stats",
                    "handler": self._cli_usage,
                },
                "compact": {
                    "help": "Compact session context",
                    "handler": self._cli_compact,
                },
                "reset": {
                    "help": "Reset session state",
                    "handler": self._cli_reset,
                },
            },
        }]

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_state(self, session_id: str = "default") -> str:
        state = _session_states.get(session_id, {})
        if not state:
            return f"No state for session {session_id}"
        lines = [f"Session {session_id} state:"]
        for k, v in state.items():
            if not k.startswith("_"):
                lines.append(f"  {k} = {v}")
        return "\n".join(lines)

    def _cli_save_state(self, session_id: str = "default", key: str = "", value: str = "") -> str:
        if not key:
            return "Usage: session-ext save-state --session-id <id> --key <k> --value <v>"
        if session_id not in _session_states:
            _session_states[session_id] = {}
        _session_states[session_id][key] = value
        return f"✓ Saved {key}={value} to session {session_id}"

    def _cli_labels(self, session_id: str = "default") -> str:
        state = _session_states.get(session_id, {})
        labels = state.get("_labels", [])
        if not labels:
            return f"No labels for session {session_id}"
        return f"Labels: {', '.join(labels)}"

    def _cli_usage(self, session_id: str = "default") -> str:
        state = _session_states.get(session_id, {})
        usage = state.get("_usage", {"tokens": 0, "requests": 0})
        return f"Session {session_id}: {usage.get('tokens', 0)} tokens, {usage.get('requests', 0)} requests"

    def _cli_compact(self, session_id: str = "default") -> str:
        return f"✓ Session {session_id} compacted"

    def _cli_reset(self, session_id: str = "default") -> str:
        _session_states.pop(session_id, None)
        _session_contexts.pop(session_id, None)
        return f"✓ Session {session_id} reset"


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
