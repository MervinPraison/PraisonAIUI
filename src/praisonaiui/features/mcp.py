"""Model Context Protocol (MCP) client support.

Provides first-class MCP client functionality with:
- Servers declared in YAML (``mcp:``, see ``features/mcp_servers.py``) or added at runtime
- Lifecycle hooks (@on_mcp_connect / @on_mcp_disconnect)
- Transparent tool injection into agents
- Transports: Streamable HTTP, SSE and stdio
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Protocol
from urllib.parse import urlsplit

try:
    from mcp.client.session import ClientSession
    from mcp.client.sse import sse_client
    from mcp.client.stdio import StdioServerParameters, stdio_client
    from mcp.types import Tool as MCPTool

    HAS_MCP = True
except ImportError:
    # Graceful fallback when mcp is not installed
    HAS_MCP = False
    ClientSession = None
    StdioServerParameters = None
    stdio_client = None
    sse_client = None
    MCPTool = None

logger = logging.getLogger(__name__)


class MCPTransport(Enum):
    """MCP transport types."""

    STDIO = "stdio"
    SSE = "sse"
    STREAMABLE_HTTP = "streamable-http"
    HTTP = "streamable-http"  # older name of the same member


# Spellings accepted for ``transport`` / ``type`` besides the enum values.
_TRANSPORT_ALIASES = {"http": "streamable-http", "streamable_http": "streamable-http"}


def select_transport(config: Dict[str, Any]) -> tuple[MCPTransport, bool]:
    """``(transport, explicit)`` for a server config.

    ``transport`` (or ``type``) wins. Otherwise ``command`` means stdio and
    ``url`` means Streamable HTTP, or SSE when the URL path ends in ``/sse``.
    """
    name = config.get("transport") or config.get("type")
    if name:
        try:
            transport = MCPTransport(_TRANSPORT_ALIASES.get(str(name), str(name)))
        except ValueError:
            raise ValueError(
                f"Unknown MCP transport {name!r}: use streamable-http, sse or stdio"
            ) from None
        if transport is MCPTransport.STDIO and not config.get("command"):
            raise ValueError("The stdio transport needs a 'command'")
        if transport is not MCPTransport.STDIO and not config.get("url"):
            raise ValueError(f"The {transport.value} transport needs a 'url'")
        return transport, True
    if config.get("command"):
        return MCPTransport.STDIO, False
    if config.get("url"):
        path = urlsplit(str(config["url"])).path.rstrip("/")
        return (MCPTransport.SSE if path.endswith("/sse") else MCPTransport.STREAMABLE_HTTP), False
    raise ValueError("An MCP server needs a 'url' or a 'command'")


def url_label(url: str) -> str:
    """``scheme://host[:port]/path`` of *url*: no credentials, no query."""
    parts = urlsplit(url)
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{parts.hostname or ''}{port}{parts.path}"


class MCPStatus(Enum):
    """MCP server connection status."""

    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"
    DISCONNECTED = "disconnected"


@dataclass
class ToolInfo:
    """Information about an MCP tool."""

    name: str
    description: str
    input_schema: Dict[str, Any]


@dataclass
class MCPServer:
    """Represents an MCP server instance."""

    name: str
    transport: MCPTransport
    status: MCPStatus = MCPStatus.DISCONNECTED
    tools: List[ToolInfo] = field(default_factory=list)
    last_error: Optional[str] = None
    connection_data: Dict[str, Any] = field(default_factory=dict)

    # Internal connection state
    _client: Optional[Any] = field(default=None, init=False, repr=False)
    _process: Optional[subprocess.Popen] = field(default=None, init=False, repr=False)


