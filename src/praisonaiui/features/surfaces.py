"""A2UI surface state — agent-driven UI surfaces via REST + WebSocket."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from praisonaiui.a2ui_utils import normalise_a2ui_messages

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

_surface_action_handlers: Dict[str, Callable] = {}


def register_surface_action(surface_id: str, handler: Callable) -> None:
    """Register a handler for user actions on a surface."""
    _surface_action_handlers[surface_id] = handler


def get_surface_action_handler(surface_id: str) -> Optional[Callable]:
    return _surface_action_handlers.get(surface_id)


@dataclass
class SurfaceState:
    """In-memory surface with A2UI message log."""

    id: str
    messages: List[Dict[str, Any]] = field(default_factory=list)
    updated_at: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)


class SurfaceStore:
    """Thread-safe in-memory surface store."""

    def __init__(self) -> None:
        self._surfaces: Dict[str, SurfaceState] = {}
        self._lock = asyncio.Lock()
        self._action_queue: List[Dict[str, Any]] = []

    async def list_surfaces(self) -> List[Dict[str, Any]]:
        async with self._lock:
            return [
                {
                    "id": s.id,
                    "message_count": len(s.messages),
                    "updated_at": s.updated_at,
                    "metadata": s.metadata,
                }
                for s in self._surfaces.values()
            ]

    async def get(self, surface_id: str) -> Optional[SurfaceState]:
        async with self._lock:
            return self._surfaces.get(surface_id)

    async def get_or_create(self, surface_id: str) -> SurfaceState:
        async with self._lock:
            if surface_id not in self._surfaces:
                self._surfaces[surface_id] = SurfaceState(id=surface_id)
            return self._surfaces[surface_id]

    async def apply_messages(
        self, surface_id: str, messages: List[Dict[str, Any]]
    ) -> SurfaceState:
        normalised = normalise_a2ui_messages({"messages": messages})
        async with self._lock:
            state = self._surfaces.setdefault(surface_id, SurfaceState(id=surface_id))
            if any(m.get("createSurface") for m in normalised):
                state.messages = list(normalised)
            else:
                state.messages.extend(normalised)
            state.updated_at = time.time()
            return state

    async def set_messages(
        self, surface_id: str, messages: List[Dict[str, Any]]
    ) -> SurfaceState:
        normalised = normalise_a2ui_messages({"messages": messages})
        async with self._lock:
            state = self._surfaces.setdefault(surface_id, SurfaceState(id=surface_id))
            state.messages = normalised
            state.updated_at = time.time()
            return state

    async def clear(self, surface_id: str) -> bool:
        async with self._lock:
            return self._surfaces.pop(surface_id, None) is not None

    async def queue_action(self, action: Dict[str, Any]) -> None:
        async with self._lock:
            self._action_queue.append(action)

    async def pop_actions(self, limit: int = 50) -> List[Dict[str, Any]]:
        async with self._lock:
            items = self._action_queue[:limit]
            self._action_queue = self._action_queue[limit:]
            return items


_store: Optional[SurfaceStore] = None


def get_surface_store() -> SurfaceStore:
    global _store
    if _store is None:
        _store = SurfaceStore()
    return _store


def set_surface_store(store: SurfaceStore) -> None:
    global _store
    _store = store


async def broadcast_a2ui_surface(
    surface_id: str,
    messages: List[Dict[str, Any]],
    session_id: Optional[str] = None,
) -> None:
    """Push A2UI update to WebSocket clients."""
    payload: Dict[str, Any] = {
        "type": "a2ui_surface",
        "surface_id": surface_id,
        "messages": messages,
    }
    if session_id:
        payload["session_id"] = session_id
    try:
        from praisonaiui.features.chat import get_chat_manager

        mgr = get_chat_manager()
        await mgr.broadcast(session_id or "", payload)
    except Exception as exc:
        logger.debug("Surface broadcast skipped: %s", exc)


async def ingest_a2ui_extra(
    extra_data: Optional[Dict[str, Any]],
    session_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Apply A2UI from RunEvent extra_data and broadcast."""
    if not extra_data:
        return None
    a2ui = extra_data.get("a2ui")
    if not a2ui:
        return None
    surface_id = str(extra_data.get("surface_id", "main"))
    store = get_surface_store()
    # Tool results are a full snapshot — replace, do not stack old components.
    state = await store.set_messages(surface_id, a2ui)
    await broadcast_a2ui_surface(surface_id, state.messages, session_id=session_id)
    return {"surface_id": surface_id, "messages": state.messages}


