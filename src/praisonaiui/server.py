"""Server module - FastAPI + SSE for real-time AI chat."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Callable, Optional

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from praisonaiui.datastore import BaseDataStore, JSONFileDataStore, MemoryDataStore
from praisonaiui.features import auto_register_defaults, get_features
from praisonaiui.provider import BaseProvider, RunEventType

# Registry for callbacks
_callbacks: dict[str, Callable] = {}
_agents: dict[str, dict[str, Any]] = {}
# Registry for dashboard pages (protocol-driven)
_pages: dict[str, dict[str, Any]] = {}
# Pluggable datastore (default: persistent JSON file store)
_datastore: BaseDataStore = JSONFileDataStore()
# Pluggable AI provider (default: PraisonAI)
_provider: Optional[BaseProvider] = None  # lazy-init to avoid circular import
# Track active tasks per session for server-side abort
_active_tasks: dict[str, asyncio.Task] = {}
# Server start time for uptime calculation
_server_start_time: float = time.time()
# In-memory log buffer for /api/logs
_log_buffer: deque = deque(maxlen=500)
# Usage tracking (token counts per session/model)
_usage_stats: dict[str, Any] = {
    "total_requests": 0,
    "total_tokens": 0,
    "by_model": {},
    "by_session": {},
}
# Server config path (set during create_app)
_config_path: Optional[Path] = None
_config_cache: Optional[dict] = None
# Explicit style set via aiui.set_style() — None means "not set"
_style: Optional[str] = None


def set_style(style: str) -> None:
    """Set the UI style from Python code (call before server starts).

    Valid values: 'chat', 'agents', 'playground', 'dashboard', 'docs', 'custom'.
    This takes priority over auto-detection but is overridden by CLI --style.
    """
    global _style
    _style = style


def get_style() -> Optional[str]:
    """Get the explicitly set style, or None if not set."""
    return _style


def detect_style() -> str:
    """Auto-detect the best UI style from registered callbacks and agents.

    Detection heuristics (in priority order):
      1. profiles callback + registered agents → 'agents'
      2. page:* callbacks registered → 'dashboard'
      3. reply callback → 'chat'
      4. fallback → 'chat'
    """
    has_profiles = "profiles" in _callbacks
    has_agents = bool(_agents)
    has_pages = any(k.startswith("page:") for k in _callbacks)

    if has_profiles and has_agents:
        return "agents"
    if has_pages:
        return "dashboard"
    return "chat"


# ── Dynamic HTML & plugin config generation ─────────────────────────

def _build_html(style: str) -> str:
    """Generate the host HTML based on style. No template files needed.

    The SDK owns the HTML — just like Chainlit. Users never write HTML.
    """
    title = "PraisonAIUI Dashboard" if style == "dashboard" else "PraisonAIUI"
    cache_bust = int(_server_start_time)

    # Anti-flicker: hide React's debug/default view until plugins render
    anti_flicker = ""
    if style == "docs":
        anti_flicker = (
            '<style id="aiui-anti-flicker">'
            '#root main.flex-1 > :not([data-aiui-plugin]) { opacity: 0; }'
            'header + nav[data-aiui-plugin="topnav"] ~ * { }'  # no-op, reserves DOM slot
            '</style>'
        )

    return (
        '<!doctype html><html lang="en"><head>'
        '<meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
        f'<link rel="stylesheet" href="/assets/index.css?v={cache_bust}">'
        f'{anti_flicker}'
        f'<title>{title}</title>'
        '</head><body>'
        '<div id="root"></div>'
        f'<script type="module" crossorigin src="/assets/index.js?v={cache_bust}"></script>'
        f'<script src="/plugins/plugin-loader.js?v={cache_bust}"></script>'
        '</body></html>'
    )


async def _plugins_config(request: Request) -> JSONResponse:
    """Dynamic plugins.json — style-aware, protocol-driven.

    Replaces the static plugins.json file. Each style loads only the
    plugins it needs, keeping the frontend lean.
    """
    style = get_style() or detect_style()
    # Base plugins (always loaded)
    plugins: list[str] = ["fetch-retry"]
    if style == "dashboard":
        plugins += [
            "dashboard",
        ]
    elif style == "docs":
        plugins += [
            "topnav", "syntax-highlight", "code-copy",
            "content-loader", "toc", "mermaid",
            "nav-intercept", "mkdocs-compat", "homepage",
        ]
    else:
        # chat / agents / playground — minimal plugins
        plugins += ["syntax-highlight", "code-copy"]
    return JSONResponse({"plugins": plugins})


async def _serve_index(request: Request) -> HTMLResponse:
    """Serve dynamically generated HTML based on active style."""
    style = get_style() or detect_style()
    return HTMLResponse(_build_html(style))



def set_datastore(store: BaseDataStore) -> None:
    """Set the datastore implementation (call before server starts)."""
    global _datastore
    _datastore = store


def get_datastore() -> BaseDataStore:
    """Get the current datastore instance."""
    return _datastore


def set_provider(provider: BaseProvider) -> None:
    """Set the AI provider (call before server starts).

    Any class implementing ``BaseProvider`` can be plugged in.
    Default: ``PraisonAIProvider`` (uses the @aiui.reply callback system).
    """
    global _provider
    _provider = provider


def get_provider() -> BaseProvider:
    """Get the current AI provider, lazy-initialising the default."""
    global _provider
    if _provider is None:
        from praisonaiui.providers import PraisonAIProvider
        _provider = PraisonAIProvider()
    return _provider


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


def register_page(
    id: str,
    *,
    title: str,
    icon: str = "📄",
    group: str = "Custom",
    description: str = "",
    api_endpoint: Optional[str] = None,
    handler: Optional[Callable] = None,
    order: int = 100,
) -> None:
    """Register a dashboard page.

    Built-in pages and user-defined pages use the same protocol.
    Users can override built-in pages by registering with the same id.

    Args:
        id: Unique page identifier (e.g. 'metrics')
        title: Display title in sidebar
        icon: Emoji icon for sidebar
        group: Tab group name (e.g. 'Control', 'Settings', 'Custom')
        description: Brief subtitle shown in header
        api_endpoint: API path for page data (default: /api/pages/{id}/data)
        handler: Optional async function that returns page data as dict
        order: Sort order within group (lower = first, default 100)
    """
    endpoint = api_endpoint or f"/api/pages/{id}/data"
    _pages[id] = {
        "id": id,
        "title": title,
        "icon": icon,
        "group": group,
        "description": description,
        "api_endpoint": endpoint,
        "order": order,
    }
    if handler:
        register_callback(f"page:{id}", handler)


async def health(request: Request) -> JSONResponse:
    """Health check endpoint."""
    provider = get_provider()
    provider_info = {"name": type(provider).__name__}
    try:
        provider_health = await provider.health()
        provider_info.update(provider_health)
    except Exception:
        pass
    return JSONResponse({
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "provider": provider_info,
    })


async def list_agents(request: Request) -> JSONResponse:
    """List all registered agents (merges registry + provider)."""
    agents = [
        {
            "name": info["name"],
            "created_at": info["created_at"],
        }
        for info in _agents.values()
    ]
    # Also ask the provider for agents
    try:
        provider = get_provider()
        provider_agents = await provider.list_agents()
        existing_names = {a["name"] for a in agents}
        for pa in provider_agents:
            if pa.get("name") not in existing_names:
                agents.append(pa)
    except Exception:
        pass
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


async def patch_session(request: Request) -> JSONResponse:
    """Update session metadata (rename, tag)."""
    session_id = request.path_params["session_id"]
    session = await _datastore.get_session(session_id)
    if session is None:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    title = body.get("title")
    if title is not None:
        await _datastore.update_session(session_id, title=title)
    return JSONResponse({"status": "updated", "session_id": session_id})


# ---------------------------------------------------------------------------
# Dashboard API endpoints
# ---------------------------------------------------------------------------

async def api_overview(request: Request) -> JSONResponse:
    """Dashboard overview — health, version, stats."""
    sessions = await _datastore.list_sessions()
    profiles_cb = _callbacks.get("profiles")
    profiles = []
    if profiles_cb:
        result = profiles_cb()
        if asyncio.iscoroutine(result):
            result = await result
        profiles = result if isinstance(result, list) else []
    provider = get_provider()
    provider_name = type(provider).__name__
    # Fetch provider health data for richer dashboard info
    try:
        provider_health = await provider.health()
    except Exception:
        provider_health = {"status": "unknown"}
    return JSONResponse({
        "status": "ok",
        "version": _get_version(),
        "uptime_seconds": round(time.time() - _server_start_time, 1),
        "python_version": sys.version,
        "provider": provider_name,
        "provider_health": provider_health,
        "stats": {
            "total_sessions": len(sessions),
            "active_tasks": len(_active_tasks),
            "registered_agents": len(_agents),
            "registered_profiles": len(profiles),
            "total_requests": _usage_stats["total_requests"],
        },
        "agents": list(_agents.keys()),
    })


async def api_config_handler(request: Request) -> JSONResponse:
    """Read or write server config."""
    global _config_cache
    if request.method == "GET":
        config = _config_cache or {}
        if _config_path and _config_path.exists():
            config = load_config_from_yaml(_config_path) or {}
            _config_cache = config
        return JSONResponse({
            "config": config,
            "config_path": str(_config_path) if _config_path else None,
        })
    elif request.method == "PUT":
        if not _config_path:
            return JSONResponse({"error": "No config file path set"}, status_code=400)
        try:
            body = await request.json()
            config_data = body.get("config", body)
            import yaml
            with open(_config_path, "w") as f:
                yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
            _config_cache = config_data
            return JSONResponse({"status": "saved", "config_path": str(_config_path)})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    return JSONResponse({"error": "Method not allowed"}, status_code=405)


async def api_logs(request: Request) -> JSONResponse:
    """Return recent log entries."""
    level = request.query_params.get("level", "").upper()
    limit = int(request.query_params.get("limit", "100"))
    logs = list(_log_buffer)
    if level:
        logs = [entry for entry in logs if entry.get("level", "") == level]
    logs = logs[-limit:]
    return JSONResponse({"logs": logs, "total": len(_log_buffer)})


async def api_usage(request: Request) -> JSONResponse:
    """Return usage statistics."""
    return JSONResponse({
        "usage": _usage_stats,
        "sessions": {
            "total": len(await _datastore.list_sessions()),
            "active": len(_active_tasks),
        },
    })


async def api_debug(request: Request) -> JSONResponse:
    """Debug info — versions, env, loaded modules."""
    import platform
    pkg_versions = {}
    for pkg in ["praisonaiui", "praisonaiagents", "openai", "starlette", "uvicorn"]:
        try:
            from importlib.metadata import version as pkg_version
            pkg_versions[pkg] = pkg_version(pkg)
        except Exception:
            pkg_versions[pkg] = "not installed"
    return JSONResponse({
        "python": sys.version,
        "platform": platform.platform(),
        "packages": pkg_versions,
        "callbacks_registered": list(_callbacks.keys()),
        "agents_registered": list(_agents.keys()),
        "datastore_type": type(_datastore).__name__,
        "config_path": str(_config_path) if _config_path else None,
        "log_buffer_size": len(_log_buffer),
    })


async def api_provider(request: Request) -> JSONResponse:
    """Return provider info: name, health, supported features."""
    provider = get_provider()
    info = {
        "name": type(provider).__name__,
        "module": type(provider).__module__,
    }
    try:
        health_data = await provider.health()
        info.update(health_data)
    except Exception as exc:
        info["health_error"] = str(exc)
    try:
        agents = await provider.list_agents()
        info["agents"] = agents
    except Exception:
        info["agents"] = []
    return JSONResponse(info)


async def api_pages(request: Request) -> JSONResponse:
    """List registered dashboard pages (protocol-driven)."""
    # Sort by order within each group
    pages = sorted(_pages.values(), key=lambda p: (p.get("order", 100), p["id"]))
    return JSONResponse({"pages": pages})


async def api_features(request: Request) -> JSONResponse:
    """List all registered feature protocols."""
    features = get_features()
    infos = []
    for f in features.values():
        try:
            info = await f.info()
            infos.append(info)
        except Exception:
            infos.append({"name": f.name, "status": "error"})
    return JSONResponse({"features": infos, "count": len(infos)})


async def api_page_data(request: Request) -> JSONResponse:
    """Serve data for a custom user-registered page."""
    page_id = request.path_params["page_id"]
    handler = _callbacks.get(f"page:{page_id}")
    if not handler:
        return JSONResponse({"error": f"No handler for page '{page_id}'"}, status_code=404)
    try:
        import asyncio as _aio
        result = handler()
        if _aio.iscoroutine(result):
            result = await result
        if not isinstance(result, dict):
            result = {"data": result}
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


def _get_version() -> str:
    """Get praisonaiui version."""
    try:
        from importlib.metadata import version
        return version("praisonaiui")
    except Exception:
        return "dev"


def track_usage(session_id: str = "unknown", model: str = "unknown", tokens: int = 0):
    """Track token usage stats. Called from callbacks."""
    _usage_stats["total_requests"] += 1
    _usage_stats["total_tokens"] += tokens
    if model not in _usage_stats["by_model"]:
        _usage_stats["by_model"][model] = {"requests": 0, "tokens": 0}
    _usage_stats["by_model"][model]["requests"] += 1
    _usage_stats["by_model"][model]["tokens"] += tokens
    if session_id not in _usage_stats["by_session"]:
        _usage_stats["by_session"][session_id] = {"requests": 0, "tokens": 0}
    _usage_stats["by_session"][session_id]["requests"] += 1
    _usage_stats["by_session"][session_id]["tokens"] += tokens


class LogBufferHandler(logging.Handler):
    """Logging handler that captures log entries into the in-memory buffer."""
    def emit(self, record: logging.LogRecord) -> None:
        entry = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": self.format(record),
        }
        _log_buffer.append(entry)


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


# Track currently selected profile per session
_selected_profile: dict = {"id": None}


async def select_profile(request: Request) -> JSONResponse:
    """Handle profile selection from UI."""
    try:
        body = await request.json()
        profile_id = body.get("profile_id")
        if not profile_id:
            return JSONResponse({"error": "profile_id required"}, status_code=400)
        _selected_profile["id"] = profile_id
        # Call profile_select callback if registered
        callback = _callbacks.get("profile_select")
        if callback:
            result = callback(profile_id)
            if asyncio.iscoroutine(result):
                await result
        return JSONResponse({"status": "ok", "profile_id": profile_id})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


def get_selected_profile() -> str | None:
    """Get the currently selected profile ID."""
    return _selected_profile.get("id")


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
        """Generate SSE events via the pluggable provider."""
        # Send session info
        yield f"data: {json.dumps({'type': 'session', 'session_id': session_id})}\n\n"

        provider = get_provider()
        full_response = ""

        try:
            async for run_event in provider.run(
                message,
                session_id=session_id,
                agent_name=agent_name,
            ):
                # Accumulate full response from content events
                if run_event.type == RunEventType.RUN_CONTENT:
                    if run_event.token:
                        full_response += run_event.token
                    elif run_event.content:
                        if full_response:
                            full_response += "\n"
                        full_response += run_event.content
                elif run_event.type == RunEventType.RUN_COMPLETED:
                    if run_event.content and not full_response:
                        full_response = run_event.content

                # Emit the event as SSE
                yield f"data: {json.dumps(run_event.to_dict())}\n\n"

        except asyncio.CancelledError:
            # Client disconnected
            cancel_cb = _callbacks.get("cancel")
            if cancel_cb:
                try:
                    r = cancel_cb()
                    if asyncio.iscoroutine(r):
                        await r
                except Exception:
                    pass
            yield f"data: {json.dumps({'type': 'run_cancelled'})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

        # Save assistant response to session
        if full_response:
            await _datastore.add_message(session_id, {
                "role": "assistant",
                "content": full_response,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

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

    def __str__(self) -> str:
        return self.text

    def __repr__(self) -> str:
        return (
            f"MessageContext(text={self.text!r}, "
            f"session_id={self.session_id!r}, "
            f"agent_name={self.agent_name!r})"
        )

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

    # Store config path globally for the config endpoint
    global _config_path, _config_cache
    _config_path = config_path
    if config:
        _config_cache = config

    # Install log buffer handler to capture logs for /api/logs
    _install_log_handler()

    routes = [
        Route("/health", health, methods=["GET"]),
        Route("/login", login_handler, methods=["POST"]),
        Route("/register", register_handler, methods=["POST"]),
        Route("/logout", logout_handler, methods=["POST"]),
        Route("/me", me_handler, methods=["GET"]),
        Route("/agents", list_agents, methods=["GET"]),
        Route("/starters", get_starters, methods=["GET"]),
        Route("/profiles", get_profiles, methods=["GET"]),
        Route("/profiles/select", select_profile, methods=["POST"]),
        Route("/welcome", welcome_handler, methods=["POST"]),
        Route("/sessions", list_sessions, methods=["GET"]),
        Route("/sessions", create_session, methods=["POST"]),
        Route("/sessions/{session_id}", get_session, methods=["GET"]),
        Route("/sessions/{session_id}", patch_session, methods=["PATCH"]),
        Route("/sessions/{session_id}", delete_session, methods=["DELETE"]),
        Route("/sessions/{session_id}/runs", get_session_runs, methods=["GET"]),
        Route("/run", run_agent, methods=["POST"]),
        Route("/cancel", cancel_run, methods=["POST"]),
        Route("/agents/{agent_id}/runs", run_agent_by_id, methods=["POST"]),
        # Dashboard API
        Route("/api/overview", api_overview, methods=["GET"]),
        Route("/api/config", api_config_handler, methods=["GET", "PUT"]),
        Route("/api/logs", api_logs, methods=["GET"]),
        # Note: /api/usage is now provided by PraisonAIUsage feature
        Route("/api/debug", api_debug, methods=["GET"]),
        Route("/api/provider", api_provider, methods=["GET"]),
        # Page registry protocol
        Route("/api/pages", api_pages, methods=["GET"]),
        Route("/api/pages/{page_id}/data", api_page_data, methods=["GET"]),
        # Feature protocol registry
        Route("/api/features", api_features, methods=["GET"]),
    ]

    # ── Auto-register and mount feature protocol routes ──────────────
    auto_register_defaults()
    for feature in get_features().values():
        routes.extend(feature.routes())

    # Register built-in dashboard pages via the same protocol
    _builtin_pages = [
        {"id": "chat", "title": "Chat", "icon": "💬", "group": "Control",
         "description": "Real-time agent chat", "order": 5},
        {"id": "overview", "title": "Overview", "icon": "📊", "group": "Control",
         "description": "System health and statistics", "order": 10},
        {"id": "channels", "title": "Channels", "icon": "📡", "group": "Control",
         "description": "Messaging platform connections", "order": 15},
        {"id": "sessions", "title": "Sessions", "icon": "📋", "group": "Control",
         "description": "Manage conversation sessions", "order": 20},
        {"id": "instances", "title": "Instances", "icon": "📻", "group": "Control",
         "description": "Connected instances & presence", "order": 25},
        {"id": "usage", "title": "Usage", "icon": "📈", "group": "Control",
         "description": "Token usage and metrics", "order": 30},
        {"id": "cron", "title": "Cron", "icon": "⏰", "group": "Control",
         "description": "Scheduled jobs", "order": 35},
        {"id": "jobs", "title": "Jobs", "icon": "📋", "group": "Control",
         "description": "Async agent jobs", "order": 40},
        {"id": "approvals", "title": "Approvals", "icon": "✅", "group": "Control",
         "description": "Execution approval queue", "order": 45},
        {"id": "api", "title": "API", "icon": "🔌", "group": "Control",
         "description": "OpenAI-compatible API endpoints", "order": 50},
        {"id": "agents", "title": "Agents", "icon": "🤖", "group": "Agent",
         "description": "Configured AI agents", "order": 10},
        {"id": "skills", "title": "Skills", "icon": "⚡", "group": "Agent",
         "description": "Agent skills & plugins", "order": 20},
        {"id": "nodes", "title": "Nodes", "icon": "🖥️", "group": "Agent",
         "description": "Execution nodes & approvals", "order": 30},
        {"id": "config", "title": "Config", "icon": "⚙️", "group": "Settings",
         "description": "Server configuration", "order": 10},
        {"id": "auth", "title": "Auth", "icon": "🔐", "group": "Settings",
         "description": "Authentication settings", "order": 15},
        {"id": "logs", "title": "Logs", "icon": "📜", "group": "Settings",
         "description": "Server logs and events", "order": 20},
        {"id": "debug", "title": "Debug", "icon": "🐛", "group": "Settings",
         "description": "Debug information", "order": 30},
    ]
    _page_api_overrides = {"sessions": "/sessions", "cron": "/api/schedules", "channels": "/api/channels"}
    for p in _builtin_pages:
        if p["id"] not in _pages:  # allow user to override
            _pages[p["id"]] = {
                **p,
                "api_endpoint": _page_api_overrides.get(p["id"], f"/api/{p['id']}"),
            }

    # Always mount built-in frontend plugins and assets BEFORE catch-all /
    _frontend_dir = Path(__file__).parent / "templates" / "frontend"
    _plugins_dir = _frontend_dir / "plugins"
    _assets_dir = _frontend_dir / "assets"

    # Dynamic plugins.json route — MUST come before static /plugins mount
    # so the dynamic endpoint takes priority over the static file.
    routes.append(Route("/plugins/plugins.json", _plugins_config, methods=["GET"]))

    if _plugins_dir.exists():
        routes.append(Mount("/plugins", app=StaticFiles(directory=str(_plugins_dir))))
    if _assets_dir.exists():
        routes.append(Mount("/assets", app=StaticFiles(directory=str(_assets_dir))))

    # Add static file serving if static_dir provided (catch-all, must be last)
    if static_dir and static_dir.exists():
        routes.append(Mount("/", app=StaticFiles(directory=str(static_dir), html=True)))
    else:
        # No static_dir — serve SDK-generated HTML (dashboard, chat, etc.)
        routes.append(Route("/", _serve_index, methods=["GET"]))

    app = Starlette(
        routes=routes,
        middleware=middleware,
    )

    return app


def _install_log_handler():
    """Install the log buffer handler on the root logger."""
    handler = LogBufferHandler()
    handler.setFormatter(logging.Formatter("%(name)s - %(message)s"))
    handler.setLevel(logging.INFO)
    root = logging.getLogger()
    # Avoid duplicate handlers
    if not any(isinstance(h, LogBufferHandler) for h in root.handlers):
        root.addHandler(handler)
