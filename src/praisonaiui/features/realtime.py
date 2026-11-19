"""Realtime voice feature — bidirectional WebRTC + OpenAI Realtime API.

Architecture:
    RealtimeProtocol (ABC)
      └── OpenAIRealtimeManager ← OpenAI Realtime API with WebRTC (lazy import)

Voice input (speech to text): an app that calls
``aiui.set_realtime_manager(manager)`` with a manager that implements
:meth:`RealtimeProtocol.transcribe` turns it on. ``GET /api/realtime/voice``
says whether it is on; ``POST /api/realtime/transcribe`` turns one recorded
clip into text. The chat composer's microphone uses them (frontend
``chat-engine/VoiceInput.tsx``); see ``docs/features/realtime-voice-input.md``.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.websockets import WebSocket

from ._base import BaseFeatureProtocol, sdk_installed

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
    async def call_tool(
        self, session_id: str, tool_name: str, args: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle tool calls from the realtime API."""
        ...

    @abstractmethod
    async def close_session(self, session_id: str) -> None:
        """Close a realtime session."""
        ...

    async def transcribe(self, audio: bytes, *, mime_type: str) -> str:
        """Turn one recorded clip (``audio/webm``, ``audio/mp4``…) into text.

        Optional: voice input is on only while the app's manager
        implements it.
        """
        raise NotImplementedError

    def supports_transcription(self) -> bool:
        """True when this manager's class implements :meth:`transcribe`."""
        return type(self).transcribe is not RealtimeProtocol.transcribe

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── OpenAI Realtime Manager ─────────────────────────────────────────


