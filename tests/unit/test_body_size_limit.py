"""Request bodies have a size cap (``http_guard.BodySizeLimitMiddleware``).

Paths that need no credentials (login, sign-up, protocol negotiation) take at
most 64 KiB, so an anonymous client cannot make the server buffer a large
body. Every other route takes at most ``AIUI_MAX_BODY_MB`` (default 25 MiB).
A declared ``Content-Length`` over the cap is refused without reading; a
chunked body is counted as it streams. Uploads over the attachment limit are
refused before the file is read into memory.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.http_guard import (
    PUBLIC_MAX_BODY_BYTES,
    BodySizeLimitMiddleware,
    configured_max_body_bytes,
)

MODES = ["open", "auth_enforce", "require_auth", "url_token"]


@pytest.fixture
def make_client(monkeypatch, tmp_path):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))

    def _make(mode: str = "open") -> TestClient:
        srv.reset_state()
        require_auth = False
        if mode == "auth_enforce":
            monkeypatch.setenv("AUTH_ENFORCE", "true")
        elif mode == "require_auth":
            require_auth = True
        elif mode == "url_token":
            monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
            monkeypatch.setenv("AIUI_URL_TOKEN", "s3cret")
        app = srv.create_app(require_auth=require_auth)
        return TestClient(app, raise_server_exceptions=False)

    yield _make
    srv.reset_state()


def _chunks(total: int, size: int = 64 * 1024):
    sent = 0
    while sent < total:
        n = min(size, total - sent)
        sent += n
        yield b" " * n


@pytest.mark.parametrize("mode", MODES)
def test_public_login_refuses_a_large_body(make_client, mode):
    client = make_client(mode)
    big = b'{"password": "' + b"x" * (2 * 1024 * 1024) + b'"}'
    r = client.post("/api/auth/login", content=big, headers={"content-type": "application/json"})
    assert r.status_code == 413


@pytest.mark.parametrize("mode", ["open", "auth_enforce"])
def test_public_login_refuses_a_large_chunked_body(make_client, mode):
    client = make_client(mode)
    r = client.post(
        "/api/auth/login",
        content=_chunks(2 * 1024 * 1024),
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 413


@pytest.mark.parametrize("mode", ["open", "auth_enforce"])
def test_public_login_still_takes_a_normal_body(make_client, mode):
    r = make_client(mode).post("/api/auth/login", json={"password": "x"})
    assert r.status_code != 413 and r.status_code < 500


def test_login_with_malformed_json_is_a_400_not_a_500(make_client):
    r = make_client("open").post(
        "/api/auth/login", content=b"{not json", headers={"content-type": "application/json"}
    )
    assert r.status_code == 400


def test_authenticated_routes_use_the_configured_cap(make_client, monkeypatch):
    monkeypatch.setenv("AIUI_MAX_BODY_MB", "1")
    client = make_client("open")
    r = client.post(
        "/api/chat/attachments",
        files={"file": ("a.txt", b"x" * (2 * 1024 * 1024), "text/plain")},
    )
    assert r.status_code == 413


def test_attachment_over_its_limit_is_refused_before_it_is_read(make_client):
    client = make_client("open")
    with patch("starlette.datastructures.UploadFile.read") as read:
        r = client.post(
            "/api/chat/attachments",
            files={"file": ("a.txt", b"x" * (11 * 1024 * 1024), "text/plain")},
        )
    assert r.status_code == 413
    read.assert_not_called()


def test_small_attachment_still_uploads(make_client):
    r = make_client("open").post(
        "/api/chat/attachments", files={"file": ("a.txt", b"hello", "text/plain")}
    )
    assert r.status_code == 200, r.text


# ── the middleware on its own ────────────────────────────────────────


async def _echo(request: Request) -> JSONResponse:
    return JSONResponse({"n": len(await request.body())})


async def _swallow(request: Request) -> JSONResponse:
    try:
        await request.body()
    except Exception:
        return JSONResponse({"error": "handler caught it"}, status_code=500)
    return JSONResponse({"ok": True})


def _app(**kw) -> TestClient:
    app = Starlette(routes=[Route("/echo", _echo, methods=["POST"]), Route("/swallow", _swallow, methods=["POST"])])
    return TestClient(BodySizeLimitMiddleware(app, **kw), raise_server_exceptions=False)


def test_middleware_passes_bodies_up_to_the_cap():
    client = _app(max_bytes=1000)
    assert client.post("/echo", content=b"x" * 1000).json() == {"n": 1000}
    assert client.post("/echo", content=b"x" * 1001).status_code == 413
    assert client.post("/echo", content=_chunks(1001, 100)).status_code == 413


def test_middleware_answers_413_even_when_the_handler_catches_the_error():
    r = _app(max_bytes=1000).post("/swallow", content=_chunks(5000, 100))
    assert r.status_code == 413


def test_zero_turns_the_general_cap_off_but_not_the_public_one():
    client = _app(max_bytes=0)
    assert client.post("/echo", content=b"x" * 100_000).status_code == 200
    assert client.post("/login", content=b"x" * (PUBLIC_MAX_BODY_BYTES + 1)).status_code == 413


def test_configured_max_body_bytes():
    assert configured_max_body_bytes({}) == 25 * 1024 * 1024
    assert configured_max_body_bytes({"AIUI_MAX_BODY_MB": "2"}) == 2 * 1024 * 1024
    assert configured_max_body_bytes({"AIUI_MAX_BODY_MB": "0"}) == 0
    assert configured_max_body_bytes({"AIUI_MAX_BODY_MB": "junk"}) == 25 * 1024 * 1024


def test_websockets_pass_through():
    calls = []

    async def app(scope, receive, send):
        calls.append(scope["type"])

    import asyncio

    asyncio.run(BodySizeLimitMiddleware(app, max_bytes=1)({"type": "websocket", "path": "/ws"}, None, None))
    assert calls == ["websocket"]
