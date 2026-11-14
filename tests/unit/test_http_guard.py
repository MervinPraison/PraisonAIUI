"""Auth and cross-site guards (security review round 1).

* AUTH_ENFORCE gates every route except the public surface (deny by default).
* URL-token mode and require_auth gate WebSocket handshakes too.
* require_auth no longer excludes every path (prefix match on "/").
* Cross-site WebSockets and cross-site state-changing requests are refused.
* WebSocket tickets keep long-lived keys out of URLs; ?token= is redacted
  from the logs.
"""

from __future__ import annotations

import logging

import pytest
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import praisonaiui.server as srv
from praisonaiui import http_guard
from praisonaiui.server import create_app

EVIL = "http://evil.example"


@pytest.fixture(autouse=True)
def _reset_style():
    prev = srv._style
    yield
    srv._style = prev


@pytest.fixture
def api_key(monkeypatch):
    from praisonaiui.features import auth as feature_auth

    key = "pk_guard_test_key"
    monkeypatch.setitem(feature_auth._auth_config["api_keys"], key, {"name": "t"})
    return key


def _ws_rejected(client: TestClient, url: str, **kw) -> bool:
    try:
        with client.websocket_connect(url, **kw) as ws:
            ws.send_json({"type": "ping"})
            ws.receive_json()
    except WebSocketDisconnect as exc:
        assert exc.code == 1008
        return True
    return False


def _concrete(path: str) -> str:
    out = []
    for seg in path.split("/"):
        if seg.startswith("{") and seg.endswith("}"):
            out.append("p:x" if ":path" in seg else "x")
        else:
            out.append(seg)
    return "/".join(out).replace("p:x", "x/y")


def _http_routes(app):
    for route in app.routes:
        if isinstance(route, Route):
            for method in sorted(route.methods or ()):
                if method in ("HEAD", "OPTIONS"):
                    continue
                yield method, route.path


# ── AUTH_ENFORCE: deny by default ────────────────────────────────────

# Routes that answer without credentials on purpose.
_PUBLIC_ROUTES = {
    ("GET", "/health"),
    ("GET", "/api/health"),
    ("GET", "/health/live"),
    ("GET", "/health/ready"),
    ("GET", "/api/health/live"),
    ("GET", "/api/health/ready"),
    ("POST", "/login"),
    ("POST", "/api/auth/login"),
    ("GET", "/api/protocol"),
    ("POST", "/api/protocol/negotiate"),
    ("GET", "/api/protocol/negotiate"),
    ("GET", "/manifest.json"),
    ("GET", "/sw.js"),
    ("GET", "/custom.js"),
    ("GET", "/ui-config.json"),
    ("GET", "/docs-nav.json"),
    ("GET", "/route-manifest.json"),
    ("GET", "/plugins/plugins.json"),
    ("GET", "/_aiui/externals/{name}"),
    ("GET", "/dashboard-plugins/{name}/{path:path}"),
    ("GET", "/shared/{token}"),
    ("GET", "/"),
    ("GET", "/{path:path}"),
}


def test_auth_enforce_gates_every_non_public_route(monkeypatch, api_key):
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    app = create_app()
    client = TestClient(app, raise_server_exceptions=False)
    leaks = []
    checked = 0
    for method, path in _http_routes(app):
        if (method, path) in _PUBLIC_ROUTES:
            continue
        checked += 1
        r = client.request(method, _concrete(path), content=b"{}", headers={"Content-Type": "text/plain"})
        if r.status_code != 401:
            leaks.append((method, path, r.status_code))
    assert checked > 200
    assert leaks == []


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/sessions"),
        ("GET", "/sessions/priv-1"),
        ("DELETE", "/sessions/priv-1"),
        ("POST", "/run"),
        ("POST", "/cancel"),
        ("POST", "/agents/x/runs"),
        ("POST", "/teams/x/runs"),
        ("POST", "/v1/chat/completions"),
        ("GET", "/v1/models"),
        ("POST", "/agui"),
        ("POST", "/profiles/select"),
        ("POST", "/welcome"),
        ("GET", "/ws/realtime/x"),
        ("GET", "/me"),
        ("POST", "/register"),
    ],
)
def test_auth_enforce_gates_non_api_data_routes(monkeypatch, api_key, method, path):
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    client = TestClient(create_app(), raise_server_exceptions=False)
    r = client.request(method, path, content=b"{}", headers={"Content-Type": "text/plain"})
    assert r.status_code == 401, (method, path, r.status_code)


def test_auth_enforce_keeps_pages_and_static_public(monkeypatch, api_key):
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    client = TestClient(create_app(), raise_server_exceptions=False)
    assert client.get("/").status_code == 200
    assert client.get("/chat").status_code == 200  # SPA fallback
    assert client.get("/health").status_code == 200
    assert client.get("/plugins/plugins.json").status_code == 200
    # an authorized client reaches the data routes
    ok = client.get("/sessions", headers={"Authorization": f"Bearer {api_key}"})
    assert ok.status_code == 200 and "sessions" in ok.json()


