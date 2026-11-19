"""Tests for MCP (Model Context Protocol) client functionality."""

import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from praisonaiui.features.mcp import (
    HTTPMCPClient,
    MCPClientManager,
    MCPServer,
    MCPStatus,
    MCPTransport,
    SSEMCPClient,
    StdioMCPClient,
    ToolInfo,
    _connect_hooks,
    _disconnect_hooks,
    _mcp_servers,
    connect_mcp_server,
    disconnect_mcp_server,
    get_mcp_server,
    list_mcp_servers,
    on_mcp_connect,
    on_mcp_disconnect,
)


@pytest.fixture(autouse=True)
def reset_mcp_state():
    """Reset MCP global state before each test."""
    _mcp_servers.clear()
    _connect_hooks.clear()
    _disconnect_hooks.clear()


@pytest.fixture
def sample_tool():
    """Sample MCP tool for testing."""
    return ToolInfo(
        name="test_tool",
        description="A test tool",
        input_schema={"type": "object", "properties": {"arg": {"type": "string"}}}
    )


@pytest.fixture
def sample_server(sample_tool):
    """Sample MCP server for testing."""
    return MCPServer(
        name="test_server",
        transport=MCPTransport.STDIO,
        status=MCPStatus.CONNECTED,
        tools=[sample_tool],
        connection_data={"command": "test", "args": ["--test"]}
    )


class TestMCPDataClasses:
    """Test MCP data classes."""

    def test_tool_info_creation(self):
        """Test ToolInfo creation."""
        tool = ToolInfo(
            name="test_tool",
            description="Test description",
            input_schema={"type": "object"}
        )
        assert tool.name == "test_tool"
        assert tool.description == "Test description"
        assert tool.input_schema == {"type": "object"}

    def test_mcp_server_creation(self):
        """Test MCPServer creation with defaults."""
        server = MCPServer(
            name="test",
            transport=MCPTransport.STDIO
        )
        assert server.name == "test"
        assert server.transport == MCPTransport.STDIO
        assert server.status == MCPStatus.DISCONNECTED
        assert server.tools == []
        assert server.last_error is None
        assert server.connection_data == {}

    def test_mcp_server_with_tools(self, sample_tool):
        """Test MCPServer with tools."""
        server = MCPServer(
            name="test",
            transport=MCPTransport.STDIO,
            tools=[sample_tool]
        )
        assert len(server.tools) == 1
        assert server.tools[0].name == "test_tool"


def _fake_streams(*_args, **_kwargs):
    """Stand-in for an SDK transport: an async context manager of two streams."""

    @contextlib.asynccontextmanager
    async def cm():
        yield (MagicMock(), MagicMock())

    return cm()


class _FakeSession:
    """Stand-in for mcp ClientSession."""

    instances: list = []

    def __init__(self, read, write):
        self.initialize = AsyncMock()
        self.list_tools = AsyncMock()
        self.call_tool = AsyncMock()
        self.closed = False
        _FakeSession.instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        self.closed = True


