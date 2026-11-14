"""DNS rebinding: a loopback server must refuse a Host it does not know.

After a rebind the attacker's page looks same-origin (Origin == Host), so
only the Host header gives it away.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui import http_guard
from praisonaiui.server import create_app

LOCAL = "http://127.0.0.1:8120"
EVIL_HOST = "rebind.attacker.example:8120"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    prev = srv._style
    for var in ("AIUI_ALLOWED_HOSTS", "AUTH_ENFORCE", "AIUI_URL_TOKEN", "GATEWAY_AUTH_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    yield
    srv._style = prev


def _client(base_url: str = LOCAL) -> TestClient:
    return TestClient(create_app(), base_url=base_url, raise_server_exceptions=False)


def test_rebound_host_refused_on_http():
    c = _client()
    r = c.get(
        "/api/sessions",
        headers={"Host": EVIL_HOST, "Origin": f"http://{EVIL_HOST}"},
    )
    assert r.status_code == 400
    r = c.post(
        "/run",
        content=b'{"message":"hi"}',
        headers={
            "Host": EVIL_HOST,
            "Origin": f"http://{EVIL_HOST}",
            "Content-Type": "text/plain",
        },
    )
    assert r.status_code == 400


def test_rebound_host_refused_on_websocket():
    # TestClient fills a websocket scope's "server" with ("testserver", 80),
    # so drive the middleware with a real-looking scope instead.
    import asyncio

    reached = []

    async def inner(scope, receive, send):
        reached.append(scope["path"])

    sent = []

    async def receive():
        return {"type": "websocket.connect"}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "websocket",
        "path": "/api/chat/ws",
        "server": ("127.0.0.1", 8120),
        "headers": [(b"host", EVIL_HOST.encode()), (b"origin", f"http://{EVIL_HOST}".encode())],
        "query_string": b"",
    }
    asyncio.run(http_guard.HostGuardMiddleware(inner, allowed_hosts=[])(scope, receive, send))
    assert reached == []
    assert sent and sent[0]["type"] == "websocket.close" and sent[0]["code"] == 1008

    scope["headers"] = [(b"host", b"127.0.0.1:8120")]
    sent.clear()
    asyncio.run(http_guard.HostGuardMiddleware(inner, allowed_hosts=[])(scope, receive, send))
    assert reached == ["/api/chat/ws"]


def test_create_app_installs_host_guard_outermost():
    app = create_app()
    assert app.user_middleware[0].cls is http_guard.HostGuardMiddleware


@pytest.mark.parametrize(
    "host",
    ["127.0.0.1:8120", "localhost:8120", "[::1]:8120", "app.localhost", "mybox.local", "10.0.0.5:8120"],
)
def test_local_names_allowed(host):
    assert _client().get("/api/sessions", headers={"Host": host}).status_code == 200


def test_allowed_hosts_env(monkeypatch):
    monkeypatch.setenv("AIUI_ALLOWED_HOSTS", "aiui.example.com, .corp.example")
    c = _client()
    assert c.get("/api/sessions", headers={"Host": "aiui.example.com"}).status_code == 200
    assert c.get("/api/sessions", headers={"Host": "a.corp.example:443"}).status_code == 200
    assert c.get("/api/sessions", headers={"Host": "corp.example"}).status_code == 200
    assert c.get("/api/sessions", headers={"Host": "evil.example"}).status_code == 400


def test_star_disables_check(monkeypatch):
    monkeypatch.setenv("AIUI_ALLOWED_HOSTS", "*")
    assert _client().get("/api/sessions", headers={"Host": EVIL_HOST}).status_code == 200


def test_public_address_not_checked():
    scope = {"type": "http", "server": ("8.8.8.8", 443), "headers": [(b"host", b"aiui.example.com")]}
    assert http_guard.host_allowed(scope)


@pytest.mark.parametrize("server", [("127.0.0.1", 80), ("192.168.1.4", 80), ("::1", 80), ("0.0.0.0", 80)])
def test_private_addresses_checked(server):
    scope = {"type": "http", "server": server, "headers": [(b"host", b"evil.example")]}
    assert not http_guard.host_allowed(scope)


def test_missing_host_allowed():
    scope = {"type": "http", "server": ("127.0.0.1", 80), "headers": []}
    assert http_guard.host_allowed(scope)