class MCPClientProtocol(Protocol):
    """Protocol for MCP client implementations."""

    async def connect(self) -> bool:
        """Connect to the MCP server. Returns True on success."""
        ...

    async def disconnect(self) -> None:
        """Disconnect from the MCP server."""
        ...

    async def list_tools(self) -> List[ToolInfo]:
        """List available tools from the server."""
        ...

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Call a tool on the server."""
        ...


class _SessionClient:
    """One MCP session, held open by a task of its own.

    The SDK transports are anyio task groups, which only the task that entered
    them may exit. A request that connects and a later request that
    disconnects run in different tasks, so a runner task owns the transport and
    the session for their whole life; ``disconnect()`` only signals it.
    """

    def __init__(self) -> None:
        if not HAS_MCP:
            raise ImportError("MCP library not available. Install with: pip install mcp")
        self.session: Optional[ClientSession] = None
        self.last_error: Optional[str] = None
        self._connected = False
        self._task: Optional[asyncio.Task] = None
        self._stop: Optional[asyncio.Event] = None

    @property
    def label(self) -> str:
        raise NotImplementedError

    def _streams(self) -> Any:
        """Async context manager yielding ``(read_stream, write_stream, ...)``."""
        raise NotImplementedError

    async def connect(self) -> bool:
        ready: asyncio.Future = asyncio.get_running_loop().create_future()
        self._stop = asyncio.Event()
        self._task = asyncio.create_task(self._run(ready))
        try:
            ok = await ready
        except BaseException:  # caller cancelled (e.g. a wait_for timeout)
            await self.disconnect()
            raise
        if ok:
            logger.info("Connected to MCP server %s", self.label)
        return ok

    async def _run(self, ready: asyncio.Future) -> None:
        try:
            async with contextlib.AsyncExitStack() as stack:
                streams = await stack.enter_async_context(self._streams())
                self.session = await stack.enter_async_context(
                    ClientSession(streams[0], streams[1])
                )
                await self.session.initialize()
                self._connected = True
                if not ready.done():
                    ready.set_result(True)
                await self._stop.wait()
        except Exception as e:
            while getattr(e, "exceptions", None):  # anyio task group: report the cause
                e = e.exceptions[0]
            self.last_error = str(e) or type(e).__name__
            logger.error("MCP server %s: %s", self.label, self.last_error)
        finally:
            self._connected = False
            self.session = None
            if not ready.done():
                ready.set_result(False)

    async def disconnect(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        if self._stop is not None:
            self._stop.set()
        try:
            await asyncio.wait_for(task, timeout=10.0)
        except Exception as e:  # timeout: wait_for cancelled the runner
            logger.warning("Error closing MCP server %s: %s", self.label, e)
        self._connected = False
        self.session = None

    async def list_tools(self) -> List[ToolInfo]:
        if not self.session or not self._connected:
            return []
        try:
            result = await self.session.list_tools()
            return [
                ToolInfo(
                    name=tool.name,
                    description=tool.description or "",
                    # inputSchema before mcp 2.0, input_schema since
                    input_schema=getattr(tool, "inputSchema", None)
                    or getattr(tool, "input_schema", None)
                    or {},
                )
                for tool in result.tools
            ]
        except Exception as e:
            logger.error("Failed to list tools of MCP server %s: %s", self.label, e)
            return []

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        if not self.session or not self._connected:
            raise RuntimeError("MCP session not connected")
        result = await self.session.call_tool(name, arguments)
        return result.content


class StdioMCPClient(_SessionClient):
    """MCP client that runs the server as a subprocess (stdio)."""

    def __init__(self, command: str, args: List[str], env: Optional[Dict[str, str]] = None):
        super().__init__()
        self.command = command
        self.args = list(args or [])
        # Merged over the SDK's minimal default environment (HOME, PATH, ...).
        self.env = dict(env) if env else None
        self.process: Optional[subprocess.Popen] = None  # kept for older callers

    @property
    def label(self) -> str:
        return self.command

    def _streams(self) -> Any:
        params = StdioServerParameters(command=self.command, args=self.args, env=self.env)
        return stdio_client(params)


class SSEMCPClient(_SessionClient):
    """MCP client using the older HTTP+SSE transport."""

    def __init__(self, url: str, headers: Optional[Dict[str, str]] = None):
        super().__init__()
        self.url = url
        self.headers = headers or {}

    @property
    def label(self) -> str:
        return url_label(self.url)

    def _streams(self) -> Any:
        return sse_client(self.url, headers=self.headers or None)


@contextlib.asynccontextmanager
async def _streamable_http(url: str, headers: Dict[str, str]):
    from mcp.client import streamable_http as sh

    if hasattr(sh, "streamable_http_client"):  # newer SDKs: headers ride on the client
        from mcp.shared._httpx_utils import create_mcp_http_client

        async with create_mcp_http_client(headers=headers or None) as http:
            async with sh.streamable_http_client(url, http_client=http) as streams:
                yield streams
    else:
        async with sh.streamablehttp_client(url, headers=headers or None) as streams:
            yield streams


class HTTPMCPClient(_SessionClient):
    """MCP client using the Streamable HTTP transport."""

    def __init__(self, url: str, headers: Optional[Dict[str, str]] = None):
        super().__init__()
        self.url = url
        self.headers = headers or {}

    @property
    def label(self) -> str:
        return url_label(self.url)

    def _streams(self) -> Any:
        return _streamable_http(self.url, self.headers)


StreamableHTTPMCPClient = HTTPMCPClient


def _client_for(transport: MCPTransport, config: Dict[str, Any]) -> MCPClientProtocol:
    if transport is MCPTransport.STDIO:
        return StdioMCPClient(config["command"], config.get("args") or [], env=config.get("env"))
    if transport is MCPTransport.SSE:
        return SSEMCPClient(url=config["url"], headers=config.get("headers") or {})
    return HTTPMCPClient(url=config["url"], headers=config.get("headers") or {})


# Global registry for MCP servers and lifecycle hooks
_mcp_servers: Dict[str, MCPServer] = {}
_connect_hooks: List[Callable] = []
_disconnect_hooks: List[Callable] = []
_status_change_callbacks: List[Callable] = []


class MCPClientManager:
    """Manages MCP server connections and lifecycle."""

    def __init__(self):
        self._clients: Dict[str, MCPClientProtocol] = {}

    async def connect_server(
        self, server_config: Dict[str, Any], session_context: Optional[Dict[str, Any]] = None
    ) -> MCPServer:
        """Connect to an MCP server based on configuration."""
        name = server_config["name"]
        # The message never echoes the config: it may hold headers and env.
        transport, explicit = select_transport(server_config)
        candidates = [transport]
        if transport is MCPTransport.STREAMABLE_HTTP and not explicit:
            candidates.append(MCPTransport.SSE)  # a server that only speaks the older SSE

        server = MCPServer(
            name=name,
            transport=transport,
            status=MCPStatus.CONNECTING,
            connection_data=server_config,
        )

        # Disconnect any existing client for this name (reconnect) before
        # replacing it, otherwise the previous stdio subprocess/streams are
        # orphaned when the reference is overwritten.
        previous_client = self._clients.pop(name, None)
        if previous_client is not None:
            await self._safe_disconnect(name, previous_client)

        # Register server
        _mcp_servers[name] = server

        # Notify status change
        await self._notify_status_change(server)

        for candidate in candidates:
            client = _client_for(candidate, server_config)
            server.transport = candidate
            self._clients[name] = client
            error = await self._try_connect(name, client)
            if error is None:
                server.status = MCPStatus.CONNECTED
                server.last_error = None
                server.tools = await client.list_tools()
                server._client = client
                await self._fire_connect_hooks(server, session_context)
                break
            server.status = MCPStatus.ERROR
            server.last_error = error

        # Notify final status
        await self._notify_status_change(server)
        return server

    async def _try_connect(self, name: str, client: MCPClientProtocol) -> Optional[str]:
        """Connect *client*: ``None`` on success, else the error (client released)."""
        try:
            if await asyncio.wait_for(client.connect(), timeout=120.0):
                return None
            error = getattr(client, "last_error", None)
            error = error if isinstance(error, str) and error else "Connection failed"
        except asyncio.TimeoutError:
            logger.error("Timed out connecting MCP server %s", name)
            error = "Connection timed out after 120s (check npx/Node and server args)"
        except Exception as e:
            logger.exception("Failed to connect MCP server %s", name)
            error = str(e)
        await self._cleanup_failed_client(name, client)
        return error

    async def _safe_disconnect(self, name: str, client: MCPClientProtocol) -> None:
        """Disconnect a client, logging (not raising) on failure."""
        try:
            await client.disconnect()
        except Exception:
            logger.exception(f"Error disconnecting MCP client {name}")

    async def _cleanup_failed_client(self, name: str, client: MCPClientProtocol) -> None:
        """Release a client whose connection failed and drop it from the registry."""
        await self._safe_disconnect(name, client)
        # Only remove if this client is still the registered one (avoid evicting
        # a newer client from a concurrent reconnect).
        if self._clients.get(name) is client:
            del self._clients[name]

    async def disconnect_server(
        self, name: str, session_context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Disconnect an MCP server by name."""
        if name not in _mcp_servers:
            return False

        server = _mcp_servers[name]
        client = self._clients.get(name)

        if client and server.status == MCPStatus.CONNECTED:
            try:
                await client.disconnect()

                # Fire disconnect hooks
                await self._fire_disconnect_hooks(server, session_context)

            except Exception as e:
                logger.exception(f"Error during MCP server {name} disconnect")
                server.last_error = str(e)

        # Update status
        server.status = MCPStatus.DISCONNECTED
        server.tools = []
        server._client = None

        # Clean up
        if name in self._clients:
            del self._clients[name]

        # Notify status change
        await self._notify_status_change(server)
        return True

    async def list_servers(self) -> List[MCPServer]:
        """List all registered MCP servers."""
        return list(_mcp_servers.values())

    async def get_server(self, name: str) -> Optional[MCPServer]:
        """Get a server by name."""
        return _mcp_servers.get(name)

    async def _fire_connect_hooks(self, server: MCPServer, session_context=None) -> None:
        """Fire all registered connect hooks."""
        for hook in _connect_hooks:
            try:
                await hook(server, session_context)
            except Exception as e:
                logger.exception(f"Error in MCP connect hook: {e}")

    async def _fire_disconnect_hooks(self, server: MCPServer, session_context=None) -> None:
        """Fire all registered disconnect hooks."""
        for hook in _disconnect_hooks:
            try:
                await hook(server, session_context)
            except Exception as e:
                logger.exception(f"Error in MCP disconnect hook: {e}")

    async def _notify_status_change(self, server: MCPServer) -> None:
        """Notify all status change callbacks."""
        for callback in _status_change_callbacks:
            try:
                await callback(server)
            except Exception as e:
                logger.exception(f"Error in MCP status change callback: {e}")