class TestStdioMCPClient:
    """Test stdio MCP client."""

    @pytest.mark.asyncio
    async def test_stdio_client_creation(self):
        client = StdioMCPClient("test_command", ["arg1", "arg2"])
        assert client.command == "test_command"
        assert client.args == ["arg1", "arg2"]
        assert client.env is None
        assert client.process is None

    @pytest.mark.asyncio
    async def test_stdio_connect_success_and_disconnect_from_another_task(self):
        """The session lives in its own task, so any task may close it."""
        client = StdioMCPClient("echo", ["test"], env={"API_KEY": "k"})
        with (
            patch("praisonaiui.features.mcp.stdio_client", side_effect=_fake_streams) as stdio,
            patch("praisonaiui.features.mcp.ClientSession", _FakeSession),
        ):
            assert await client.connect() is True
            params = stdio.call_args.args[0]
            assert (params.command, params.args, params.env) == ("echo", ["test"], {"API_KEY": "k"})
            session = client.session
            session.initialize.assert_awaited_once()
            await asyncio.create_task(client.disconnect())
        assert session.closed is True
        assert client.session is None

    @pytest.mark.asyncio
    async def test_stdio_connect_failure(self):
        client = StdioMCPClient("nonexistent_command", [])
        with patch("praisonaiui.features.mcp.stdio_client", side_effect=FileNotFoundError("nope")):
            assert await client.connect() is False
        assert client.last_error == "nope"

    @pytest.mark.asyncio
    async def test_stdio_disconnect_without_connect(self):
        client = StdioMCPClient("echo", ["test"])
        await client.disconnect()
        assert client.session is None

    @pytest.mark.asyncio
    async def test_stdio_list_tools(self):
        client = StdioMCPClient("echo", ["test"])
        mock_session = AsyncMock()
        mock_tool = MagicMock()
        mock_tool.name = "filesystem_read"
        mock_tool.description = "Read file contents"
        mock_tool.inputSchema = {"type": "object", "properties": {"path": {"type": "string"}}}
        mock_result = MagicMock()
        mock_result.tools = [mock_tool]
        mock_session.list_tools.return_value = mock_result
        client.session = mock_session
        client._connected = True

        tools = await client.list_tools()

        assert len(tools) == 1
        assert tools[0].name == "filesystem_read"
        assert "Read file contents" in tools[0].description

    @pytest.mark.asyncio
    async def test_stdio_call_tool(self):
        client = StdioMCPClient("echo", ["test"])
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.content = [{"type": "text", "text": "ok"}]
        mock_session.call_tool.return_value = mock_result
        client.session = mock_session
        client._connected = True

        result = await client.call_tool("test_tool", {"arg": "value"})

        assert result == [{"type": "text", "text": "ok"}]
        mock_session.call_tool.assert_called_once_with("test_tool", {"arg": "value"})


class TestSSEMCPClient:
    """Test SSE MCP client."""

    @pytest.mark.asyncio
    async def test_sse_client_creation(self):
        client = SSEMCPClient("https://example.com/sse", {"Auth": "token"})
        assert client.url == "https://example.com/sse"
        assert client.headers == {"Auth": "token"}

    @pytest.mark.asyncio
    async def test_sse_connect_passes_headers(self):
        client = SSEMCPClient("https://example.com/events", {"Authorization": "Bearer t"})
        with (
            patch("praisonaiui.features.mcp.sse_client", side_effect=_fake_streams) as sse,
            patch("praisonaiui.features.mcp.ClientSession", _FakeSession),
        ):
            assert await client.connect() is True
            await client.disconnect()
        sse.assert_called_once_with(
            "https://example.com/events", headers={"Authorization": "Bearer t"}
        )

    @pytest.mark.asyncio
    async def test_sse_list_tools_empty(self):
        client = SSEMCPClient("https://example.com/sse")
        assert await client.list_tools() == []


class TestHTTPMCPClient:
    """Test the Streamable HTTP client."""

    @pytest.mark.asyncio
    async def test_http_client_creation(self):
        client = HTTPMCPClient("https://example.com", {"Auth": "token"})
        assert client.url == "https://example.com"
        assert client.headers == {"Auth": "token"}

    @pytest.mark.asyncio
    async def test_http_connect_uses_streamable_http(self):
        client = HTTPMCPClient("https://example.com/mcp", {"Authorization": "Bearer t"})
        with (
            patch("praisonaiui.features.mcp._streamable_http", side_effect=_fake_streams) as http,
            patch("praisonaiui.features.mcp.ClientSession", _FakeSession),
        ):
            assert await client.connect() is True
            assert client.session is not None
            await client.disconnect()
        http.assert_called_once_with("https://example.com/mcp", {"Authorization": "Bearer t"})