def test_auth_enforce_app_page_navigation_public_but_data_gated(monkeypatch, api_key):
    """Under style app, /sessions and /agents are page URLs as well as JSON APIs."""
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    srv.set_style("app")
    client = TestClient(create_app(), raise_server_exceptions=False)
    nav = client.get("/sessions", headers={"Accept": "text/html,*/*"})
    assert nav.status_code == 200 and nav.headers["content-type"].startswith("text/html")
    assert client.get("/sessions").status_code == 401
    assert client.get("/agents", headers={"Accept": "application/json"}).status_code == 401
    # a navigation never gets data
    srv.set_style("dashboard")
    client = TestClient(create_app(), raise_server_exceptions=False)
    assert client.get("/sessions", headers={"Accept": "text/html"}).status_code == 401


def test_auth_enforce_websocket_ticket(monkeypatch, api_key):
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    client = TestClient(create_app())
    assert client.post("/api/auth/ws-ticket").status_code == 401
    r = client.post("/api/auth/ws-ticket", headers={"Authorization": f"Bearer {api_key}"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    ticket = r.json()["ticket"]
    assert not _ws_rejected(client, f"/api/chat/ws?ticket={ticket}")
    # single use
    assert _ws_rejected(client, f"/api/chat/ws?ticket={ticket}")
    assert _ws_rejected(client, "/api/chat/ws?ticket=forged")


def test_ws_ticket_expires(monkeypatch):
    t = http_guard.issue_ws_ticket(ttl=-1)
    assert http_guard.consume_ws_ticket(t) is False
    t = http_guard.issue_ws_ticket()
    assert http_guard.consume_ws_ticket(t) is True
    assert http_guard.consume_ws_ticket(t) is False


# ── URL-token mode ───────────────────────────────────────────────────


@pytest.fixture
def token_client(monkeypatch):
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("AIUI_URL_TOKEN", "s3cret")
    return TestClient(create_app())


@pytest.mark.parametrize("path", ["/api/chat/ws", "/api/logs/stream", "/ws/audio"])
def test_token_mode_gates_websockets(token_client, path):
    assert _ws_rejected(token_client, path)
    assert _ws_rejected(token_client, path, headers={"Origin": EVIL})
    assert _ws_rejected(token_client, f"{path}?token=wrong")


def test_token_mode_websocket_credentials(token_client):
    assert not _ws_rejected(token_client, "/api/chat/ws", headers={"Cookie": "praisonaiui_token=s3cret"})
    assert not _ws_rejected(token_client, "/api/chat/ws", headers={"Authorization": "Bearer s3cret"})
    assert not _ws_rejected(token_client, "/api/chat/ws?token=s3cret")
    ticket = token_client.post("/api/auth/ws-ticket", headers={"Authorization": "Bearer s3cret"}).json()["ticket"]
    assert not _ws_rejected(token_client, f"/api/chat/ws?ticket={ticket}")
    assert token_client.get("/api/sessions").status_code == 401


def test_token_mode_spy_socket_gets_no_events(token_client):
    """A token-less socket must not be able to listen to another client's turn."""
    with pytest.raises(WebSocketDisconnect):
        with token_client.websocket_connect("/api/chat/ws") as spy:
            spy.send_json({"type": "ping"})
            spy.receive_json()  # an accepted spy would get its pong here


# ── require_auth ─────────────────────────────────────────────────────


@pytest.fixture
def require_auth_client():
    return TestClient(create_app(require_auth=True), raise_server_exceptions=False)


def test_require_auth_gates_api(require_auth_client):
    c = require_auth_client
    assert c.get("/api/sessions").status_code == 401
    assert c.get("/api/config").status_code == 401
    assert c.get("/api/shell/manifest").status_code == 401
    assert c.get("/sessions").status_code == 401
    assert c.post("/run", json={"message": "x"}).status_code == 401
    # the page and the login endpoint stay reachable
    assert c.get("/").status_code == 200
    assert c.get("/health").status_code == 200
    assert c.post("/login", json={}).status_code == 400


def test_require_auth_gates_websockets(require_auth_client):
    assert _ws_rejected(require_auth_client, "/api/chat/ws")
    assert _ws_rejected(require_auth_client, "/api/logs/stream")


def test_require_auth_accepts_session_token(require_auth_client):
    from praisonaiui.auth import create_token, register_user

    user = register_user("guard-user", "pw-guard-1")
    token = create_token(user["id"])
    c = require_auth_client
    assert c.get("/api/sessions", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert not _ws_rejected(c, f"/api/chat/ws?token={token}")


def test_require_auth_yaml(monkeypatch):
    c = TestClient(create_app(config={"auth": {"requireAuth": True}}), raise_server_exceptions=False)
    assert c.get("/api/sessions").status_code == 401


# ── Cross-site guard ─────────────────────────────────────────────────


@pytest.fixture
def open_client():
    return TestClient(create_app(), raise_server_exceptions=False)


def test_cross_site_websocket_refused(open_client):
    assert _ws_rejected(open_client, "/api/chat/ws", headers={"Origin": EVIL})
    assert _ws_rejected(open_client, "/api/logs/stream", headers={"Origin": EVIL})
    assert _ws_rejected(open_client, "/api/chat/ws", headers={"Origin": "null"})
    # same origin, no origin (non-browser), loopback dev server
    assert not _ws_rejected(open_client, "/api/chat/ws", headers={"Origin": "http://testserver"})
    assert not _ws_rejected(open_client, "/api/chat/ws")


def test_cross_site_text_plain_post_refused(open_client):
    for path in ("/api/chat/abort", "/api/theme/register", "/run"):
        r = open_client.post(
            path, content=b'{"run_id":"x"}', headers={"Content-Type": "text/plain", "Origin": EVIL}
        )
        assert r.status_code == 403, path
    r = open_client.put("/api/theme", content=b"{}", headers={"Origin": EVIL})
    assert r.status_code == 403
    r = open_client.post(
        "/api/chat/abort",
        content=b'{"run_id":"x"}',
        headers={"Origin": EVIL, "Sec-Fetch-Site": "cross-site"},
    )
    assert r.status_code == 403
    # reads stay possible but carry no CORS grant
    r = open_client.get("/api/sessions", headers={"Origin": EVIL})
    assert "access-control-allow-origin" not in r.headers


def test_same_origin_requests_pass(open_client):
    ok = open_client.post("/api/chat/abort", json={"run_id": "x"}, headers={"Origin": "http://testserver"})
    assert ok.status_code == 200
    ok = open_client.post("/api/chat/abort", json={"run_id": "x"})  # no Origin: curl / SDK
    assert ok.status_code == 200
    # behind a proxy that rewrites Host, the browser's Sec-Fetch-Site decides
    ok = open_client.post(
        "/api/chat/abort",
        json={"run_id": "x"},
        headers={"Origin": "https://app.example.com", "Sec-Fetch-Site": "same-origin"},
    )
    assert ok.status_code == 200
    ok = open_client.post(
        "/api/chat/abort",
        json={"run_id": "x"},
        headers={"Origin": "https://app.example.com", "X-Forwarded-Host": "app.example.com", "X-Forwarded-Proto": "https"},
    )
    assert ok.status_code == 200


def test_allowed_origins_env(monkeypatch):
    monkeypatch.setenv("AIUI_ALLOWED_ORIGINS", "https://partner.example, http://evil.example")
    c = TestClient(create_app(), raise_server_exceptions=False)
    r = c.post("/api/chat/abort", json={"run_id": "x"}, headers={"Origin": EVIL})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == EVIL
    assert not _ws_rejected(c, "/api/chat/ws", headers={"Origin": EVIL})


@pytest.mark.parametrize(
    "origin,host,allowed",
    [
        ("http://localhost:5173", "localhost:8000", True),  # vite dev proxy
        ("http://127.0.0.1:5173", "localhost:8000", True),
        ("http://localhost:5173", "192.168.1.5:8000", False),
        ("http://evil.example", "localhost:8000", False),
        ("https://a.example", "a.example", True),
        ("https://a.example", "a.example:443", True),
        ("http://a.example:8080", "a.example", False),
    ],
)
def test_origin_allowed_matrix(origin, host, allowed):
    scope = {
        "type": "http",
        "scheme": "https" if origin.startswith("https") else "http",
        "headers": [(b"origin", origin.encode()), (b"host", host.encode())],
    }
    assert http_guard.origin_allowed(scope) is allowed


# ── Log redaction ────────────────────────────────────────────────────


def test_token_redacted_from_uvicorn_logs(caplog):
    create_app()
    caplog.set_level(logging.INFO)
    logging.getLogger("uvicorn.error").info(
        '%s - "WebSocket %s" [accepted]', "127.0.0.1:1", "/api/chat/ws?token=pk_goodkey"
    )
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d', "127.0.0.1:1", "GET", "/x?a=1&ticket=abc&token=pk_goodkey", "1.1", 200
    )
    text = caplog.text
    assert "pk_goodkey" not in text and "abc" not in text
    assert "token=[redacted]" in text and "ticket=[redacted]" in text


def test_ws_route_walk_rejects_everything_without_credentials(monkeypatch, api_key):
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    app = create_app()
    client = TestClient(app)
    paths = []
    for route in app.routes:
        if isinstance(route, WebSocketRoute):
            paths.append(_concrete(route.path))
        elif isinstance(route, Mount):
            continue
    assert "/api/chat/ws" in paths
    for path in paths:
        assert _ws_rejected(client, path), path
