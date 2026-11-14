"""A WebSocket ticket must satisfy every stacked auth middleware.

Each gate (AUTH_ENFORCE, URL token, require_auth) spent the single-use
ticket itself, so with two gates the second found it gone and refused
every browser socket.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import praisonaiui.server as srv
from praisonaiui import auth, http_guard
from praisonaiui.server import create_app


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    prev = srv._style
    for var in ("AUTH_ENFORCE", "AIUI_URL_TOKEN", "GATEWAY_AUTH_TOKEN", "AIUI_REQUIRE_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(auth, "_users", {})
    monkeypatch.setattr(auth, "_tokens", {})
    yield
    srv._style = prev


def _opens(client: TestClient, url: str, **kw) -> bool:
    try:
        with client.websocket_connect(url, **kw) as ws:
            ws.send_json({"type": "ping"})
            ws.receive_json()
        return True
    except WebSocketDisconnect:
        return False


def test_require_auth_plus_url_token_ticket_opens_chat_ws(monkeypatch):
    monkeypatch.setenv("AIUI_URL_TOKEN", "s3cret")
    client = TestClient(create_app(require_auth=True), raise_server_exceptions=False)
    auth.register_user("alice", "alice-pass")
    session = auth.create_token("alice")
    cookie = {"Cookie": "praisonaiui_token=s3cret"}
    r = client.post(
        "/api/auth/ws-ticket", headers={**cookie, "Authorization": f"Bearer {session}"}
    )
    assert r.status_code == 200
    ticket = r.json()["ticket"]
    assert _opens(client, f"/api/chat/ws?ticket={ticket}", headers=cookie)
    # still single use
    assert not _opens(client, f"/api/chat/ws?ticket={ticket}", headers=cookie)


def test_ticket_result_is_shared_on_the_scope_not_reusable_across_handshakes():
    t = http_guard.issue_ws_ticket()
    scope = {"type": "websocket", "query_string": f"ticket={t}".encode(), "headers": []}
    assert http_guard.websocket_has_ticket(scope) is True
    assert http_guard.websocket_has_ticket(scope) is True  # second gate, same handshake
    other = {"type": "websocket", "query_string": f"ticket={t}".encode(), "headers": []}
    assert http_guard.websocket_has_ticket(other) is False  # spent
