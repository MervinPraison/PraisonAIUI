"""MCP transports and secrets: Streamable HTTP, explicit SSE, masking, log redaction.

No real server or network: transports are stubbed.
"""

from __future__ import annotations

import logging
import sys
from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui import http_guard
from praisonaiui.features import mcp, mcp_servers
from praisonaiui.features.mcp import MCPServer, MCPStatus, MCPTransport, select_transport
from praisonaiui.server import create_app


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(http_guard, "_KNOWN_SECRETS", set())
    srv.reset_state()
    mcp._mcp_servers.clear()
    yield
    srv.reset_state()
    mcp._mcp_servers.clear()


# ── Transport selection ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "cfg, expected",
    [
        ({"command": "npx"}, (MCPTransport.STDIO, False)),
        ({"url": "https://h/mcp"}, (MCPTransport.STREAMABLE_HTTP, False)),
        ({"url": "https://h/stream"}, (MCPTransport.STREAMABLE_HTTP, False)),
        ({"url": "https://h/sse/"}, (MCPTransport.SSE, False)),
        ({"url": "https://h/events", "transport": "sse"}, (MCPTransport.SSE, True)),
        ({"url": "https://h/sse", "type": "streamable-http"}, (MCPTransport.STREAMABLE_HTTP, True)),
        ({"url": "https://h/x", "transport": "http"}, (MCPTransport.STREAMABLE_HTTP, True)),
    ],
)
def test_select_transport(cfg, expected):
    assert select_transport(cfg) == expected


@pytest.mark.parametrize(
    "cfg, message",
    [
        ({"url": "https://h", "transport": "ws"}, "Unknown MCP transport"),
        ({"url": "https://h", "transport": "stdio"}, "needs a 'command'"),
        ({"command": "npx", "transport": "sse"}, "needs a 'url'"),
        ({}, "needs a 'url' or a 'command'"),
    ],
)
def test_select_transport_errors(cfg, message):
    with pytest.raises(ValueError, match=message):
        select_transport(cfg)


@pytest.mark.asyncio
async def test_explicit_sse_url_goes_to_sse_client():
    """A URL without 'sse' in it reaches the SSE client when asked for."""
    with patch.object(mcp, "SSEMCPClient") as sse_cls, patch.object(mcp, "HTTPMCPClient") as http_cls:
        sse_cls.return_value = AsyncMock(**{"connect.return_value": True, "list_tools.return_value": []})
        server = await mcp.MCPClientManager().connect_server(
            {"name": "e", "url": "https://host/events", "transport": "sse", "headers": {"A": "b"}}
        )
    http_cls.assert_not_called()
    sse_cls.assert_called_once_with(url="https://host/events", headers={"A": "b"})
    assert server.transport is MCPTransport.SSE and server.status is MCPStatus.CONNECTED


@pytest.mark.asyncio
async def test_bad_transport_error_does_not_echo_the_config():
    with pytest.raises(ValueError) as exc:
        await mcp.MCPClientManager().connect_server(
            {"name": "e", "url": "https://h", "transport": "ws", "headers": {"Authorization": "SECRET99"}}
        )
    assert "SECRET99" not in str(exc.value)


# ── Log redaction ────────────────────────────────────────────────────


def test_log_filter_redacts_bearer_tokens_known_secrets_and_tracebacks():
    flt = http_guard.SecretRedactionFilter()
    http_guard.register_secret("Bearer s3cret-value")
    try:
        raise RuntimeError("server said no to s3cret-value")
    except RuntimeError:
        record = logging.LogRecord(
            "x", logging.ERROR, __file__, 1, "auth %s", ("Authorization: Bearer abc.def-123",), sys.exc_info()
        )
    flt.filter(record)
    http_guard.register_secret("abc")  # too short to register: would blank ordinary words
    assert http_guard.redact_secrets("abc def") == "abc def"
    assert record.getMessage() == "auth Authorization: Bearer [redacted]"
    assert "s3cret-value" not in record.exc_text
    assert "[redacted]" in record.exc_text


# ── Masking ──────────────────────────────────────────────────────────