# Global manager instance
_manager = MCPClientManager()


def on_mcp_connect(func: Callable) -> Callable:
    """Decorator for MCP server connect lifecycle hook.

    Usage:
        @aiui.on_mcp_connect
        async def handle_connect(server: aiui.MCPServer, session: aiui.Session):
            tools = await server.list_tools()
            session.agent.add_tools(tools)
            await aiui.Message(content=f"🔌 Connected to **{server.name}**").send()
    """
    _connect_hooks.append(func)
    return func


def on_mcp_disconnect(func: Callable) -> Callable:
    """Decorator for MCP server disconnect lifecycle hook.

    Usage:
        @aiui.on_mcp_disconnect
        async def handle_disconnect(server: aiui.MCPServer, session: aiui.Session):
            session.agent.remove_tools_from_source(server.name)
            await aiui.Message(content=f"🔌 Disconnected from **{server.name}**").send()
    """
    _disconnect_hooks.append(func)
    return func


def add_status_change_callback(callback: Callable) -> None:
    """Add a callback for MCP server status changes (for UI updates)."""
    _status_change_callbacks.append(callback)


async def connect_mcp_server(
    config: Dict[str, Any], session_context: Optional[Dict[str, Any]] = None
) -> MCPServer:
    """Connect to an MCP server."""
    return await _manager.connect_server(config, session_context=session_context)