def attach_a2ui_to_payload(payload: Dict[str, Any], extra_data: Optional[Dict[str, Any]]) -> None:
    """Copy A2UI fields from RunEvent extra_data onto a wire payload."""
    if not extra_data:
        return
    if extra_data.get("a2ui"):
        payload["a2ui"] = extra_data["a2ui"]
        payload["surface_id"] = extra_data.get("surface_id", "main")
    if extra_data.get("extra_data"):
        nested = extra_data["extra_data"]
        if isinstance(nested, dict) and nested.get("a2ui"):
            payload["a2ui"] = nested["a2ui"]
            payload["surface_id"] = nested.get("surface_id", "main")


async def _list_surfaces(_request: Request) -> JSONResponse:
    store = get_surface_store()
    return JSONResponse({"surfaces": await store.list_surfaces()})


async def _get_surface(request: Request) -> JSONResponse:
    surface_id = request.path_params["surface_id"]
    store = get_surface_store()
    state = await store.get(surface_id)
    if not state:
        # Empty canvas is normal before the first A2UI push — not an error.
        return JSONResponse(
            {
                "id": surface_id,
                "messages": [],
                "updated_at": None,
                "metadata": {},
            }
        )
    return JSONResponse(
        {
            "id": state.id,
            "messages": state.messages,
            "updated_at": state.updated_at,
            "metadata": state.metadata,
        }
    )


async def _post_messages(request: Request) -> JSONResponse:
    surface_id = request.path_params["surface_id"]
    body = await request.json()
    messages = body.get("messages", [])
    if not isinstance(messages, list):
        return JSONResponse({"error": "messages must be a list"}, status_code=400)
    store = get_surface_store()
    if body.get("replace"):
        state = await store.set_messages(surface_id, messages)
    else:
        state = await store.apply_messages(surface_id, messages)
    await broadcast_a2ui_surface(surface_id, state.messages)
    return JSONResponse({"id": state.id, "message_count": len(state.messages)})


async def _post_action(request: Request) -> JSONResponse:
    surface_id = request.path_params["surface_id"]
    body = await request.json()
    action = {
        "type": "a2ui_action",
        "surface_id": surface_id,
        "component_id": body.get("component_id"),
        "action": body.get("action"),
        "data": body.get("data", {}),
        "session_id": body.get("session_id"),
    }
    store = get_surface_store()
    await store.queue_action(action)

    handler = get_surface_action_handler(surface_id)
    if handler:
        try:
            result = handler(action)
            if asyncio.iscoroutine(result):
                result = await result
            return JSONResponse({"status": "handled", "result": result})
        except Exception as exc:
            logger.error("Surface action handler error: %s", exc)
            return JSONResponse({"status": "error", "error": str(exc)}, status_code=500)

    # Inject as chat message when session_id provided
    session_id = body.get("session_id")
    if session_id:
        try:
            from praisonaiui.features.chat import ChatMessage, get_chat_manager

            mgr = get_chat_manager()
            msg = ChatMessage(
                role="user",
                content=f"[A2UI action on {surface_id}] {body.get('action', '')}: {body.get('data', {})}",
                session_id=session_id,
            )
            mgr._history.setdefault(session_id, []).append(msg)
        except Exception:
            pass

    return JSONResponse({"status": "queued", "action": action})


async def _delete_surface(request: Request) -> JSONResponse:
    surface_id = request.path_params["surface_id"]
    store = get_surface_store()
    removed = await store.clear(surface_id)
    if not removed:
        return JSONResponse({"error": "Surface not found"}, status_code=404)
    return JSONResponse({"status": "deleted", "id": surface_id})


class SurfacesFeature(BaseFeatureProtocol):
    """A2UI surface CRUD and user action endpoints."""

    feature_name = "surfaces"
    feature_description = "Agent-driven A2UI surfaces"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/surfaces", _list_surfaces, methods=["GET"]),
            Route("/api/surfaces/{surface_id}", _get_surface, methods=["GET"]),
            Route("/api/surfaces/{surface_id}/messages", _post_messages, methods=["POST"]),
            Route("/api/surfaces/{surface_id}/action", _post_action, methods=["POST"]),
            Route("/api/surfaces/{surface_id}", _delete_surface, methods=["DELETE"]),
        ]

    async def health(self) -> Dict[str, Any]:
        store = get_surface_store()
        surfaces = await store.list_surfaces()
        return {"status": "ok", "feature": self.name, "surface_count": len(surfaces)}
