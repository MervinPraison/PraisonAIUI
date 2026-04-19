"""Window message feature — iframe/embed messaging hooks.

Provides @aiui.on_window_message and aiui.send_window_message for
browser window.postMessage communication in iframe/embed contexts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Callable, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

_log = logging.getLogger(__name__)

# Registry for window message hooks
_window_message_hooks: Dict[str, List[Callable]] = {}
_message_log: List[Dict[str, Any]] = []

# Session contexts registry for sending messages
_session_contexts: Dict[str, Dict[str, Any]] = {}


class WindowMessageFeature(BaseFeatureProtocol):
    """Window message feature for iframe/embed communication."""

    feature_name = "window_message"
    feature_description = "Browser window.postMessage communication"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/window-message", self._send_message, methods=["POST"]),
            Route("/api/window-message/receive", self._receive_message, methods=["POST"]),
            Route("/api/window-message/hooks", self._list_hooks, methods=["GET"]),
            Route("/api/window-message/log", self._message_log, methods=["GET"]),
            Route("/sse/window-message", self._sse_stream, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "window-message",
                "help": "Manage window message hooks",
                "commands": {
                    "hooks": {"help": "List registered hooks", "handler": self._cli_hooks},
                    "log": {"help": "Show message log", "handler": self._cli_log},
                },
            }
        ]

    async def health(self) -> Dict[str, Any]:
        total_hooks = sum(len(hooks) for hooks in _window_message_hooks.values())
        return {
            "status": "ok",
            "feature": self.name,
            "total_hooks": total_hooks,
            "hook_sources": list(_window_message_hooks.keys()),
            "message_log_entries": len(_message_log),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _send_message(self, request: Request) -> JSONResponse:
        """API endpoint to send a window message."""
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)

        data = body.get("data", {})
        target = body.get("target", "parent")

        # Validate target for security
        if target not in ["parent", "*"]:
            return JSONResponse({"error": "Invalid target"}, status_code=400)

        # Store message for SSE delivery
        message = {
            "type": "window_message_outbound",
            "data": data,
            "target": target,
            "timestamp": time.time(),
        }

        _message_log.append(message)

        # Send to all active session contexts
        for session_id, context in _session_contexts.items():
            if "sse_queue" in context:
                try:
                    await context["sse_queue"].put(
                        {
                            "type": "window.message",
                            "data": data,
                            "target": target,
                        }
                    )
                except Exception as e:
                    _log.warning(f"Failed to send message via SSE to session {session_id}: {e}")

        return JSONResponse({"status": "sent", "target": target})

    async def _receive_message(self, request: Request) -> JSONResponse:
        """API endpoint to receive window messages from frontend."""
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)

        data = body.get("data", {})
        source = body.get("source")

        # Handle the incoming message
        await handle_window_message(data, source)

        return JSONResponse({"status": "received"})

    async def _list_hooks(self, request: Request) -> JSONResponse:
        """List all registered window message hooks."""
        hooks_info = {}
        for source, hooks in _window_message_hooks.items():
            hooks_info[source] = [
                {
                    "name": getattr(hook, "__name__", str(hook)),
                    "module": getattr(hook, "__module__", "unknown"),
                }
                for hook in hooks
            ]

        return JSONResponse(
            {
                "hooks": hooks_info,
                "total": sum(len(hooks) for hooks in _window_message_hooks.values()),
            }
        )

    async def _message_log(self, request: Request) -> JSONResponse:
        """Get recent window message log."""
        limit = int(request.query_params.get("limit", "50"))
        return JSONResponse(
            {
                "messages": _message_log[-limit:],
                "total": len(_message_log),
            }
        )

    async def _sse_stream(self, request: Request) -> StreamingResponse:
        """SSE stream for window message events."""

        async def event_stream():
            # Create a queue for this connection
            message_queue = asyncio.Queue()

            # Generate a unique session ID for this connection
            import uuid

            session_id = str(uuid.uuid4())

            # Store session context for message sending
            _session_contexts[session_id] = {"sse_queue": message_queue}

            try:
                while True:
                    try:
                        # Wait for messages with timeout
                        message = await asyncio.wait_for(message_queue.get(), timeout=30.0)
                        yield f"data: {json.dumps(message)}\n\n"
                    except asyncio.TimeoutError:
                        # Send keepalive
                        yield f"data: {json.dumps({'type': 'keepalive'})}\n\n"
            except asyncio.CancelledError:
                pass
            finally:
                # Clean up session context
                if session_id in _session_contexts:
                    del _session_contexts[session_id]

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_hooks(self) -> str:
        if not _window_message_hooks:
            return "No window message hooks registered"

        lines = []
        for source, hooks in _window_message_hooks.items():
            lines.append(f"Source: {source}")
            for hook in hooks:
                name = getattr(hook, "__name__", str(hook))
                lines.append(f"  - {name}")
        return "\n".join(lines)

    def _cli_log(self) -> str:
        if not _message_log:
            return "No window messages logged"

        lines = []
        for msg in _message_log[-10:]:
            msg_type = msg.get("type", "unknown")
            target = msg.get("target", "unknown")
            timestamp = msg.get("timestamp", 0)
            lines.append(f"  {timestamp:.0f} - {msg_type} -> {target}")
        return "\n".join(lines)


def register_window_message_hook(source: Optional[str], func: Callable) -> Callable:
    """Register a window message hook for a specific source.

    Args:
        source: Source origin filter (None for all sources)
        func: Function to call when message received

    Returns:
        The original function (for use as decorator)
    """
    key = source or "*"
    if key not in _window_message_hooks:
        _window_message_hooks[key] = []

    if func not in _window_message_hooks[key]:
        _window_message_hooks[key].append(func)
        _log.debug(
            f"Registered window message hook for source '{key}': {getattr(func, '__name__', str(func))}"
        )

    return func


async def handle_window_message(data: Dict[str, Any], source: Optional[str] = None) -> None:
    """Handle incoming window message and dispatch to registered hooks.

    Args:
        data: Message data from window.postMessage
        source: Source origin of the message
    """
    # Log the message
    log_entry = {
        "type": "window_message_inbound",
        "data": data,
        "source": source,
        "timestamp": time.time(),
    }
    _message_log.append(log_entry)

    # Find matching hooks
    matching_hooks = []

    # Check for exact source match
    if source and source in _window_message_hooks:
        matching_hooks.extend(_window_message_hooks[source])

    # Check for wildcard hooks
    if "*" in _window_message_hooks:
        matching_hooks.extend(_window_message_hooks["*"])

    # Execute hooks
    for hook in matching_hooks:
        try:
            _log.debug(f"Executing window message hook: {getattr(hook, '__name__', str(hook))}")
            result = hook(data)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            _log.error(f"Window message hook failed: {getattr(hook, '__name__', str(hook))}: {e}")


async def send_window_message(data: Dict[str, Any], target: str = "parent") -> None:
    """Send a message to the parent window via postMessage.

    Args:
        data: Data to send to the parent window
        target: Target window ("parent" or specific origin)
    """
    # Validate target for security
    if target not in ["parent", "*"] and not target.startswith("http"):
        _log.warning(f"Invalid target for window message: {target}")
        return

    message = {
        "type": "window_message_outbound",
        "data": data,
        "target": target,
        "timestamp": time.time(),
    }

    _message_log.append(message)

    # Send to all active SSE connections
    for session_id, context in _session_contexts.items():
        if "sse_queue" in context:
            try:
                await context["sse_queue"].put(
                    {
                        "type": "window.message",
                        "data": data,
                        "target": target,
                    }
                )
            except Exception as e:
                _log.warning(f"Failed to send window message via SSE to session {session_id}: {e}")


def reset_window_message_state() -> None:
    """Reset window message state for testing."""
    global _window_message_hooks, _message_log, _session_contexts
    _window_message_hooks.clear()
    _message_log.clear()
    _session_contexts.clear()


# Public decorators
def on_window_message(source: Optional[str] = None) -> Callable:
    """Decorator to register a window message hook.

    Args:
        source: Optional source origin filter

    Example::

        @aiui.on_window_message(source="parent")
        async def on_msg(data: dict):
            if data.get("type") == "set_user":
                aiui.current_session().user = aiui.User(identifier=data["email"])
                await aiui.send_window_message({"type": "user_set", "ok": True})
    """

    def decorator(func: Callable) -> Callable:
        return register_window_message_hook(source, func)

    return decorator
