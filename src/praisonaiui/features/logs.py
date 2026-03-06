"""Logs feature — real-time log streaming via WebSocket for PraisonAIUI.

Provides WebSocket endpoint for real-time log tailing with level filtering
and search capabilities.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Set

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.websockets import WebSocket, WebSocketDisconnect

from ._base import BaseFeatureProtocol

# Log levels with colors
LOG_LEVELS = {
    "DEBUG": {"color": "#6b7280", "priority": 10},
    "INFO": {"color": "#3b82f6", "priority": 20},
    "WARNING": {"color": "#f59e0b", "priority": 30},
    "ERROR": {"color": "#ef4444", "priority": 40},
    "CRITICAL": {"color": "#dc2626", "priority": 50},
}

# In-memory log buffer (shared with server.py's _log_buffer)
_log_buffer: deque = deque(maxlen=500)
_ws_clients: Set[WebSocket] = set()
_broadcast_lock = asyncio.Lock()


class WebSocketLogHandler(logging.Handler):
    """Logging handler that broadcasts to WebSocket clients."""
    
    def emit(self, record: logging.LogRecord) -> None:
        entry = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": self.format(record),
        }
        _log_buffer.append(entry)
        
        # Schedule broadcast to WebSocket clients
        if _ws_clients:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(_broadcast_log(entry))
            except RuntimeError:
                pass


async def _broadcast_log(entry: Dict[str, Any]) -> None:
    """Broadcast a log entry to all connected WebSocket clients."""
    if not _ws_clients:
        return
    
    message = json.dumps({"type": "log", "data": entry})
    
    async with _broadcast_lock:
        disconnected = set()
        for ws in _ws_clients:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.add(ws)
        
        _ws_clients.difference_update(disconnected)


def install_log_handler() -> None:
    """Install the WebSocket log handler on the root logger."""
    handler = WebSocketLogHandler()
    handler.setFormatter(logging.Formatter("%(name)s - %(message)s"))
    handler.setLevel(logging.DEBUG)
    
    root = logging.getLogger()
    # Check if already installed
    for h in root.handlers:
        if isinstance(h, WebSocketLogHandler):
            return
    root.addHandler(handler)


def get_log_buffer() -> deque:
    """Get the shared log buffer."""
    return _log_buffer


class PraisonAILogs(BaseFeatureProtocol):
    """Real-time log streaming feature."""

    feature_name = "logs"
    feature_description = "Real-time log streaming with WebSocket"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/logs/stream", self._websocket_stream),
            Route("/api/logs/levels", self._levels, methods=["GET"]),
            Route("/api/logs/clear", self._clear, methods=["POST"]),
            Route("/api/logs/stats", self._stats, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "logs",
            "help": "Log management",
            "commands": {
                "tail": {"help": "Tail logs", "handler": self._cli_tail},
                "clear": {"help": "Clear log buffer", "handler": self._cli_clear},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "buffer_size": len(_log_buffer),
            "connected_clients": len(_ws_clients),
        }

    # ── WebSocket endpoint ───────────────────────────────────────────

    async def _websocket_stream(self, websocket: WebSocket) -> None:
        """WebSocket endpoint for real-time log streaming."""
        await websocket.accept()
        _ws_clients.add(websocket)
        
        # Get filter parameters from query string
        level_filter = websocket.query_params.get("level", "DEBUG").upper()
        search_filter = websocket.query_params.get("search", "").lower()
        
        level_priority = LOG_LEVELS.get(level_filter, {}).get("priority", 10)
        
        try:
            # Send initial buffer (filtered)
            initial_logs = []
            for entry in list(_log_buffer):
                entry_priority = LOG_LEVELS.get(entry.get("level", "INFO"), {}).get("priority", 20)
                if entry_priority >= level_priority:
                    if not search_filter or search_filter in entry.get("message", "").lower():
                        initial_logs.append(entry)
            
            await websocket.send_text(json.dumps({
                "type": "initial",
                "data": initial_logs[-100:],  # Last 100 matching logs
                "total": len(_log_buffer),
            }))
            
            # Keep connection alive and handle filter updates
            while True:
                try:
                    message = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                    data = json.loads(message)
                    
                    if data.get("type") == "filter":
                        level_filter = data.get("level", "DEBUG").upper()
                        search_filter = data.get("search", "").lower()
                        level_priority = LOG_LEVELS.get(level_filter, {}).get("priority", 10)
                        
                        # Send filtered buffer
                        filtered_logs = []
                        for entry in list(_log_buffer):
                            entry_priority = LOG_LEVELS.get(entry.get("level", "INFO"), {}).get("priority", 20)
                            if entry_priority >= level_priority:
                                if not search_filter or search_filter in entry.get("message", "").lower():
                                    filtered_logs.append(entry)
                        
                        await websocket.send_text(json.dumps({
                            "type": "filtered",
                            "data": filtered_logs[-100:],
                        }))
                    
                    elif data.get("type") == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))
                        
                except asyncio.TimeoutError:
                    # Send keepalive
                    await websocket.send_text(json.dumps({"type": "ping"}))
                    
        except WebSocketDisconnect:
            pass
        finally:
            _ws_clients.discard(websocket)

    # ── API endpoints ────────────────────────────────────────────────

    async def _levels(self, request: Request) -> JSONResponse:
        """GET /api/logs/levels — Get available log levels."""
        return JSONResponse({
            "levels": [
                {"name": name, "color": info["color"], "priority": info["priority"]}
                for name, info in LOG_LEVELS.items()
            ],
        })

    async def _clear(self, request: Request) -> JSONResponse:
        """POST /api/logs/clear — Clear the log buffer."""
        _log_buffer.clear()
        
        # Notify connected clients
        message = json.dumps({"type": "cleared"})
        for ws in list(_ws_clients):
            try:
                await ws.send_text(message)
            except Exception:
                pass
        
        return JSONResponse({"cleared": True, "buffer_size": 0})

    async def _stats(self, request: Request) -> JSONResponse:
        """GET /api/logs/stats — Get log statistics."""
        level_counts = {"DEBUG": 0, "INFO": 0, "WARNING": 0, "ERROR": 0, "CRITICAL": 0}
        
        for entry in list(_log_buffer):
            level = entry.get("level", "INFO")
            if level in level_counts:
                level_counts[level] += 1
        
        return JSONResponse({
            "total": len(_log_buffer),
            "by_level": level_counts,
            "connected_clients": len(_ws_clients),
            "buffer_max": _log_buffer.maxlen,
        })

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_tail(self, n: int = 20) -> str:
        logs = list(_log_buffer)[-n:]
        if not logs:
            return "No logs"
        lines = []
        for entry in logs:
            level = entry.get("level", "INFO")
            msg = entry.get("message", "")
            lines.append(f"[{level}] {msg}")
        return "\n".join(lines)

    def _cli_clear(self) -> str:
        _log_buffer.clear()
        return "Log buffer cleared"