def test_public_view_masks_every_secret():
    http_guard.register_secret("fs_token_987654")
    remote = MCPServer(
        name="remote",
        transport=MCPTransport.STREAMABLE_HTTP,
        status=MCPStatus.ERROR,
        last_error="401 for https://h/mcp?api_key=qs_secret_1",
        connection_data={
            "name": "remote",
            "url": "https://user:pw_secret_1@h.example.com/mcp?api_key=qs_secret_1",
            "headers": {"Authorization": "Bearer hdr_secret_1"},
        },
    )
    local = MCPServer(
        name="fs",
        transport=MCPTransport.STDIO,
        connection_data={"command": "npx", "args": ["--token=fs_token_987654"], "env": {"KEY": "envsecret1"}},
    )
    views = [mcp_servers.public_view(remote), mcp_servers.public_view(local)]
    text = repr(views)
    for secret in ("pw_secret_1", "qs_secret_1", "hdr_secret_1", "fs_token_987654", "envsecret1"):
        assert secret not in text
    assert views[0]["connection_data"] == {
        "url": "https://h.example.com/mcp?api_key=***",
        "headers": {"Authorization": "***"},
    }
    assert views[1]["connection_data"] == {
        "command": "npx",
        "args": ["--token=[redacted]"],
        "env": {"KEY": "***"},
    }


def _connected(cfg, session_context=None):
    transport, _ = select_transport(cfg)
    server = MCPServer(cfg["name"], transport, MCPStatus.CONNECTED, connection_data=cfg)
    mcp._mcp_servers[cfg["name"]] = server
    return server


def test_routes_never_send_secrets():
    c = TestClient(create_app(), raise_server_exceptions=False)
    with patch.object(mcp, "connect_mcp_server", AsyncMock(side_effect=_connected)):
        r = c.post(
            "/api/mcp/connect",
            json={"name": "gh", "url": "https://api.example.com/mcp?key=qs_secret_2", "headers": {"Authorization": "Bearer hdr_secret_2"}},
        )
    assert r.status_code == 200
    assert r.json()["server"]["transport"] == "streamable-http"
    listing = c.get("/api/mcp/servers")
    for response in (r, listing):
        assert "hdr_secret_2" not in response.text and "qs_secret_2" not in response.text
    assert listing.json()["servers"][0]["connection_data"]["headers"] == {"Authorization": "***"}
    # the header value is now redacted from log lines too
    assert http_guard.redact_secrets("got hdr_secret_2") == "got [redacted]"


def test_connect_rejects_unknown_transport():
    c = TestClient(create_app(), raise_server_exceptions=False)
    r = c.post("/api/mcp/connect", json={"name": "x", "url": "https://h/mcp", "transport": "ws"})
    assert r.status_code == 400 and "Unknown MCP transport" in r.json()["error"]


# ── Auth on every MCP route, in every auth mode ──────────────────────

ROUTES = [("get", "/api/mcp/servers"), ("post", "/api/mcp/connect"), ("post", "/api/mcp/disconnect/x")]


def _assert_gated(client: TestClient):
    for method, path in ROUTES:
        assert getattr(client, method)(path).status_code == 401, (method, path)


def test_auth_enforce_gates_mcp_routes(monkeypatch):
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    _assert_gated(TestClient(create_app(), raise_server_exceptions=False))


def test_token_mode_gates_mcp_routes(monkeypatch):
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("AIUI_URL_TOKEN", "s3cret-token")
    c = TestClient(create_app(), raise_server_exceptions=False)
    _assert_gated(c)
    assert c.get("/api/mcp/servers", headers={"Authorization": "Bearer s3cret-token"}).status_code == 200


def test_require_auth_gates_mcp_routes():
    _assert_gated(TestClient(create_app(require_auth=True), raise_server_exceptions=False))


def test_handlers_still_importable_from_server():
    from praisonaiui.server import _mcp_stdio_connect_allowed, api_mcp_connect, api_mcp_servers

    assert api_mcp_connect is mcp_servers.api_mcp_connect
    assert api_mcp_servers is mcp_servers.api_mcp_servers
    assert _mcp_stdio_connect_allowed is mcp_servers._mcp_stdio_connect_allowed
