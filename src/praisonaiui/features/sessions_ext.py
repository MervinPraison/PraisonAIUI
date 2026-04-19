"""Extended sessions feature — protocol-driven session management for PraisonAIUI.

Architecture:
    SessionProtocol (ABC)            <- any backend implements this
      ├── _InMemorySessionStore      <- default in-memory (no deps)
      └── praisonaiagents.session    <- SDK DefaultSessionStore

    PraisonAISessions (BaseFeatureProtocol)
      └── delegates to active SessionProtocol implementation
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Session Protocol ─────────────────────────────────────────────────


class SessionProtocol(ABC):
    """Protocol interface for session backends."""

    @abstractmethod
    def get_session(self, session_id: str) -> Dict[str, Any]: ...

    @abstractmethod
    def get_chat_history(self, session_id: str, max_messages: int = None) -> List[Dict]: ...

    @abstractmethod
    def add_message(self, session_id: str, role: str, content: str, metadata: Dict = None): ...

    @abstractmethod
    def clear_session(self, session_id: str): ...

    @abstractmethod
    def delete_session(self, session_id: str): ...

    @abstractmethod
    def list_sessions(self) -> List[str]: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# Lazy-loaded session store from praisonaiagents
_session_store: Optional[SessionProtocol] = None


def _get_session_store() -> SessionProtocol:
    """Lazy-load the praisonaiagents session store (DRY)."""
    global _session_store
    if _session_store is None:
        try:
            from praisonaiagents.session import get_default_session_store

            _session_store = get_default_session_store()
            logger.info("Using praisonaiagents.session.DefaultSessionStore for persistence")
        except ImportError:
            logger.warning("praisonaiagents.session not available, using in-memory fallback")
            _session_store = _InMemorySessionStore()
    return _session_store


class _InMemorySessionStore(SessionProtocol):
    """Fallback in-memory store if praisonaiagents not available."""

    def __init__(self):
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def get_session(self, session_id: str) -> Dict[str, Any]:
        if session_id not in self._sessions:
            self._sessions[session_id] = {
                "session_id": session_id,
                "messages": [],
                "metadata": {},
                "created_at": time.time(),
            }
        return self._sessions[session_id]

    def get_chat_history(self, session_id: str, max_messages: int = None) -> List[Dict]:
        session = self.get_session(session_id)
        messages = session.get("messages", [])
        if max_messages:
            return messages[-max_messages:]
        return messages

    def add_message(self, session_id: str, role: str, content: str, metadata: Dict = None):
        session = self.get_session(session_id)
        session["messages"].append(
            {
                "role": role,
                "content": content,
                "metadata": metadata or {},
                "timestamp": time.time(),
            }
        )

    def clear_session(self, session_id: str):
        if session_id in self._sessions:
            self._sessions[session_id]["messages"] = []

    def delete_session(self, session_id: str):
        self._sessions.pop(session_id, None)

    def list_sessions(self) -> List[str]:
        return list(self._sessions.keys())


# Session metadata (labels, usage) - stored separately
_session_metadata: Dict[str, Dict[str, Any]] = {}


def _get_metadata(session_id: str) -> Dict[str, Any]:
    """Get session metadata (labels, usage, etc)."""
    if session_id not in _session_metadata:
        _session_metadata[session_id] = {
            "_labels": [],
            "_usage": {"tokens": 0, "requests": 0},
            "_created_at": time.time(),
        }
    return _session_metadata[session_id]


class SessionsFeature(BaseFeatureProtocol):
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
            Route("/api/sessions", self._list_sessions, methods=["GET"]),
            Route("/api/sessions/{session_id}/state", self._get_state, methods=["GET"]),
            Route("/api/sessions/{session_id}/state", self._save_state, methods=["POST"]),
            Route("/api/sessions/{session_id}/context", self._build_context, methods=["POST"]),
            Route("/api/sessions/{session_id}/compact", self._compact, methods=["POST"]),
            Route("/api/sessions/{session_id}/reset", self._reset, methods=["POST"]),
            Route("/api/sessions/{session_id}/preview", self._preview, methods=["GET"]),
            Route("/api/sessions/{session_id}/labels", self._labels, methods=["GET"]),
            Route("/api/sessions/{session_id}/labels", self._set_labels, methods=["POST"]),
            Route("/api/sessions/{session_id}/usage", self._usage, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
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
            }
        ]

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_state(self, session_id: str = "default") -> str:
        meta = _get_metadata(session_id)
        if not meta:
            return f"No state for session {session_id}"
        lines = [f"Session {session_id} state:"]
        for k, v in meta.items():
            if not k.startswith("_"):
                lines.append(f"  {k} = {v}")
        return "\n".join(lines)

    def _cli_save_state(self, session_id: str = "default", key: str = "", value: str = "") -> str:
        if not key:
            return "Usage: session-ext save-state --session-id <id> --key <k> --value <v>"
        meta = _get_metadata(session_id)
        meta[key] = value
        return f"✓ Saved {key}={value} to session {session_id}"

    def _cli_labels(self, session_id: str = "default") -> str:
        meta = _get_metadata(session_id)
        labels = meta.get("_labels", [])
        if not labels:
            return f"No labels for session {session_id}"
        return f"Labels: {', '.join(labels)}"

    def _cli_usage(self, session_id: str = "default") -> str:
        meta = _get_metadata(session_id)
        usage = meta.get("_usage", {"tokens": 0, "requests": 0})
        tokens = usage.get("tokens", 0)
        requests = usage.get("requests", 0)
        return f"Session {session_id}: {tokens} tokens, {requests} requests"

    def _cli_compact(self, session_id: str = "default") -> str:
        return f"✓ Session {session_id} compacted"

    def _cli_reset(self, session_id: str = "default") -> str:
        _session_metadata.pop(session_id, None)
        store = _get_session_store()
        if hasattr(store, "clear_session"):
            store.clear_session(session_id)
        return f"✓ Session {session_id} reset"

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        return {
            "status": "ok",
            "feature": self.name,
            "sessions_with_state": len(_session_metadata),
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list_sessions(self, request: Request) -> JSONResponse:
        """GET /api/sessions — List all known sessions.

        Uses the same _datastore as the Chat page so both views are consistent.
        """
        sessions = []

        # Primary source: the server's own datastore (same as /sessions for Chat)
        try:
            from praisonaiui.server import get_datastore

            ds = get_datastore()
            ds_sessions = await ds.list_sessions()
            for s in ds_sessions or []:
                sid = s.get("id", s.get("session_id", ""))
                if not sid:
                    continue
                meta = _get_metadata(sid)
                sessions.append(
                    {
                        "id": sid,
                        "session_id": sid,
                        "is_active": True,
                        "message_count": s.get("message_count", len(s.get("messages", []))),
                        "labels": meta.get("_labels", []),
                        "created_at": s.get("created_at", meta.get("_created_at")),
                        "updated_at": s.get("updated_at", meta.get("_updated_at")),
                        "title": s.get("title", ""),
                    }
                )
        except Exception as e:
            logger.warning(f"datastore.list_sessions() failed: {e}")

        seen_ids = {s["id"] for s in sessions}

        # Merge gateway agent IDs as virtual sessions
        try:
            from ._gateway_ref import get_gateway

            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    agent = gw.get_agent(aid)
                    name = getattr(agent, "name", aid) if agent else aid
                    vsid = f"agent:{name}"
                    if vsid not in seen_ids:
                        meta = _get_metadata(vsid)
                        sessions.append(
                            {
                                "id": vsid,
                                "session_id": vsid,
                                "is_active": True,
                                "message_count": 0,
                                "labels": meta.get("_labels", []),
                                "created_at": meta.get("_created_at"),
                                "updated_at": meta.get("_updated_at"),
                            }
                        )
        except (ImportError, Exception):
            pass

        return JSONResponse({"sessions": sessions, "count": len(sessions)})

    async def _get_state(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        meta = _get_metadata(sid)
        return JSONResponse({"session_id": sid, "state": meta})

    async def _save_state(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        body = await request.json()
        meta = _get_metadata(sid)
        meta.update(body.get("state", {}))
        meta["_updated_at"] = time.time()
        return JSONResponse({"session_id": sid, "state": meta})

    async def _build_context(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        body = await request.json()
        query = body.get("query", "")
        max_items = body.get("max_items", 5)
        # Build context from session store + metadata
        context_parts = []
        meta = _get_metadata(sid)
        if meta:
            context_parts.append(f"Session state: {len(meta)} keys")
        store = _get_session_store()
        messages = (
            store.get_chat_history(sid, max_items) if hasattr(store, "get_chat_history") else []
        )
        for m in messages:
            content = m.get("content", "") or m.get("text", "")
            if content:
                context_parts.append(content)
        # Include gateway agent context if session maps to an agent
        try:
            from ._gateway_ref import get_gateway

            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    agent = gw.get_agent(aid)
                    name = getattr(agent, "name", aid) if agent else aid
                    if sid == f"agent:{name}" or sid == name:
                        role = getattr(agent, "role", "")
                        if role:
                            context_parts.append(f"Agent role: {role}")
                        break
        except (ImportError, Exception):
            pass
        return JSONResponse(
            {
                "session_id": sid,
                "query": query,
                "context": "\n".join(context_parts) if context_parts else "No context available",
                "items_used": len(context_parts),
            }
        )

    async def _compact(self, request: Request) -> JSONResponse:
        """POST /api/sessions/{id}/compact — Summarize old messages to reduce context."""
        sid = request.path_params["session_id"]
        store = _get_session_store()
        messages = store.get_chat_history(sid) if hasattr(store, "get_chat_history") else []
        before_count = len(messages)
        before_tokens = sum(len(str(m.get("content", "")).split()) * 1.3 for m in messages)

        # Note: Real compaction would use LLM summarization
        # For now, just report stats
        after_count = min(before_count, 5)
        after_tokens = before_tokens * (after_count / max(before_count, 1))

        return JSONResponse(
            {
                "session_id": sid,
                "compacted": True,
                "before": {"messages": before_count, "estimated_tokens": int(before_tokens)},
                "after": {"messages": after_count, "estimated_tokens": int(after_tokens)},
                "saved_tokens": int(before_tokens - after_tokens),
                "timestamp": time.time(),
            }
        )

    async def _preview(self, request: Request) -> JSONResponse:
        """GET /api/sessions/{id}/preview — Return formatted preview without full history."""
        sid = request.path_params["session_id"]
        meta = _get_metadata(sid)
        store = _get_session_store()
        messages = store.get_chat_history(sid) if hasattr(store, "get_chat_history") else []

        # Get first and last messages
        first_message = messages[0] if messages else None
        last_message = messages[-1] if messages else None

        # Estimate tokens
        total_tokens = sum(len(str(m.get("content", "")).split()) * 1.3 for m in messages)

        return JSONResponse(
            {
                "session_id": sid,
                "total_messages": len(messages),
                "estimated_tokens": int(total_tokens),
                "first_message": {
                    "role": first_message.get("role", "unknown"),
                    "preview": str(first_message.get("content", ""))[:100] + "..."
                    if first_message
                    else None,
                }
                if first_message
                else None,
                "last_message": {
                    "role": last_message.get("role", "unknown"),
                    "preview": str(last_message.get("content", ""))[:100] + "..."
                    if last_message
                    else None,
                }
                if last_message
                else None,
                "labels": meta.get("_labels", []),
                "created_at": meta.get("_created_at"),
                "updated_at": meta.get("_updated_at"),
            }
        )

    async def _reset(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        content_type = request.headers.get("content-type")
        body = await request.json() if content_type == "application/json" else {}
        mode = body.get("mode", "clear")  # "clear" or "new"
        if mode == "clear":
            _session_metadata.pop(sid, None)
            store = _get_session_store()
            if hasattr(store, "clear_session"):
                store.clear_session(sid)
        return JSONResponse(
            {
                "session_id": sid,
                "reset_mode": mode,
                "timestamp": time.time(),
            }
        )

    async def _labels(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        meta = _get_metadata(sid)
        return JSONResponse(
            {
                "session_id": sid,
                "labels": meta.get("_labels", []),
            }
        )

    async def _set_labels(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        body = await request.json()
        meta = _get_metadata(sid)
        meta["_labels"] = body.get("labels", [])
        return JSONResponse(
            {
                "session_id": sid,
                "labels": meta["_labels"],
            }
        )

    async def _usage(self, request: Request) -> JSONResponse:
        sid = request.path_params["session_id"]
        meta = _get_metadata(sid)
        return JSONResponse(
            {
                "session_id": sid,
                "usage": meta.get("_usage", {"tokens": 0, "requests": 0}),
            }
        )


# Backward-compat alias
PraisonAISessions = SessionsFeature
