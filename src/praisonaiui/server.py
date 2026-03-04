"""Server module - FastAPI + SSE for real-time AI chat."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Callable, Optional

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from praisonaiui.datastore import BaseDataStore, MemoryDataStore

# Registry for callbacks
_callbacks: dict[str, Callable] = {}
_agents: dict[str, dict[str, Any]] = {}
# Pluggable datastore (default: in-memory)
_datastore: BaseDataStore = MemoryDataStore()
# Track active tasks per session for server-side abort
_active_tasks: dict[str, asyncio.Task] = {}


def set_datastore(store: BaseDataStore) -> None:
    """Set the datastore implementation (call before server starts)."""
    global _datastore
    _datastore = store


def get_datastore() -> BaseDataStore:
    """Get the current datastore instance."""
    return _datastore


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
    sessions = await _datastore.list_sessions()
    return JSONResponse({"sessions": sessions})


async def get_session(request: Request) -> JSONResponse:
    """Get a specific session."""
    session_id = request.path_params["session_id"]
    session = await _datastore.get_session(session_id)
    if session is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse(session)


async def get_session_runs(request: Request) -> JSONResponse:
    """Get runs (message history) for a session."""
    session_id = request.path_params["session_id"]
    session = await _datastore.get_session(session_id)
    if session is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    messages = await _datastore.get_messages(session_id)
    return JSONResponse({"runs": messages})


async def delete_session(request: Request) -> JSONResponse:
    """Delete a session."""
    session_id = request.path_params["session_id"]
    deleted = await _datastore.delete_session(session_id)
    if not deleted:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse({"status": "deleted"})


async def create_session(request: Request) -> JSONResponse:
    """Create a new session."""
    session = await _datastore.create_session()
    return JSONResponse({"session_id": session["id"]})


async def get_starters(request: Request) -> JSONResponse:
    """Return starter messages from registered callback."""
    callback = _callbacks.get("starters")
    if callback:
        try:
            result = callback()
            if asyncio.iscoroutine(result):
                result = await result
            return JSONResponse({"starters": result or []})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    return JSONResponse({"starters": []})


async def get_profiles(request: Request) -> JSONResponse:
    """Return chat profiles from registered callback."""
    callback = _callbacks.get("profiles")
    if callback:
        try:
            result = callback()
            if asyncio.iscoroutine(result):
                result = await result
            return JSONResponse({"profiles": result or []})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    return JSONResponse({"profiles": []})


async def welcome_handler(request: Request) -> StreamingResponse:
    """Run welcome callback via SSE stream."""
    callback = _callbacks.get("welcome")

    async def event_stream() -> AsyncGenerator[str, None]:
        if callback:
            try:
                # Create a temporary context for welcome
                msg = MessageContext(text="", session_id="")
                stream_queue: asyncio.Queue = asyncio.Queue()
                msg._stream_queue = stream_queue

                async def run_welcome():
                    try:
                        # Set context so aiui.say() works
                        from praisonaiui.callbacks import _set_context
                        _set_context(msg)
                        result = callback()
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        await stream_queue.put({"type": "error", "error": str(e)})
                    finally:
                        from praisonaiui.callbacks import _set_context
                        _set_context(None)
                        await stream_queue.put({"type": "done"})

                task = asyncio.create_task(run_welcome())
                while True:
                    try:
                        event = await asyncio.wait_for(stream_queue.get(), timeout=30.0)
                        if event.get("type") == "done":
                            break
                        yield f"data: {json.dumps(event)}\n\n"
                    except asyncio.TimeoutError:
                        break
                await task
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
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


async def run_agent_by_id(request: Request) -> StreamingResponse:
    """Run a specific agent by ID with SSE streaming."""
    agent_id = request.path_params["agent_id"]
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    body["agent"] = agent_id
    # Delegate to run_agent
    request._body = body
    return await run_agent(request, body)


async def run_agent(request: Request, body: dict = None) -> StreamingResponse:
    """Run an agent with SSE streaming."""
    if body is None:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    message = body.get("message", "")
    session_id = body.get("session_id")
    agent_name = body.get("agent")

    # Create session if not exists
    if not session_id:
        session = await _datastore.create_session()
        session_id = session["id"]
    else:
        existing = await _datastore.get_session(session_id)
        if existing is None:
            session = await _datastore.create_session(session_id)
            session_id = session["id"]

    # Add user message to session
    await _datastore.add_message(session_id, {
        "role": "user",
        "content": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

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
                # Track task for server-side abort
                _active_tasks[session_id] = task

                # Stream events from queue
                full_response = ""
                cancelled = False
                try:
                    while True:
                        try:
                            event = await asyncio.wait_for(stream_queue.get(), timeout=60.0)
                            if event.get("type") == "done":
                                break
                            if event.get("type") == "cancelled":
                                cancelled = True
                                yield f"data: {json.dumps({'type': 'run_cancelled'})}\n\n"
                                break
                            if event.get("type") == "token":
                                full_response += event.get("token", "")
                            elif event.get("type") == "message":
                                # say() sends full messages — capture as response
                                content = event.get("content", "")
                                if content:
                                    if full_response:
                                        full_response += "\n"
                                    full_response += content
                            yield f"data: {json.dumps(event)}\n\n"
                        except asyncio.TimeoutError:
                            yield f"data: {json.dumps({'type': 'error', 'error': 'Timeout'})}\n\n"
                            break
                        except asyncio.CancelledError:
                            # Client disconnected — call cancel callback
                            cancel_cb = _callbacks.get("cancel")
                            if cancel_cb:
                                try:
                                    r = cancel_cb()
                                    if asyncio.iscoroutine(r):
                                        await r
                                except Exception:
                                    pass
                            cancelled = True
                            yield f"data: {json.dumps({'type': 'run_cancelled'})}\n\n"
                            break
                finally:
                    # Clean up task tracking
                    _active_tasks.pop(session_id, None)

                if not cancelled:
                    await task

                # Save assistant response to session
                if full_response:
                    await _datastore.add_message(session_id, {
                        "role": "assistant",
                        "content": full_response,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
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


async def cancel_run(request: Request) -> JSONResponse:
    """Cancel an active run for a session (server-side abort).

    This endpoint allows clients to cancel an ongoing LLM call,
    stopping the task and cleaning up resources.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    session_id = body.get("session_id")
    if not session_id:
        return JSONResponse({"error": "session_id required"}, status_code=400)

    task = _active_tasks.get(session_id)
    if task and not task.done():
        task.cancel()
        _active_tasks.pop(session_id, None)
        return JSONResponse({
            "status": "cancelled",
            "session_id": session_id,
        })

    return JSONResponse({
        "status": "no_active_run",
        "session_id": session_id,
    })


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
        self._response_queue: Optional[asyncio.Queue] = None
        self._pending_ask: Optional[asyncio.Future] = None

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

    async def ask(self, question: str, options: list = None, timeout: float = 300.0) -> str:
        """Ask user a question and wait for response.

        Args:
            question: The question to ask
            options: Optional list of choices
            timeout: Timeout in seconds (default 5 minutes)

        Returns:
            The user's response text
        """
        if not self._stream_queue:
            return ""

        # Create a future to wait for the response
        loop = asyncio.get_event_loop()
        self._pending_ask = loop.create_future()

        # Send the ask event to the client
        await self._stream_queue.put({
            "type": "ask",
            "question": question,
            "options": options or [],
        })

        try:
            # Wait for user response with timeout
            response = await asyncio.wait_for(self._pending_ask, timeout=timeout)
            return response
        except asyncio.TimeoutError:
            return ""
        finally:
            self._pending_ask = None

    def resolve_ask(self, response: str) -> None:
        """Resolve a pending ask with the user's response."""
        if self._pending_ask and not self._pending_ask.done():
            self._pending_ask.set_result(response)