class OpenAIRealtimeManager(RealtimeProtocol):
    """OpenAI Realtime API backend with ephemeral token support."""

    #: Speech-to-text model for :meth:`transcribe` (voice input).
    DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"

    def __init__(self, *, transcribe_model: Optional[str] = None):
        self._sessions: Dict[str, Any] = {}
        self.transcribe_model = transcribe_model or self.DEFAULT_TRANSCRIBE_MODEL

    async def transcribe(self, audio: bytes, *, mime_type: str) -> str:
        """Transcribe a clip with OpenAI's speech-to-text endpoint.

        Uses ``OPENAI_API_KEY`` (and ``OPENAI_BASE_URL``) like every OpenAI
        client; ``openai`` is imported here, never at module import.
        """
        from openai import AsyncOpenAI

        ext = _AUDIO_EXTENSIONS.get(mime_type.split(";")[0].strip().lower(), "webm")
        result = await AsyncOpenAI().audio.transcriptions.create(
            model=self.transcribe_model,
            file=(f"voice.{ext}", audio, mime_type),
        )
        return getattr(result, "text", "") or ""

    async def create_session(self, *, model: str = "gpt-4o-realtime-preview") -> Dict[str, Any]:
        """Create ephemeral WebRTC session with OpenAI."""
        try:
            import uuid

            import openai

            session_id = str(uuid.uuid4())

            # Create ephemeral token for client-side WebRTC
            client = openai.OpenAI()
            response = await client.realtime.sessions.create(
                {
                    "model": model,
                    "modalities": ["text", "audio"],
                    "instructions": "You are a helpful assistant.",
                    "voice": "alloy",
                    "input_audio_format": "pcm16",
                    "output_audio_format": "pcm16",
                    "turn_detection": {"type": "server_vad"},
                    "tools": [],
                }
            )

            session_info = {
                "session_id": session_id,
                "client_secret": response.client_secret,
                "model": model,
                "status": "created",
                "type": "webrtc",
                "modalities": ["text", "audio"],
            }

            self._sessions[session_id] = session_info
            return session_info

        except ImportError:
            return {"type": "error", "error": "openai package not installed"}
        except Exception as e:
            return {"type": "error", "error": str(e)}

    async def send_audio(self, session_id: str, audio_data: bytes) -> None:
        """Send audio chunk to OpenAI session."""
        # In WebRTC mode, audio is sent directly to OpenAI
        # This would be handled by the frontend WebRTC connection
        logger.debug(f"Audio chunk for session {session_id}: {len(audio_data)} bytes")

    async def receive_audio(self, session_id: str) -> AsyncIterator[Dict[str, Any]]:
        """Receive events from OpenAI realtime session.

        First-event contract:
            - Unknown session         -> ``error`` (Session not found)
            - ``OPENAI_API_KEY`` set  -> ``session.ready`` (WebRTC handshake)
            - Integrated mode, no key -> ``error`` (status=degraded)
            - Standalone, no key      -> ``conversation.item.created`` (mock)
        """
        # In WebRTC mode, events come via WebRTC connection
        # This method would handle transcript/tool call events
        session = self._sessions.get(session_id)
        if not session:
            yield {"type": "error", "error": "Session not found"}
            return

        # Prefer OpenAI-backed event when API key is present.
        if os.environ.get("OPENAI_API_KEY"):
            yield {
                "type": "session.ready",
                "session_id": session_id,
                "provider": "openai",
                "transport": "webrtc",
                "status": session.get("status", "created"),
                "client_secret": session.get("client_secret"),
            }
            return

        from praisonaiui.backends import is_integrated_mode

        if is_integrated_mode():
            yield {
                "type": "error",
                "status": "degraded",
                "error": "OPENAI_API_KEY required for realtime WebRTC in integrated mode",
                "session_id": session_id,
            }
            return

        # Standalone mock event stream fallback
        yield {
            "type": "conversation.item.created",
            "item": {
                "id": "msg_001",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": "Hello! I can hear you clearly."}],
            },
        }

    async def call_tool(
        self, session_id: str, tool_name: str, args: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle tool calls from realtime API."""
        from praisonaiui.backends import get_tool_resolver

        resolver = get_tool_resolver()
        if resolver is not None and hasattr(resolver, "resolve"):
            tool = resolver.resolve(tool_name)
            if tool is not None:
                try:
                    result = tool(**args) if callable(tool) else str(tool)
                    return {
                        "type": "function_call_output",
                        "call_id": args.get("call_id", "unknown"),
                        "output": str(result),
                    }
                except Exception as exc:
                    return {
                        "type": "error",
                        "error": str(exc),
                        "call_id": args.get("call_id", "unknown"),
                    }

        return {
            "type": "function_call_output",
            "call_id": args.get("call_id", "unknown"),
            "output": f"Tool {tool_name} not available",
            "status": "degraded",
        }

    async def close_session(self, session_id: str) -> None:
        """Close realtime session."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            logger.info(f"Closed realtime session: {session_id}")

    def health(self) -> Dict[str, Any]:
        # find_spec, not import: importing openai costs ~1 s on the event loop.
        if sdk_installed("openai"):
            return {
                "status": "ok",
                "provider": "OpenAIRealtimeManager",
                "active_sessions": len(self._sessions),
            }
        else:
            return {
                "status": "degraded",
                "provider": "OpenAIRealtimeManager",
                "reason": "openai not installed",
            }


# ── Manager singleton ────────────────────────────────────────────────

_realtime_manager: Optional[RealtimeProtocol] = None
# True once the app picked a manager: voice input is opt-in, so the default
# manager (created on first use) never turns it on for every app.
_app_manager = False


def get_realtime_manager() -> RealtimeProtocol:
    global _realtime_manager
    if _realtime_manager is None:
        _realtime_manager = OpenAIRealtimeManager()
    return _realtime_manager


def set_realtime_manager(manager: Optional[RealtimeProtocol]) -> None:
    """Use ``manager`` for realtime voice; ``None`` goes back to the default.

    A manager that implements :meth:`RealtimeProtocol.transcribe` also turns
    on voice input (``GET /api/realtime/voice`` answers ``enabled: true``).
    """
    global _realtime_manager, _app_manager
    _realtime_manager = manager
    _app_manager = manager is not None


def voice_input_enabled() -> bool:
    """Voice input is on: the app set a manager that transcribes."""
    return _app_manager and _realtime_manager is not None and _realtime_manager.supports_transcription()


#: Longest clip the browser records before it stops by itself, in seconds.
VOICE_MAX_SECONDS = 120
#: Largest clip ``POST /api/realtime/transcribe`` accepts (about 4 minutes of Opus).
VOICE_MAX_BYTES = 8 * 1024 * 1024

_AUDIO_EXTENSIONS = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}


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
            Route("/api/realtime/voice", self._voice, methods=["GET"]),
            Route("/api/realtime/transcribe", self._transcribe, methods=["POST"]),
            Route("/ws/realtime/{session_id}", self._websocket_handler),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "realtime",
                "help": "Realtime voice operations",
                "commands": {
                    "sessions": {"help": "List active sessions", "handler": self._cli_sessions},
                },
            }
        ]

    async def health(self) -> Dict[str, Any]:
        mgr = get_realtime_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    async def _create_session(self, request: Request) -> JSONResponse:
        """Create new realtime session."""
        mgr = get_realtime_manager()
        body = (
            await request.json()
            if request.headers.get("content-type") == "application/json"
            else {}
        )

        result = await mgr.create_session(model=body.get("model", "gpt-4o-realtime-preview"))
        return JSONResponse(result)

    async def _voice(self, request: Request) -> JSONResponse:
        """Whether voice input is on, and the limits of one recording."""
        return JSONResponse(
            {
                "enabled": voice_input_enabled(),
                "max_seconds": VOICE_MAX_SECONDS,
                "max_bytes": VOICE_MAX_BYTES,
            }
        )

    async def _transcribe(self, request: Request) -> JSONResponse:
        """One recorded clip (the raw body, ``Content-Type: audio/*``) to text."""
        if not voice_input_enabled():
            return JSONResponse({"error": "Voice input is off for this app."}, status_code=404)
        mime_type = request.headers.get("content-type", "")
        if not mime_type.lower().startswith("audio/"):
            return JSONResponse({"error": "Send the recording as audio/*."}, status_code=415)
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > VOICE_MAX_BYTES:
            return JSONResponse({"error": "The recording is too long."}, status_code=413)
        audio = await request.body()
        if len(audio) > VOICE_MAX_BYTES:
            return JSONResponse({"error": "The recording is too long."}, status_code=413)
        if not audio:
            return JSONResponse({"error": "The recording is empty."}, status_code=400)
        try:
            text = await get_realtime_manager().transcribe(audio, mime_type=mime_type)
        except NotImplementedError:
            return JSONResponse({"error": "This app cannot transcribe speech."}, status_code=501)
        except Exception as exc:  # noqa: BLE001 - the provider's failure is the client's answer
            logger.warning("realtime transcribe failed: %s", type(exc).__name__)
            return JSONResponse({"error": "Could not transcribe the recording."}, status_code=502)
        return JSONResponse({"text": (text or "").strip()})

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
            await websocket.send_json({"type": "error", "error": str(e)})
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
