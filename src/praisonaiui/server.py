"""Server module - FastAPI + SSE for real-time AI chat."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Callable, Optional

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

# Registry for callbacks
_callbacks: dict[str, Callable] = {}
_agents: dict[str, dict[str, Any]] = {}
_sessions: dict[str, dict[str, Any]] = {}


def register_callback(event: str, func: Callable) -> None:
    """Register a callback for an event."""
    _callbacks[event] = func


def register_agent(name: str, agent: Any) -> None:
    """Register an agent."""
    _agents[name] = {
        "name": name,
        "agent": agent,
        "created_at": datetime.utcnow().isoformat(),
    }


async def health(request: Request) -> JSONResponse:
    """Health check endpoint."""
    return JSONResponse({"status": "ok", "timestamp": datetime.utcnow().isoformat()})


async def list_agents(request: Request) -> JSONResponse:
    """List all registered agents."""
    agents = [
        {
            "name": info["name"],
            "created_at": info["created_at"],
        }
        for info in _agents.values()
    ]
    return JSONResponse({"agents": agents})


async def list_sessions(request: Request) -> JSONResponse:
    """List all sessions."""
    sessions = [
        {
            "id": sid,
            "created_at": info.get("created_at"),
            "updated_at": info.get("updated_at"),
            "message_count": len(info.get("messages", [])),
        }
        for sid, info in _sessions.items()
    ]
    return JSONResponse({"sessions": sessions})


async def get_session(request: Request) -> JSONResponse:
    """Get a specific session."""
    session_id = request.path_params["session_id"]
    if session_id not in _sessions:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse(_sessions[session_id])


async def get_session_runs(request: Request) -> JSONResponse:
    """Get runs (message history) for a session."""
    session_id = request.path_params["session_id"]
    if session_id not in _sessions:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse({"runs": _sessions[session_id].get("messages", [])})


async def delete_session(request: Request) -> JSONResponse:
    """Delete a session."""
    session_id = request.path_params["session_id"]
    if session_id not in _sessions:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    del _sessions[session_id]
    return JSONResponse({"status": "deleted"})


async def create_session(request: Request) -> JSONResponse:
    """Create a new session."""
    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    _sessions[session_id] = {
        "id": session_id,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }
    return JSONResponse({"session_id": session_id})


async def run_agent(request: Request) -> StreamingResponse:
    """Run an agent with SSE streaming."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    message = body.get("message", "")
    session_id = body.get("session_id")
    agent_name = body.get("agent")

    # Create session if not exists
    if not session_id:
        session_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        _sessions[session_id] = {
            "id": session_id,
            "created_at": now,
            "updated_at": now,
            "messages": [],
        }

    # Add user message to session
    if session_id in _sessions:
        _sessions[session_id]["messages"].append({
            "role": "user",
            "content": message,
            "timestamp": datetime.utcnow().isoformat(),
        })
        _sessions[session_id]["updated_at"] = datetime.utcnow().isoformat()

    async def event_stream() -> AsyncGenerator[str, None]:
        """Generate SSE events."""
        # Send session info
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"

        # Call the reply callback if registered
        reply_callback = _callbacks.get("reply")
        if reply_callback:
            try:
                # Create a message object
                msg = MessageContext(
                    text=message,
                    session_id=session_id,
                    agent_name=agent_name,
                )

                # Set up streaming context
                stream_queue: asyncio.Queue = asyncio.Queue()
                msg._stream_queue = stream_queue

                # Run callback in background
                async def run_callback():
                    try:
                        result = reply_callback(msg)
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        await stream_queue.put({"type": "error", "error": str(e)})
                    finally:
                        await stream_queue.put({"type": "done"})

                task = asyncio.create_task(run_callback())

                # Stream events from queue
                full_response = ""
                while True:
                    try:
                        event = await asyncio.wait_for(stream_queue.get(), timeout=60.0)
                        if event.get("type") == "done":
                            break
                        if event.get("type") == "token":
                            full_response += event.get("token", "")
                        yield f"data: {json.dumps(event)}\n\n"
                    except asyncio.TimeoutError:
                        yield f"data: {json.dumps({'type': 'error', 'error': 'Timeout'})}\n\n"
                        break

                await task

                # Save assistant response to session
                if session_id in _sessions and full_response:
                    _sessions[session_id]["messages"].append({
                        "role": "assistant",
                        "content": full_response,
                        "timestamp": datetime.utcnow().isoformat(),
                    })

            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        else:
            # No callback registered, return echo
            yield f"data: {json.dumps({'type': 'message', 'content': f'Echo: {message}'})}\n\n"

        yield f"data: {json.dumps({'type': 'end'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class MessageContext:
    """Context object passed to reply callbacks."""

    def __init__(
        self,
        text: str,
        session_id: Optional[str] = None,
        agent_name: Optional[str] = None,
    ):
        self.text = text
        self.content = text  # Alias for compatibility
        self.session_id = session_id
        self.agent_name = agent_name
        self._stream_queue: Optional[asyncio.Queue] = None

    async def stream(self, token: str) -> None:
        """Stream a token to the client."""
        if self._stream_queue:
            await self._stream_queue.put({"type": "token", "token": token})

    async def think(self, step: str) -> None:
        """Send a thinking/reasoning step."""
        if self._stream_queue:
            await self._stream_queue.put({"type": "thinking", "step": step})

    async def tool(self, name: str, args: dict = None, result: Any = None) -> None:
        """Send a tool call event."""
        if self._stream_queue:
            await self._stream_queue.put({
                "type": "tool_call",
                "name": name,
                "args": args or {},
                "result": result,
            })


def create_app(
    config: Optional[dict] = None,
    static_dir: Optional[Path] = None,
    require_auth: bool = False,
) -> Starlette:
    """Create the Starlette application."""
    from praisonaiui.auth import (
        AuthMiddleware,
        login_handler,
        logout_handler,
        me_handler,
        register_handler,
    )

    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        ),
    ]

    if require_auth:
        middleware.append(
            Middleware(
                AuthMiddleware,
                require_auth=True,
                exclude_paths=["/health", "/login", "/register", "/"],
            )
        )

    routes = [
        Route("/health", health, methods=["GET"]),
        Route("/login", login_handler, methods=["POST"]),
        Route("/register", register_handler, methods=["POST"]),
        Route("/logout", logout_handler, methods=["POST"]),
        Route("/me", me_handler, methods=["GET"]),
        Route("/agents", list_agents, methods=["GET"]),
        Route("/sessions", list_sessions, methods=["GET"]),
        Route("/sessions", create_session, methods=["POST"]),
        Route("/sessions/{session_id}", get_session, methods=["GET"]),
        Route("/sessions/{session_id}", delete_session, methods=["DELETE"]),
        Route("/sessions/{session_id}/runs", get_session_runs, methods=["GET"]),
        Route("/run", run_agent, methods=["POST"]),
    ]

    # Add static file serving if static_dir provided
    if static_dir and static_dir.exists():
        routes.append(Mount("/", app=StaticFiles(directory=str(static_dir), html=True)))

    app = Starlette(
        routes=routes,
        middleware=middleware,
    )

    return app
