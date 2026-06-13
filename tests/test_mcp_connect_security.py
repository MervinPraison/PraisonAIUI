"""PraisonAIUI MCP connect hardening tests."""

from __future__ import annotations

from starlette.requests import Request

from praisonaiui.server import _mcp_stdio_connect_allowed


def test_mcp_stdio_connect_blocks_remote():
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/mcp/connect",
        "headers": [],
        "client": ("203.0.113.1", 12345),
    }
    request = Request(scope)
    assert _mcp_stdio_connect_allowed(request) is False


def test_mcp_stdio_connect_allows_loopback():
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/mcp/connect",
        "headers": [],
        "client": ("127.0.0.1", 12345),
    }
    request = Request(scope)
    assert _mcp_stdio_connect_allowed(request) is True
