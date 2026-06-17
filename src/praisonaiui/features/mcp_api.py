"""MCP API endpoints for UI management."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol
from .mcp import (
    MCPServer,
    MCPStatus,
    connect_mcp_server,
    disconnect_mcp_server,
    get_mcp_server,
    list_mcp_servers,
)

logger = logging.getLogger(__name__)


class MCPAPIFeature(BaseFeatureProtocol):
    """REST API endpoints for MCP server management."""

    feature_name = "mcp_api"
    feature_description = "MCP server management API endpoints"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/mcp/servers", self._list_servers, methods=["GET"]),
            Route("/api/mcp/connect", self._connect_server, methods=["POST"]),
            Route("/api/mcp/disconnect", self._disconnect_server, methods=["POST"]),
            Route("/api/mcp/test-tool", self._test_tool, methods=["POST"]),
            Route("/api/mcp/server/{name}", self._get_server, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        servers = await list_mcp_servers()
        connected = sum(1 for s in servers if s.status == MCPStatus.CONNECTED)
        return {
            "status": "ok",
            "feature": self.name,
            "total_servers": len(servers),
            "connected_servers": connected,
        }

    async def _list_servers(self, request: Request) -> JSONResponse:
        """List all MCP servers."""
        try:
            servers = await list_mcp_servers()
            return JSONResponse({
                "servers": [self._serialize_server(s) for s in servers],
                "count": len(servers),
            })
        except Exception as e:
            logger.error(f"Failed to list MCP servers: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    async def _connect_server(self, request: Request) -> JSONResponse:
        """Connect to an MCP server."""
        try:
            config = await request.json()

            # Validate required fields
            if "name" not in config:
                return JSONResponse({"error": "Server name is required"}, status_code=400)

            # Connect to the server
            server = await connect_mcp_server(config)

            return JSONResponse({
                "server": self._serialize_server(server),
                "success": server.status == MCPStatus.CONNECTED,
            }, status_code=201 if server.status == MCPStatus.CONNECTED else 500)

        except Exception as e:
            logger.error(f"Failed to connect MCP server: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    async def _disconnect_server(self, request: Request) -> JSONResponse:
        """Disconnect an MCP server."""
        try:
            body = await request.json()
            name = body.get("name")

            if not name:
                return JSONResponse({"error": "Server name is required"}, status_code=400)

            success = await disconnect_mcp_server(name)

            if success:
                return JSONResponse({"success": True, "message": f"Disconnected from {name}"})
            else:
                return JSONResponse({"error": f"Server {name} not found"}, status_code=404)

        except Exception as e:
            logger.error(f"Failed to disconnect MCP server: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    async def _get_server(self, request: Request) -> JSONResponse:
        """Get a specific MCP server by name."""
        try:
            name = request.path_params["name"]
            server = await get_mcp_server(name)

            if server:
                return JSONResponse({"server": self._serialize_server(server)})
            else:
                return JSONResponse({"error": f"Server {name} not found"}, status_code=404)

        except Exception as e:
            logger.error(f"Failed to get MCP server: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    async def _test_tool(self, request: Request) -> JSONResponse:
        """Test a tool from an MCP server."""
        try:
            body = await request.json()
            server_name = body.get("server")
            tool_name = body.get("tool")
            arguments = body.get("arguments", {})

            if not server_name or not tool_name:
                return JSONResponse(
                    {"error": "Server name and tool name are required"},
                    status_code=400
                )

            server = await get_mcp_server(server_name)
            if not server:
                return JSONResponse({"error": f"Server {server_name} not found"}, status_code=404)

            if server.status != MCPStatus.CONNECTED:
                return JSONResponse(
                    {"error": f"Server {server_name} is not connected"},
                    status_code=400
                )

            # Get the client from the server
            client = getattr(server, "_client", None)
            if not client:
                return JSONResponse({"error": "Server client not available"}, status_code=500)

            # Call the tool
            try:
                result = await client.call_tool(tool_name, arguments)
                return JSONResponse({
                    "success": True,
                    "result": result,
                    "tool": tool_name,
                    "server": server_name,
                })
            except Exception as tool_error:
                return JSONResponse({
                    "error": f"Tool execution failed: {tool_error}",
                    "tool": tool_name,
                    "server": server_name,
                }, status_code=500)

        except Exception as e:
            logger.error(f"Failed to test MCP tool: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    def _serialize_server(self, server: MCPServer) -> Dict[str, Any]:
        """Serialize an MCP server for JSON response."""
        return {
            "name": server.name,
            "transport": server.transport.value,
            "status": server.status.value,
            "tools": [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                }
                for tool in server.tools
            ],
            "last_error": server.last_error,
            "connection_data": server.connection_data,
        }
