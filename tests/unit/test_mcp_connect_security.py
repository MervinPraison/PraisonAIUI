"""The mcp: config: declared servers, enabled, and what users may add (allow.urls, allow.commands).

A loopback client is no longer trusted to start any command: behind a local
reverse proxy every visitor looks like 127.0.0.1. No real server, DNS or network.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui import http_guard
from praisonaiui.features import mcp, mcp_servers
from praisonaiui.features.mcp import MCPServer, MCPStatus
from praisonaiui.schema.models import Config, McpConfig
from praisonaiui.server import create_app

Refused = mcp_servers.Refused


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.delenv("PRAISONAIUI_ALLOW_REMOTE_MCP_STDIO", raising=False)
    monkeypatch.setattr(http_guard, "_KNOWN_SECRETS", set())
    srv.reset_state()
    mcp._mcp_servers.clear()
    yield
    srv.reset_state()
    mcp_servers.configure(None)
    mcp._mcp_servers.clear()


def _client(mcp_config=None) -> TestClient:
    config = {"mcp": mcp_config} if mcp_config is not None else None
    return TestClient(create_app(config=config), raise_server_exceptions=False)


def _connected(cfg, session_context=None):
    server = MCPServer(cfg["name"], mcp.select_transport(cfg)[0], MCPStatus.CONNECTED, connection_data=cfg)
    mcp._mcp_servers[cfg["name"]] = server
    return server


@pytest.fixture
def connect():
    with patch.object(mcp, "connect_mcp_server", AsyncMock(side_effect=_connected)) as fake:
        yield fake


# ── Schema ───────────────────────────────────────────────────────────


def test_schema_forms_and_defaults():
    cfg = McpConfig.model_validate(
        {"servers": {"old": {"url": "https://h/events", "type": "sse"}, "h": {"url": "https://h/x", "transport": "http"}}}
    )
    assert cfg.enabled is True and cfg.allow.urls == [] and cfg.allow.commands == []
    assert (cfg.servers["old"].transport, cfg.servers["h"].transport) == ("sse", "streamable-http")
    assert list(McpConfig.model_validate({"servers": [{"name": "a", "command": "uvx"}]}).servers) == ["a"]
    assert Config.model_validate({"site": {"title": "t"}, "mcp": {"enabled": False}}).mcp.enabled is False


@pytest.mark.parametrize(
    "servers, message",
    [
        ([{"name": "a", "url": "https://h/1"}, {"name": "a", "url": "https://h/2"}], "duplicate MCP server name 'a'"),
        ({"s": {"url": "https://h", "command": "npx"}}, "exactly one of"),
        ({"s": {"url": "https://h", "transport": "stdio"}}, "needs a 'command'"),
        ({"s": {"command": "npx", "transport": "sse"}}, "needs a 'url'"),
        ({"s": {"url": "https://h", "token": "x"}}, "Extra inputs"),
    ],
)
def test_schema_rejects_bad_servers(servers, message):
    with pytest.raises(ValidationError, match=message):
        McpConfig.model_validate({"servers": servers})


def test_invalid_config_turns_mcp_off_without_logging_the_secret(caplog):
    settings = mcp_servers.configure({"servers": {"s": {"url": "https://h", "headers": {"A": "TOPSECRET1"}, "x": 1}}})
    assert settings.enabled is False
    assert "servers.s" in caplog.text and "TOPSECRET1" not in caplog.text


# ── allow.urls and allow.commands ────────────────────────────────────


@pytest.mark.parametrize(
    "url, patterns, allowed",
    [
        ("https://mcp.example.com/mcp", ["mcp.example.com"], True),
        ("http://mcp.example.com/mcp", ["mcp.example.com"], True),
        ("https://mcp.example.com:8443/mcp", ["mcp.example.com"], False),
        ("https://mcp.example.com:8443/mcp", ["https://mcp.example.com:8443"], True),
        ("https://a.example.com/x", ["*.example.com"], True),
        ("https://example.com/x", ["*.example.com"], False),
        ("https://evil.com/x.example.com/", ["*.example.com"], False),
        ("https://evil.com/?h=.example.com", ["https://*.example.com/*"], False),
        ("https://user:pw@evil.com/@x.example.com", ["*.example.com"], False),
        ("http://a.example.com/x", ["https://*.example.com"], False),
        ("https://h.com/mcp/v1", ["https://h.com/mcp/"], True),
        ("https://h.com/mcpevil", ["https://h.com/mcp"], False),
        ("https://anything.io/x", ["*"], True),
        ("ftp://anything.io/x", ["*"], False),
        ("https://h.com/x", [], False),
    ],
)
def test_match_url(url, patterns, allowed):
    assert (mcp_servers.match_url(url, patterns) is not None) is allowed


def _resolves_to(address):
    async def fake(host, port, *a, **k):
        return [(2, 1, 6, "", (address, 0))]

    return fake


@pytest.mark.asyncio
async def test_wildcard_never_reaches_a_private_address():
    mcp_servers.configure({"allow": {"urls": ["*"]}})
    loop = asyncio.get_running_loop()
    for private in ("10.0.0.5", "127.0.0.1", "169.254.169.254"):
        with patch.object(loop, "getaddrinfo", _resolves_to(private)), pytest.raises(Refused) as exc:
            await mcp_servers.user_server("x", {"url": "https://internal.corp/mcp"})
        assert exc.value.status == 403 and "not a public address" in exc.value.message
    with patch.object(loop, "getaddrinfo", _resolves_to("93.184.216.34")):
        assert (await mcp_servers.user_server("x", {"url": "https://public.example/mcp"}))["url"]
    mcp_servers.configure({"allow": {"urls": ["http://localhost:9000"]}})  # a named host may be private
    assert await mcp_servers.user_server("x", {"url": "http://localhost:9000/mcp"})


@pytest.mark.asyncio
async def test_commands_match_exactly_and_never_set_env(monkeypatch):
    with pytest.raises(Refused, match="mcp.allow.commands"):
        await mcp_servers.user_server("x", {"command": "npx"})  # default: none
    mcp_servers.configure({"allow": {"commands": ["npx"]}})
    assert await mcp_servers.user_server("x", {"command": "npx", "args": ["-y", "p"]}) == {
        "name": "x", "command": "npx", "args": ["-y", "p"]
    }
    for other in ("/tmp/npx", "./npx", "npx2"):
        with pytest.raises(Refused):
            await mcp_servers.user_server("x", {"command": other})
    with pytest.raises(Refused, match="env"):
        await mcp_servers.user_server("x", {"command": "npx", "env": {"NODE_OPTIONS": "--require=/x"}})
    monkeypatch.setenv("PRAISONAIUI_ALLOW_REMOTE_MCP_STDIO", "true")  # older switch: any command
    assert mcp_servers.command_allowed("uvx") is True


# ── Routes ───────────────────────────────────────────────────────────


def test_loopback_alone_cannot_start_a_command(connect):
    r = _client().post("/api/mcp/connect", json={"name": "x", "command": "bash", "args": ["-c", "id"]})
    assert r.status_code == 403 and "mcp.allow.commands" in r.json()["error"]
    connect.assert_not_awaited()


def test_url_needs_the_allowlist(connect):
    c = _client({"allow": {"urls": ["https://mcp.example.com"]}})
    refused = c.post("/api/mcp/connect", json={"name": "x", "url": "https://evil.example/mcp"})
    assert refused.status_code == 403 and "mcp.allow.urls" in refused.json()["error"]
    ok = c.post("/api/mcp/connect", json={"name": "x", "url": "https://mcp.example.com/mcp"})
    assert ok.status_code == 200 and ok.json()["server"]["source"] == "user"


def test_declared_server_reconnects_by_name_only(connect, monkeypatch):
    monkeypatch.setenv("GH_TOKEN", "ghp_declared_123")
    c = _client({"servers": {"gh": {"url": "https://api.example.com/mcp", "headers": {"Authorization": "Bearer ${GH_TOKEN}"}}}})
    r = c.post("/api/mcp/connect", json={"name": "gh"})
    assert r.status_code == 200 and r.json()["server"]["source"] == "config"
    assert connect.await_args.args[0]["headers"] == {"Authorization": "Bearer ghp_declared_123"}
    assert "ghp_declared_123" not in r.text and "ghp_declared_123" not in c.get("/api/mcp/servers").text
    assert http_guard.redact_secrets("x ghp_declared_123") == "x [redacted]"
    hijack = c.post("/api/mcp/connect", json={"name": "gh", "url": "https://evil.example/mcp"})
    assert hijack.status_code == 409


def test_disabled_refuses_connect(connect):
    c = _client({"enabled": False, "allow": {"commands": ["*"]}})
    r = c.post("/api/mcp/connect", json={"name": "x", "command": "npx"})
    assert r.status_code == 403 and "turned off" in r.json()["error"]
    assert c.get("/api/mcp/servers").json()["enabled"] is False
    connect.assert_not_awaited()


def test_data_dir_config_is_read(connect, monkeypatch, tmp_path):
    import praisonaiui.config_store as config_store

    (tmp_path / "config.yaml").write_text("mcp:\n  allow:\n    commands: [uvx]\n", encoding="utf-8")
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config_store, "_config_store", None)
    assert _client().post("/api/mcp/connect", json={"name": "x", "command": "uvx"}).status_code == 200


# ── Startup and shutdown ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_declared_servers_connect_at_startup_unless_disabled():
    mcp_servers.configure({"servers": {"a": {"url": "https://a/mcp"}, "b": {"command": "uvx"}}})
    with patch.object(mcp, "connect_mcp_server", AsyncMock()) as connect:
        mcp_servers._on_startup()
        await mcp_servers._startup_task
        assert sorted(c.args[0]["name"] for c in connect.await_args_list) == ["a", "b"]
        connect.reset_mock()
        mcp_servers.configure({"enabled": False, "servers": {"a": {"url": "https://a/mcp"}}})
        await mcp_servers.connect_declared()
        connect.assert_not_awaited()
    with patch.object(mcp, "disconnect_all_mcp_servers", AsyncMock()) as stop:
        await mcp_servers._on_shutdown()
    stop.assert_awaited_once()