def load_config_from_yaml(config_path: Path) -> Optional[dict]:
    """Load configuration from YAML file."""
    if not config_path.exists():
        return None
    try:
        import yaml
        with open(config_path) as f:
            return yaml.safe_load(f)
    except Exception:
        return None


def create_app(
    config: Optional[dict] = None,
    static_dir: Optional[Path] = None,
    require_auth: bool = False,
    config_path: Optional[Path] = None,
) -> Starlette:
    """Create the Starlette application."""
    from praisonaiui.auth import (
        AuthMiddleware,
        login_handler,
        logout_handler,
        me_handler,
        register_handler,
    )

    # Load config from YAML if path provided
    if config_path and config is None:
        config = load_config_from_yaml(config_path)

    # Extract auth settings from config
    if config:
        auth_config = config.get("auth", {})
        if auth_config.get("requireAuth") or auth_config.get("require_auth"):
            require_auth = True

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
        Route("/starters", get_starters, methods=["GET"]),
        Route("/profiles", get_profiles, methods=["GET"]),
        Route("/welcome", welcome_handler, methods=["POST"]),
        Route("/sessions", list_sessions, methods=["GET"]),
        Route("/sessions", create_session, methods=["POST"]),
        Route("/sessions/{session_id}", get_session, methods=["GET"]),
        Route("/sessions/{session_id}", delete_session, methods=["DELETE"]),
        Route("/sessions/{session_id}/runs", get_session_runs, methods=["GET"]),
        Route("/run", run_agent, methods=["POST"]),
        Route("/cancel", cancel_run, methods=["POST"]),
        Route("/agents/{agent_id}/runs", run_agent_by_id, methods=["POST"]),
    ]

    # Add static file serving if static_dir provided
    if static_dir and static_dir.exists():
        routes.append(Mount("/", app=StaticFiles(directory=str(static_dir), html=True)))

    app = Starlette(
        routes=routes,
        middleware=middleware,
    )

    return app
