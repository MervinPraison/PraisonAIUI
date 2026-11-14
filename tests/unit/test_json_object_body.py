"""A JSON body that is not an object gets 400, never a handler crash (500)."""

from __future__ import annotations

import asyncio
import re

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.http_guard import JSONObjectBodyMiddleware
from praisonaiui.server import create_app


@pytest.fixture(autouse=True)
def _reset_style():
    prev = srv._style
    yield
    srv._style = prev


JSON = {"Content-Type": "application/json"}


@pytest.mark.parametrize("path", ["/api/feedback", "/cancel", "/api/chat/send", "/api/memory"])
@pytest.mark.parametrize("body", [b"[1,2]", b'"text"', b"42", b"true"])
def test_named_endpoints_answer_400(path, body):
    c = TestClient(create_app(), raise_server_exceptions=False)
    r = c.post(path, content=body, headers=JSON)
    assert r.status_code == 400
    assert r.json()["error"] == "Request body must be a JSON object"


def test_no_write_route_crashes_on_an_array_body():
    from starlette.routing import Route as _Route

    app = create_app()
    c = TestClient(app, raise_server_exceptions=False)
    crashed = []
    checked = 0
    for r in app.routes:
        if not isinstance(r, _Route):
            continue
        for m in sorted(r.methods or ()):
            if m not in ("POST", "PUT", "PATCH"):
                continue
            checked += 1
            path = re.sub(r"\{[^}]+\}", "x", r.path)
            for ct in ("application/json", "text/plain"):
                resp = c.request(m, path, content=b"[1,2]", headers={"Content-Type": ct})
                if resp.status_code >= 500:
                    crashed.append((m, r.path, ct, resp.status_code))
    assert checked > 100
    assert crashed == []


async def _echo(request: Request) -> JSONResponse:
    body = await request.body()
    return JSONResponse({"len": len(body), "head": body[:20].decode("latin-1")})


def _echo_app() -> Starlette:
    return Starlette(
        routes=[
            Route("/echo", _echo, methods=["POST"]),
            Route("/api/plugins/x/echo", _echo, methods=["POST"]),
        ]
    )


def test_objects_null_empty_malformed_and_uploads_pass_through():
    c = TestClient(JSONObjectBodyMiddleware(_echo_app()))
    for body in (b'{"a": 1}', b"null", b"", b"{not json", b"[oops"):
        r = c.post("/echo", content=body, headers=JSON)
        assert r.status_code == 200, body
        assert r.json()["len"] == len(body)
    r = c.post("/echo", files={"f": ("a.json", b"[1,2]", "application/json")})
    assert r.status_code == 200
    r = c.post("/echo", content=b"[1,2]", headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 200


def test_plugin_routes_are_left_alone():
    c = TestClient(JSONObjectBodyMiddleware(_echo_app()))
    assert c.post("/api/plugins/x/echo", content=b"[1,2]", headers=JSON).status_code == 200


def test_large_body_is_streamed_through_whole():
    big = b'{"k": "' + b"x" * (5 * 1024 * 1024) + b'"}'
    c = TestClient(JSONObjectBodyMiddleware(_echo_app()))
    r = c.post("/echo", content=big, headers=JSON)
    assert r.status_code == 200 and r.json()["len"] == len(big)


def test_chunked_body_is_reassembled():
    received = {}

    async def app(scope, receive, send):
        body = b""
        while True:
            m = await receive()
            body += m.get("body", b"")
            if not m.get("more_body"):
                break
        received["body"] = body
        await JSONResponse({"ok": True})(scope, receive, send)

    msgs = [
        {"type": "http.request", "body": b'{"a":', "more_body": True},
        {"type": "http.request", "body": b" 1}", "more_body": False},
    ]

    async def receive():
        return msgs.pop(0)

    sent = []

    async def send(m):
        sent.append(m)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/x",
        "headers": [(b"content-type", b"application/json")],
    }
    asyncio.run(JSONObjectBodyMiddleware(app)(scope, receive, send))
    assert received["body"] == b'{"a": 1}'
    assert sent[0]["status"] == 200
