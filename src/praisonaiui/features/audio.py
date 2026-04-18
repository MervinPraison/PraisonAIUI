"""Audio hooks feature — streaming audio input hooks.

Provides @aiui.on_audio_start, @aiui.on_audio_chunk, @aiui.on_audio_end
for server-side STT pipelines where frontend streams mic audio.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Callable, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from ._base import BaseFeatureProtocol

_log = logging.getLogger(__name__)

# Registry for audio hooks
_audio_start_hooks: List[Callable] = []
_audio_chunk_hooks: List[Callable] = []
_audio_end_hooks: List[Callable] = []

# Audio session state
_audio_sessions: Dict[str, Dict[str, Any]] = {}
_audio_stats: Dict[str, Any] = {
    "total_sessions": 0,
    "active_sessions": 0,
    "total_chunks": 0,
    "total_bytes": 0,
}


class AudioFeature(BaseFeatureProtocol):
    """Audio streaming hooks for server-side STT pipelines."""

    feature_name = "audio"
    feature_description = "Streaming audio input hooks for STT"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/audio/stats", self._stats, methods=["GET"]),
            Route("/api/audio/sessions", self._list_sessions, methods=["GET"]),
            Route("/api/audio/hooks", self._list_hooks, methods=["GET"]),
            WebSocketRoute("/ws/audio", self._websocket_handler),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "audio",
            "help": "Manage audio streaming hooks",
            "commands": {
                "stats": {"help": "Show audio stats", "handler": self._cli_stats},
                "sessions": {"help": "List active sessions", "handler": self._cli_sessions},
                "hooks": {"help": "List registered hooks", "handler": self._cli_hooks},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "start_hooks": len(_audio_start_hooks),
            "chunk_hooks": len(_audio_chunk_hooks),
            "end_hooks": len(_audio_end_hooks),
            "active_sessions": _audio_stats["active_sessions"],
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _stats(self, request: Request) -> JSONResponse:
        """Get audio streaming statistics."""
        return JSONResponse({
            "stats": _audio_stats,
            "hooks": {
                "start": len(_audio_start_hooks),
                "chunk": len(_audio_chunk_hooks),
                "end": len(_audio_end_hooks),
            },
            "sessions": {
                "active": len(_audio_sessions),
                "session_ids": list(_audio_sessions.keys()),
            },
        })

    async def _list_sessions(self, request: Request) -> JSONResponse:
        """List active audio sessions."""
        sessions = []
        for session_id, session_data in _audio_sessions.items():
            sessions.append({
                "session_id": session_id,
                "started_at": session_data.get("started_at"),
                "chunks_received": session_data.get("chunks_received", 0),
                "bytes_received": session_data.get("bytes_received", 0),
                "sample_rate": session_data.get("sample_rate"),
                "last_chunk_at": session_data.get("last_chunk_at"),
            })
        
        return JSONResponse({
            "sessions": sessions,
            "total": len(sessions),
        })

    async def _list_hooks(self, request: Request) -> JSONResponse:
        """List all registered audio hooks."""
        def get_hook_info(hooks):
            return [
                {
                    "name": getattr(hook, "__name__", str(hook)),
                    "module": getattr(hook, "__module__", "unknown"),
                }
                for hook in hooks
            ]
        
        return JSONResponse({
            "start_hooks": get_hook_info(_audio_start_hooks),
            "chunk_hooks": get_hook_info(_audio_chunk_hooks),
            "end_hooks": get_hook_info(_audio_end_hooks),
        })

    async def _websocket_handler(self, websocket: WebSocket) -> None:
        """WebSocket handler for audio chunk streaming."""
        await websocket.accept()
        session_id = None
        
        try:
            # Wait for initial message with session info
            data = await websocket.receive_json()
            session_id = data.get("session_id")
            sample_rate = data.get("sample_rate", 16000)
            
            if not session_id:
                await websocket.send_json({"error": "session_id required"})
                await websocket.close()
                return
            
            # Create session
            _audio_sessions[session_id] = {
                "started_at": time.time(),
                "sample_rate": sample_rate,
                "chunks_received": 0,
                "bytes_received": 0,
                "last_chunk_at": time.time(),
            }
            
            _audio_stats["total_sessions"] += 1
            _audio_stats["active_sessions"] += 1
            
            # Trigger start hooks
            await self._trigger_start_hooks()
            
            await websocket.send_json({"status": "ready"})
            
            # Handle audio chunks
            while True:
                try:
                    message = await websocket.receive()
                    
                    if message["type"] == "websocket.disconnect":
                        break
                    elif message["type"] == "websocket.receive":
                        if "bytes" in message:
                            # Binary audio data
                            audio_data = message["bytes"]
                            await self._handle_audio_chunk(session_id, audio_data, sample_rate)
                            
                        elif "text" in message:
                            # JSON control message
                            try:
                                control_msg = json.loads(message["text"])
                                if control_msg.get("type") == "end":
                                    await self._trigger_end_hooks()
                                    break
                            except json.JSONDecodeError:
                                _log.warning("Invalid JSON in audio control message")
                                
                except WebSocketDisconnect:
                    break
                except Exception as e:
                    _log.error(f"Error in audio websocket: {e}")
                    await websocket.send_json({"error": str(e)})
        
        except Exception as e:
            _log.error(f"Audio websocket error: {e}")
        finally:
            # Cleanup session
            if session_id and session_id in _audio_sessions:
                del _audio_sessions[session_id]
                _audio_stats["active_sessions"] = max(0, _audio_stats["active_sessions"] - 1)
            
            # Trigger end hooks if not already triggered
            await self._trigger_end_hooks()
            
            if not websocket.client_state.disconnected:
                await websocket.close()

    async def _handle_audio_chunk(self, session_id: str, pcm_data: bytes, sample_rate: int) -> None:
        """Handle incoming audio chunk and trigger hooks."""
        if session_id in _audio_sessions:
            session = _audio_sessions[session_id]
            session["chunks_received"] += 1
            session["bytes_received"] += len(pcm_data)
            session["last_chunk_at"] = time.time()
            
            _audio_stats["total_chunks"] += 1
            _audio_stats["total_bytes"] += len(pcm_data)
        
        # Trigger chunk hooks
        await self._trigger_chunk_hooks(pcm_data, sample_rate)

    async def _trigger_start_hooks(self) -> None:
        """Execute all audio start hooks."""
        for hook in _audio_start_hooks:
            try:
                _log.debug(f"Executing audio start hook: {getattr(hook, '__name__', str(hook))}")
                result = hook()
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                _log.error(f"Audio start hook failed: {getattr(hook, '__name__', str(hook))}: {e}")

    async def _trigger_chunk_hooks(self, pcm_data: bytes, sample_rate: int) -> None:
        """Execute all audio chunk hooks."""
        for hook in _audio_chunk_hooks:
            try:
                result = hook(pcm_data, sample_rate)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                _log.error(f"Audio chunk hook failed: {getattr(hook, '__name__', str(hook))}: {e}")

    async def _trigger_end_hooks(self) -> None:
        """Execute all audio end hooks."""
        for hook in _audio_end_hooks:
            try:
                _log.debug(f"Executing audio end hook: {getattr(hook, '__name__', str(hook))}")
                result = hook()
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                _log.error(f"Audio end hook failed: {getattr(hook, '__name__', str(hook))}: {e}")

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_stats(self) -> str:
        stats = _audio_stats
        lines = [
            f"Total sessions: {stats['total_sessions']}",
            f"Active sessions: {stats['active_sessions']}",
            f"Total chunks: {stats['total_chunks']}",
            f"Total bytes: {stats['total_bytes']}",
        ]
        return "\n".join(lines)

    def _cli_sessions(self) -> str:
        if not _audio_sessions:
            return "No active audio sessions"
        
        lines = []
        for session_id, session in _audio_sessions.items():
            chunks = session.get("chunks_received", 0)
            bytes_received = session.get("bytes_received", 0)
            lines.append(f"  {session_id} - {chunks} chunks, {bytes_received} bytes")
        return "\n".join(lines)

    def _cli_hooks(self) -> str:
        lines = []
        if _audio_start_hooks:
            lines.append("Start hooks:")
            for hook in _audio_start_hooks:
                name = getattr(hook, "__name__", str(hook))
                lines.append(f"  - {name}")
        if _audio_chunk_hooks:
            lines.append("Chunk hooks:")
            for hook in _audio_chunk_hooks:
                name = getattr(hook, "__name__", str(hook))
                lines.append(f"  - {name}")
        if _audio_end_hooks:
            lines.append("End hooks:")
            for hook in _audio_end_hooks:
                name = getattr(hook, "__name__", str(hook))
                lines.append(f"  - {name}")
        return "\n".join(lines) if lines else "No audio hooks registered"


def register_audio_start_hook(func: Callable) -> Callable:
    """Register an audio start hook.
    
    Args:
        func: Function to call when audio recording starts
        
    Returns:
        The original function (for use as decorator)
    """
    if func not in _audio_start_hooks:
        _audio_start_hooks.append(func)
        _log.debug(f"Registered audio start hook: {getattr(func, '__name__', str(func))}")
    return func


def register_audio_chunk_hook(func: Callable) -> Callable:
    """Register an audio chunk hook.
    
    Args:
        func: Function to call for each audio chunk (pcm_data, sample_rate)
        
    Returns:
        The original function (for use as decorator)
    """
    if func not in _audio_chunk_hooks:
        _audio_chunk_hooks.append(func)
        _log.debug(f"Registered audio chunk hook: {getattr(func, '__name__', str(func))}")
    return func


def register_audio_end_hook(func: Callable) -> Callable:
    """Register an audio end hook.
    
    Args:
        func: Function to call when audio recording ends
        
    Returns:
        The original function (for use as decorator)
    """
    if func not in _audio_end_hooks:
        _audio_end_hooks.append(func)
        _log.debug(f"Registered audio end hook: {getattr(func, '__name__', str(func))}")
    return func


def reset_audio_state() -> None:
    """Reset audio state for testing."""
    global _audio_start_hooks, _audio_chunk_hooks, _audio_end_hooks
    global _audio_sessions, _audio_stats
    
    _audio_start_hooks.clear()
    _audio_chunk_hooks.clear()
    _audio_end_hooks.clear()
    _audio_sessions.clear()
    _audio_stats.update({
        "total_sessions": 0,
        "active_sessions": 0,
        "total_chunks": 0,
        "total_bytes": 0,
    })


# Public decorators
def on_audio_start(func: Callable) -> Callable:
    """Decorator to register an audio start hook.
    
    Called when user clicks mic button and session is ready.
    
    Example::
    
        @aiui.on_audio_start
        async def start():
            await aiui.Message(content="🎙 Listening...").send()
    """
    return register_audio_start_hook(func)


def on_audio_chunk(func: Callable) -> Callable:
    """Decorator to register an audio chunk hook.
    
    Called for each streaming audio chunk (PCM/opus).
    
    Example::
    
        @aiui.on_audio_chunk
        async def chunk(pcm: bytes, sample_rate: int):
            # Forward to Whisper server / Deepgram / local vosk
            await stt_buffer.append(pcm)
    """
    return register_audio_chunk_hook(func)


def on_audio_end(func: Callable) -> Callable:
    """Decorator to register an audio end hook.
    
    Called when recording stops (by user or VAD silence timeout).
    
    Example::
    
        @aiui.on_audio_end
        async def end():
            transcript = await stt_buffer.finalise()
            await handler(aiui.InboundMessage(content=transcript, source="voice"))
    """
    return register_audio_end_hook(func)