"""Model Context Protocol (MCP) client support.

Provides first-class MCP client functionality with:
- Auto-discovery of MCP servers from config
- Lifecycle hooks (@on_mcp_connect / @on_mcp_disconnect)
- Transparent tool injection into agents
- Multi-transport support (stdio, SSE, HTTP)
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Protocol

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
    HTTP = "http"


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


class StdioMCPClient:
    """MCP client using stdio transport with proper MCP SDK."""

    def __init__(self, command: str, args: List[str]):
        if not HAS_MCP:
            raise ImportError("MCP library not available. Install with: pip install mcp")

        self.command = command
        self.args = args
        self.session: Optional[ClientSession] = None
        self._connected = False
        self._session_manager = None
        # For test backward compatibility
        self.process: Optional[subprocess.Popen] = None

    async def connect(self) -> bool:
        """Connect via stdio subprocess using official MCP SDK."""
        try:
            # Use official MCP stdio_client instead of raw subprocess
            server_params = StdioServerParameters(command=self.command, args=self.args)

            # Create a new session using stdio_client context manager
            session_manager = stdio_client(server_params)
            self.session = await session_manager.__aenter__()

            # Initialize the MCP session
            await self.session.initialize()

            # Store the context manager for cleanup
            self._session_manager = session_manager

            self._connected = True
            logger.info(f"Connected to MCP stdio server: {self.command}")
            return True

        except Exception as e:
            logger.error(f"Failed to connect to MCP stdio server: {e}")
            self._connected = False
            return False

    async def disconnect(self) -> None:
        """Properly disconnect the MCP session."""
        if self.session and self._connected:
            try:
                # Properly exit the context manager
                if hasattr(self, "_session_manager"):
                    await self._session_manager.__aexit__(None, None, None)
                else:
                    await self.session.close()
            except Exception as e:
                logger.warning(f"Error during MCP session close: {e}")
            finally:
                self.session = None
                self._connected = False
                self.process = None  # Reset for backward compatibility

    async def list_tools(self) -> List[ToolInfo]:
        """List tools via proper MCP protocol."""
        if not self.session or not self._connected:
            return []

        try:
            result = await self.session.list_tools()
            tools = []

            for tool in result.tools:
                tools.append(
                    ToolInfo(
                        name=tool.name,
                        description=tool.description or "",
                        input_schema=tool.inputSchema or {},
                    )
                )

            return tools

        except Exception as e:
            logger.error(f"Failed to list MCP tools: {e}")
            return []

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Call tool via proper MCP protocol."""
        if not self.session or not self._connected:
            raise RuntimeError("MCP session not connected")

        try:
            result = await self.session.call_tool(name, arguments)
            return result.content

        except Exception as e:
            logger.error(f"Failed to call MCP tool {name}: {e}")
            raise


class SSEMCPClient:
    """MCP client using Server-Sent Events transport."""

    def __init__(self, url: str, headers: Optional[Dict[str, str]] = None):
        if not HAS_MCP:
            raise ImportError("MCP library not available. Install with: pip install mcp")

        self.url = url
        self.headers = headers or {}
        self.session: Optional[ClientSession] = None
        self._connected = False
        self._session_manager = None

    async def connect(self) -> bool:
        """Connect via SSE using official MCP SDK."""
        try:
            # Use official MCP sse_client context manager
            session_manager = sse_client(self.url, headers=self.headers)
            self.session = await session_manager.__aenter__()

            # Initialize the MCP session
            await self.session.initialize()

            # Store the context manager for cleanup
            self._session_manager = session_manager

            self._connected = True
            logger.info(f"Connected to MCP SSE server at {self.url}")
            return True

        except Exception as e:
            logger.error(f"Failed to connect to MCP SSE server: {e}")
            self._connected = False
            return False

    async def disconnect(self) -> None:
        """Properly disconnect SSE."""
        if self.session and self._connected:
            try:
                # Properly exit the context manager
                if hasattr(self, "_session_manager") and self._session_manager:
                    await self._session_manager.__aexit__(None, None, None)
                else:
                    await self.session.close()
            except Exception as e:
                logger.warning(f"Error during MCP SSE session close: {e}")
            finally:
                self.session = None
                self._connected = False

    async def list_tools(self) -> List[ToolInfo]:
        """List tools via proper MCP SSE protocol."""
        if not self.session or not self._connected:
            return []

        try:
            result = await self.session.list_tools()
            tools = []

            for tool in result.tools:
                tools.append(
                    ToolInfo(
                        name=tool.name,
                        description=tool.description or "",
                        input_schema=tool.inputSchema or {},
                    )
                )

            return tools

        except Exception as e:
            logger.error(f"Failed to list MCP SSE tools: {e}")
            return []

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Call tool via proper MCP SSE protocol."""
        if not self.session or not self._connected:
            raise RuntimeError("MCP SSE session not connected")

        try:
            result = await self.session.call_tool(name, arguments)
            return result.content

        except Exception as e:
            logger.error(f"Failed to call MCP SSE tool {name}: {e}")
            raise


class HTTPMCPClient:
    """MCP client using HTTP transport (not yet supported by MCP SDK)."""

    def __init__(self, url: str, headers: Optional[Dict[str, str]] = None):
        if not HAS_MCP:
            raise ImportError("MCP library not available. Install with: pip install mcp")

        self.url = url
        self.headers = headers or {}
        self.session: Optional[ClientSession] = None
        self._connected = False
        self._session_manager = None

    async def connect(self) -> bool:
        """Connect via HTTP (not yet implemented in MCP SDK)."""
        logger.warning("HTTP transport not yet supported by MCP SDK")
        return False

    async def disconnect(self) -> None:
        """Disconnect HTTP."""
        pass

    async def list_tools(self) -> List[ToolInfo]:
        """List tools via HTTP (not yet implemented)."""
        return []

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Call tool via HTTP (not yet implemented)."""
        return {}