class TestMCPClientManager:
    """Test MCP client manager."""

    def test_manager_creation(self):
        """Test manager creation."""
        manager = MCPClientManager()
        assert manager._clients == {}

    @pytest.mark.asyncio
    async def test_connect_stdio_server_success(self):
        """Test connecting to stdio server successfully."""
        manager = MCPClientManager()
        config = {
            "name": "test_server",
            "command": "echo",
            "args": ["test"]
        }

        with patch("praisonaiui.features.mcp.StdioMCPClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.connect.return_value = True
            mock_client.list_tools.return_value = [
                ToolInfo("tool1", "Test tool", {"type": "object"})
            ]
            mock_client_class.return_value = mock_client

            server = await manager.connect_server(config)

            assert server.name == "test_server"
            assert server.transport == MCPTransport.STDIO
            assert server.status == MCPStatus.CONNECTED
            assert len(server.tools) == 1
            assert server.tools[0].name == "tool1"

    @pytest.mark.asyncio
    async def test_connect_sse_server(self):
        """Test connecting to SSE server."""
        manager = MCPClientManager()
        config = {
            "name": "sse_server",
            "url": "https://example.com/sse",
            "headers": {"Auth": "token"}
        }

        with patch("praisonaiui.features.mcp.SSEMCPClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.connect.return_value = False  # Not implemented yet
            mock_client_class.return_value = mock_client

            server = await manager.connect_server(config)

            assert server.name == "sse_server"
            assert server.transport == MCPTransport.SSE
            assert server.status == MCPStatus.ERROR

    @pytest.mark.asyncio
    async def test_connect_http_server(self):
        """A url defaults to Streamable HTTP, then falls back to SSE."""
        manager = MCPClientManager()
        config = {"name": "http_server", "url": "https://example.com/api"}

        with (
            patch("praisonaiui.features.mcp.HTTPMCPClient") as http_cls,
            patch("praisonaiui.features.mcp.SSEMCPClient") as sse_cls,
        ):
            http_cls.return_value = AsyncMock(**{"connect.return_value": False})
            sse_client = AsyncMock(**{"connect.return_value": True, "list_tools.return_value": []})
            sse_cls.return_value = sse_client

            server = await manager.connect_server(config)

            http_cls.assert_called_once()
            assert server.transport == MCPTransport.SSE
            assert server.status == MCPStatus.CONNECTED
            assert manager._clients["http_server"] is sse_client

    @pytest.mark.asyncio
    async def test_explicit_transport_has_no_fallback(self):
        manager = MCPClientManager()
        config = {"name": "h", "url": "https://example.com/api", "transport": "streamable-http"}

        with (
            patch("praisonaiui.features.mcp.HTTPMCPClient") as http_cls,
            patch("praisonaiui.features.mcp.SSEMCPClient") as sse_cls,
        ):
            http_cls.return_value = AsyncMock(**{"connect.return_value": False})
            server = await manager.connect_server(config)

        sse_cls.assert_not_called()
        assert server.transport is MCPTransport.HTTP  # older name, same member
        assert server.status == MCPStatus.ERROR
        assert server.last_error == "Connection failed"

    @pytest.mark.asyncio
    async def test_connect_server_invalid_config(self):
        """Test connecting with invalid config."""
        manager = MCPClientManager()
        config = {
            "name": "invalid_server"
            # Missing command or url
        }

        with pytest.raises(ValueError, match="needs a 'url' or a 'command'"):
            await manager.connect_server(config)

    @pytest.mark.asyncio
    async def test_reconnect_same_name_disconnects_old(self):
        """Reconnecting the same name disconnects the previous client (no leak)."""
        manager = MCPClientManager()

        old_client = AsyncMock()
        old_client.disconnect = AsyncMock()
        manager._clients["srv"] = old_client

        config = {"name": "srv", "command": "echo", "args": []}
        with patch("praisonaiui.features.mcp.StdioMCPClient") as mock_client_class:
            new_client = AsyncMock()
            new_client.connect.return_value = True
            new_client.list_tools.return_value = []
            mock_client_class.return_value = new_client

            await manager.connect_server(config)

        old_client.disconnect.assert_awaited_once()
        assert manager._clients["srv"] is new_client

    @pytest.mark.asyncio
    async def test_connect_failure_removes_client(self):
        """A failed connect (returns False) removes the client from the registry."""
        manager = MCPClientManager()
        config = {"name": "srv", "command": "echo", "args": []}

        with patch("praisonaiui.features.mcp.StdioMCPClient") as mock_client_class:
            client = AsyncMock()
            client.connect.return_value = False
            mock_client_class.return_value = client

            server = await manager.connect_server(config)

        assert server.status == MCPStatus.ERROR
        client.disconnect.assert_awaited_once()
        assert "srv" not in manager._clients

    @pytest.mark.asyncio
    async def test_connect_exception_removes_client(self):
        """A connect that raises removes the client from the registry."""
        manager = MCPClientManager()
        config = {"name": "srv", "command": "echo", "args": []}

        with patch("praisonaiui.features.mcp.StdioMCPClient") as mock_client_class:
            client = AsyncMock()
            client.connect.side_effect = Exception("boom")
            mock_client_class.return_value = client

            server = await manager.connect_server(config)

        assert server.status == MCPStatus.ERROR
        client.disconnect.assert_awaited_once()
        assert "srv" not in manager._clients

    @pytest.mark.asyncio
    async def test_disconnect_server_success(self):
        """Test successful server disconnect."""
        manager = MCPClientManager()

        # First connect a server
        _mcp_servers["test_server"] = MCPServer(
            name="test_server",
            transport=MCPTransport.STDIO,
            status=MCPStatus.CONNECTED
        )

        mock_client = AsyncMock()
        manager._clients["test_server"] = mock_client

        result = await manager.disconnect_server("test_server")

        assert result is True
        mock_client.disconnect.assert_called_once()
        assert _mcp_servers["test_server"].status == MCPStatus.DISCONNECTED

    @pytest.mark.asyncio
    async def test_disconnect_server_not_found(self):
        """Test disconnect of non-existent server."""
        manager = MCPClientManager()

        result = await manager.disconnect_server("nonexistent")
        assert result is False

    @pytest.mark.asyncio
    async def test_list_servers(self, sample_server):
        """Test listing all servers."""
        manager = MCPClientManager()
        _mcp_servers["test_server"] = sample_server

        servers = await manager.list_servers()
        assert len(servers) == 1
        assert servers[0].name == "test_server"

    @pytest.mark.asyncio
    async def test_get_server(self, sample_server):
        """Test getting a server by name."""
        manager = MCPClientManager()
        _mcp_servers["test_server"] = sample_server

        server = await manager.get_server("test_server")
        assert server is not None
        assert server.name == "test_server"

        server = await manager.get_server("nonexistent")
        assert server is None


class TestMCPLifecycleHooks:
    """Test MCP lifecycle hooks."""

    @pytest.mark.asyncio
    async def test_on_mcp_connect_decorator(self):
        """Test on_mcp_connect decorator."""
        called = False

        @on_mcp_connect
        async def test_hook(server, session):
            nonlocal called
            called = True
            assert server.name == "test_server"

        # Verify hook was registered
        assert test_hook in _connect_hooks

        # Call the hook manually to test it
        server = MCPServer("test_server", MCPTransport.STDIO)
        await test_hook(server, None)
        assert called is True

    @pytest.mark.asyncio
    async def test_on_mcp_disconnect_decorator(self):
        """Test on_mcp_disconnect decorator."""
        called = False

        @on_mcp_disconnect
        async def test_hook(server, session):
            nonlocal called
            called = True
            assert server.name == "test_server"

        # Verify hook was registered
        assert test_hook in _disconnect_hooks

        # Call the hook manually to test it
        server = MCPServer("test_server", MCPTransport.STDIO)
        await test_hook(server, None)
        assert called is True

    @pytest.mark.asyncio
    async def test_multiple_connect_hooks(self):
        """Test multiple connect hooks are called."""
        call_order = []

        @on_mcp_connect
        async def hook1(server, session):
            call_order.append("hook1")

        @on_mcp_connect
        async def hook2(server, session):
            call_order.append("hook2")

        # Simulate firing hooks
        manager = MCPClientManager()
        server = MCPServer("test", MCPTransport.STDIO)
        await manager._fire_connect_hooks(server)

        assert len(call_order) == 2
        assert "hook1" in call_order
        assert "hook2" in call_order


class TestMCPGlobalFunctions:
    """Test global MCP functions."""

    @pytest.mark.asyncio
    async def test_connect_mcp_server(self):
        """Test global connect_mcp_server function."""
        config = {"name": "test", "command": "echo"}

        with patch("praisonaiui.features.mcp._manager.connect_server") as mock_connect:
            mock_server = MCPServer("test", MCPTransport.STDIO)
            mock_connect.return_value = mock_server

            result = await connect_mcp_server(config)

            mock_connect.assert_called_once_with(config, session_context=None)
            assert result == mock_server

    @pytest.mark.asyncio
    async def test_disconnect_mcp_server(self):
        """Test global disconnect_mcp_server function."""
        with patch("praisonaiui.features.mcp._manager.disconnect_server") as mock_disconnect:
            mock_disconnect.return_value = True

            result = await disconnect_mcp_server("test")

            mock_disconnect.assert_called_once_with("test", session_context=None)
            assert result is True

    @pytest.mark.asyncio
    async def test_list_mcp_servers(self):
        """Test global list_mcp_servers function."""
        with patch("praisonaiui.features.mcp._manager.list_servers") as mock_list:
            mock_servers = [MCPServer("test", MCPTransport.STDIO)]
            mock_list.return_value = mock_servers

            result = await list_mcp_servers()

            mock_list.assert_called_once()
            assert result == mock_servers

    @pytest.mark.asyncio
    async def test_get_mcp_server(self):
        """Test global get_mcp_server function."""
        with patch("praisonaiui.features.mcp._manager.get_server") as mock_get:
            mock_server = MCPServer("test", MCPTransport.STDIO)
            mock_get.return_value = mock_server

            result = await get_mcp_server("test")

            mock_get.assert_called_once_with("test")
            assert result == mock_server


class TestMCPErrorHandling:
    """Test MCP error handling."""

    @pytest.mark.asyncio
    async def test_connect_server_with_exception(self):
        """Test handling exceptions during server connection."""
        manager = MCPClientManager()
        config = {"name": "test", "command": "echo"}

        with patch("praisonaiui.features.mcp.StdioMCPClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.connect.side_effect = Exception("Connection failed")
            mock_client_class.return_value = mock_client

            server = await manager.connect_server(config)

            assert server.status == MCPStatus.ERROR
            assert "Connection failed" in server.last_error

    @pytest.mark.asyncio
    async def test_fire_hooks_with_exception(self):
        """Test that hook exceptions don't break the flow."""
        @on_mcp_connect
        async def failing_hook(server, session):
            raise Exception("Hook failed")

        @on_mcp_connect
        async def working_hook(server, session):
            server.connection_data["hook_called"] = True

        manager = MCPClientManager()
        server = MCPServer("test", MCPTransport.STDIO)

        # Should not raise exception despite failing hook
        await manager._fire_connect_hooks(server)

        # Working hook should still be called
        assert server.connection_data.get("hook_called") is True


class TestMCPConcurrency:
    """Test MCP concurrent operations."""

    @pytest.mark.asyncio
    async def test_concurrent_connect_disconnect(self):
        """Test concurrent connect and disconnect operations."""
        manager = MCPClientManager()

        async def connect_task():
            config = {"name": "test", "command": "echo"}
            with patch("praisonaiui.features.mcp.StdioMCPClient"):
                return await manager.connect_server(config)

        async def disconnect_task():
            # Wait a bit before disconnect
            await asyncio.sleep(0.1)
            return await manager.disconnect_server("test")

        # Run both tasks concurrently
        connect_result, disconnect_result = await asyncio.gather(
            connect_task(),
            disconnect_task(),
            return_exceptions=True
        )

        # Both should complete without deadlock
        assert isinstance(connect_result, MCPServer)
        assert isinstance(disconnect_result, bool)

    @pytest.mark.asyncio
    async def test_multiple_servers_concurrent(self):
        """Test connecting multiple servers concurrently."""
        manager = MCPClientManager()

        configs = [
            {"name": f"server_{i}", "command": "echo", "args": [str(i)]}
            for i in range(3)
        ]

        with patch("praisonaiui.features.mcp.StdioMCPClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.connect.return_value = True
            mock_client.list_tools.return_value = []
            mock_client_class.return_value = mock_client

            # Connect all servers concurrently
            tasks = [manager.connect_server(config) for config in configs]
            servers = await asyncio.gather(*tasks)

            assert len(servers) == 3
            assert all(server.status == MCPStatus.CONNECTED for server in servers)
            assert len(_mcp_servers) == 3
