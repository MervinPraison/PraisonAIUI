"""Realtime voice feature — bidirectional WebRTC + OpenAI Realtime API.

Architecture:
    RealtimeProtocol (ABC)
      └── OpenAIRealtimeManager ← OpenAI Realtime API with WebRTC (lazy import)
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.websockets import WebSocket

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Realtime Protocol ───────────────────────────────────────────────

class RealtimeProtocol(ABC):
    """Protocol interface for bidirectional realtime voice backends."""

    @abstractmethod
    async def create_session(self, *, model: str = "gpt-4o-realtime-preview") -> Dict[str, Any]:
        """Create a new realtime session. Returns session info."""
        ...

    @abstractmethod
    async def send_audio(self, session_id: str, audio_data: bytes) -> None:
        """Send audio chunk to the session."""
        ...

    @abstractmethod
    async def receive_audio(self, session_id: str) -> AsyncIterator[Dict[str, Any]]:
        """Receive audio/transcript events from the session."""
        ...

    @abstractmethod
    async def call_tool(self, session_id: str, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Handle tool calls from the realtime API."""
        ...

    @abstractmethod
    async def close_session(self, session_id: str) -> None:
        """Close a realtime session."""
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── OpenAI Realtime Manager ─────────────────────────────────────────

class OpenAIRealtimeManager(RealtimeProtocol):
    """OpenAI Realtime API backend with ephemeral token support."""

    def __init__(self):
        self._sessions: Dict[str, Any] = {}

    async def create_session(self, *, model: str = "gpt-4o-realtime-preview") -> Dict[str, Any]:
        """Create ephemeral WebRTC session with OpenAI."""
        try:
            import openai
            import uuid

            session_id = str(uuid.uuid4())
            
            # Create ephemeral token for client-side WebRTC
            client = openai.OpenAI()
            response = await client.realtime.sessions.create({
                "model": model,
                "modalities": ["text", "audio"],
                "instructions": "You are a helpful assistant.",
                "voice": "alloy",
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "turn_detection": {"type": "server_vad"},
                "tools": []
            })

            session_info = {
                "session_id": session_id,
                "client_secret": response.client_secret,
                "model": model,
                "status": "created",
                "type": "webrtc",
                "modalities": ["text", "audio"]
            }

            self._sessions[session_id] = session_info
            return session_info

        except ImportError:
            return {
                "type": "error",
                "error": "openai package not installed"
            }
        except Exception as e:
            return {
                "type": "error", 
                "error": str(e)
            }

    async def send_audio(self, session_id: str, audio_data: bytes) -> None:
        """Send audio chunk to OpenAI session."""
        # In WebRTC mode, audio is sent directly to OpenAI
        # This would be handled by the frontend WebRTC connection
        logger.debug(f"Audio chunk for session {session_id}: {len(audio_data)} bytes")

    async def receive_audio(self, session_id: str) -> AsyncIterator[Dict[str, Any]]:
        """Receive events from OpenAI realtime session."""
        # In WebRTC mode, events come via WebRTC connection
        # This method would handle transcript/tool call events
        session = self._sessions.get(session_id)
        if not session:
            yield {"type": "error", "error": "Session not found"}
            return

        # Mock event stream - in real implementation this would connect to OpenAI
        yield {
            "type": "conversation.item.created",
            "item": {
                "id": "msg_001",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": "Hello! I can hear you clearly."}]
            }
        }

    async def call_tool(self, session_id: str, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Handle tool calls from realtime API."""
        return {
            "type": "function_call_output",
            "call_id": args.get("call_id", "unknown"),
            "output": f"Tool {tool_name} called with args: {args}"
        }

    async def close_session(self, session_id: str) -> None:
        """Close realtime session."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.info(f"Closed realtime session: {session_id}")

    def health(self) -> Dict[str, Any]:
        try:
            import openai  # noqa: F401
            return {
                "status": "ok",
                "provider": "OpenAIRealtimeManager",
                "active_sessions": len(self._sessions)
            }
        except ImportError:
            return {
                "status": "degraded",
                "provider": "OpenAIRealtimeManager", 
                "reason": "openai not installed"
            }


# ── Manager singleton ────────────────────────────────────────────────

_realtime_manager: Optional[RealtimeProtocol] = None


def get_realtime_manager() -> RealtimeProtocol:
    global _realtime_manager
    if _realtime_manager is None:
        _realtime_manager = OpenAIRealtimeManager()
    return _realtime_manager


def set_realtime_manager(manager: RealtimeProtocol) -> None:
    global _realtime_manager
    _realtime_manager = manager


# ── Feature class ────────────────────────────────────────────────────

class RealtimeFeature(BaseFeatureProtocol):
    """Bidirectional realtime voice — WebRTC + OpenAI Realtime API."""

    feature_name = "realtime"
    feature_description = "Bidirectional realtime voice with WebRTC and OpenAI"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/realtime/session", self._create_session, methods=["POST"]),
            Route("/api/realtime/session/{session_id}", self._close_session, methods=["DELETE"]),
            Route("/ws/realtime/{session_id}", self._websocket_handler),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "realtime",
            "help": "Realtime voice operations",
            "commands": {
                "sessions": {"help": "List active sessions", "handler": self._cli_sessions},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        mgr = get_realtime_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    async def _create_session(self, request: Request) -> JSONResponse:
        """Create new realtime session."""
        mgr = get_realtime_manager()
        body = await request.json() if request.headers.get("content-type") == "application/json" else {}
        
        result = await mgr.create_session(
            model=body.get("model", "gpt-4o-realtime-preview")
        )
        return JSONResponse(result)

    async def _close_session(self, request: Request) -> JSONResponse:
        """Close realtime session."""
        mgr = get_realtime_manager()
        session_id = request.path_params["session_id"]
        
        await mgr.close_session(session_id)
        return JSONResponse({"status": "closed", "session_id": session_id})

    async def _websocket_handler(self, websocket: WebSocket) -> None:
        """WebSocket handler for realtime events."""
        session_id = websocket.path_params["session_id"]
        mgr = get_realtime_manager()
        
        await websocket.accept()
        
        try:
            # Stream events from realtime session
            async for event in mgr.receive_audio(session_id):
                await websocket.send_json(event)
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            await websocket.send_json({
                "type": "error",
                "error": str(e)
            })
        finally:
            await websocket.close()

    def _cli_sessions(self) -> str:
        """List active realtime sessions."""
        mgr = get_realtime_manager()
        health = mgr.health()
        active_sessions = health.get("active_sessions", 0)
        return f"Active sessions: {active_sessions}"


# Backward-compat alias
PraisonAIRealtime = RealtimeFeature