# Global registry for MCP servers and lifecycle hooks
_mcp_servers: Dict[str, MCPServer] = {}
_connect_hooks: List[Callable] = []
_disconnect_hooks: List[Callable] = []
_status_change_callbacks: List[Callable] = []


class MCPClientManager:
    """Manages MCP server connections and lifecycle."""

    def __init__(self):
        self._clients: Dict[str, MCPClientProtocol] = {}

    async def connect_server(self, server_config: Dict[str, Any]) -> MCPServer:
        """Connect to an MCP server based on configuration."""
        name = server_config["name"]

        # Create server instance
        if "command" in server_config:
            transport = MCPTransport.STDIO
            client = StdioMCPClient(
                command=server_config["command"], args=server_config.get("args", [])
            )
        elif "url" in server_config:
            url = server_config["url"]
            if "sse" in url or "stream" in url:
                transport = MCPTransport.SSE
                client = SSEMCPClient(url=url, headers=server_config.get("headers", {}))
            else:
                transport = MCPTransport.HTTP
                client = HTTPMCPClient(url=url, headers=server_config.get("headers", {}))
        else:
            raise ValueError(f"Invalid MCP server config: {server_config}")

        server = MCPServer(
            name=name,
            transport=transport,
            status=MCPStatus.CONNECTING,
            connection_data=server_config,
        )

        # Register server
        _mcp_servers[name] = server
        self._clients[name] = client

        # Notify status change
        await self._notify_status_change(server)

        try:
            # Attempt connection
            connected = await client.connect()
            if connected:
                server.status = MCPStatus.CONNECTED
                server.tools = await client.list_tools()
                server._client = client

                # Fire connect hooks
                await self._fire_connect_hooks(server, None)  # TODO: pass actual session context
            else:
                server.status = MCPStatus.ERROR
                server.last_error = "Connection failed"

        except Exception as e:
            logger.exception(f"Failed to connect MCP server {name}")
            server.status = MCPStatus.ERROR
            server.last_error = str(e)

        # Notify final status
        await self._notify_status_change(server)
        return server

    async def disconnect_server(self, name: str) -> bool:
        """Disconnect an MCP server by name."""
        if name not in _mcp_servers:
            return False

        server = _mcp_servers[name]
        client = self._clients.get(name)

        if client and server.status == MCPStatus.CONNECTED:
            try:
                await client.disconnect()

                # Fire disconnect hooks
                await self._fire_disconnect_hooks(server, None)  # TODO: pass actual session context

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


async def connect_mcp_server(config: Dict[str, Any]) -> MCPServer:
    """Connect to an MCP server."""
    return await _manager.connect_server(config)


async def disconnect_mcp_server(name: str) -> bool:
    """Disconnect an MCP server."""
    return await _manager.disconnect_server(name)


async def list_mcp_servers() -> List[MCPServer]:
    """List all MCP servers."""
    return await _manager.list_servers()


async def get_mcp_server(name: str) -> Optional[MCPServer]:
    """Get an MCP server by name."""
    return await _manager.get_server(name)


# Auto-load MCP servers from config if available
async def auto_discover_mcp_servers() -> None:
    """Auto-discover and connect MCP servers from configuration."""
    try:
        # TODO: Load from actual config file
        # For now, this is a placeholder
        logger.info("MCP auto-discovery not yet implemented")
    except Exception as e:
        logger.exception(f"Failed to auto-discover MCP servers: {e}")