async def disconnect_mcp_server(
    name: str, session_context: Optional[Dict[str, Any]] = None
) -> bool:
    """Disconnect an MCP server."""
    return await _manager.disconnect_server(name, session_context=session_context)


async def list_mcp_servers() -> List[MCPServer]:
    """List all MCP servers."""
    return await _manager.list_servers()


async def get_mcp_server(name: str) -> Optional[MCPServer]:
    """Get an MCP server by name."""
    return await _manager.get_server(name)


async def disconnect_all_mcp_servers() -> None:
    """Disconnect every connected server (server shutdown: no stdio child outlives it)."""
    for name in list(_manager._clients):
        await _manager.disconnect_server(name)


# Auto-load MCP servers from config if available
async def auto_discover_mcp_servers() -> None:
    """Auto-discover and connect MCP servers from configuration."""
    try:
        from ._paths import feature_data_path

        config_path = feature_data_path("mcp.json", Path.home() / ".praisonai" / "mcp.json")
        if not config_path.exists():
            return

        config_data = json.loads(config_path.read_text(encoding="utf-8"))
        servers = config_data.get("servers", [])
        if not isinstance(servers, list):
            return

        for server_config in servers:
            if isinstance(server_config, dict) and server_config.get("name"):
                await connect_mcp_server(server_config)
    except Exception as e:
        logger.exception(f"Failed to auto-discover MCP servers: {e}")
