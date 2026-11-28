"""Tests for praisonaiui.shell_app: shell-only app mounting and CSP inline-script hashes."""

from __future__ import annotations

import base64
import hashlib
import re
import subprocess
import sys
from pathlib import Path

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocket, WebSocketDisconnect

import praisonaiui as aiui
from praisonaiui import server as srv
from praisonaiui.plugin_registry import PageSpec, get_plugin_registry
from praisonaiui.shell_app import (
    STRICT_SHELL_CSP,
    create_shell_app,
    render_shell_html,
    shell_csp_header,
    shell_inline_script_hashes,
)


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Isolate server & plugin registry state per test."""
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("AUTH_ENFORCE", raising=False)
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    monkeypatch.delenv("AIUI_URL_TOKEN", raising=False)
    monkeypatch.delenv("GATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("AIUI_SHELL", raising=False)

    orig_pages = dict(srv._pages)
    orig_custom_ids = set(srv._custom_page_ids)
    orig_builtin_ids = set(srv._builtin_page_ids)
    orig_callbacks = dict(srv._callbacks)
    orig_actions = dict(srv._page_actions)
    orig_enabled = srv._enabled_pages
    orig_style = srv._style
    orig_eff = srv._effective_style
    orig_auth_req = srv._auth_required_by_app

    srv._pages.clear()
    srv._custom_page_ids.clear()
    srv._builtin_page_ids.clear()
    srv._callbacks.clear()
    srv._page_actions.clear()
    srv._enabled_pages = None
    srv._style = None

    reg = get_plugin_registry()
    orig_manual = list(reg._manual)
    reg._manual.clear()
    reg.apply_config(None)

    yield

    srv._pages.clear()
    srv._pages.update(orig_pages)
    srv._custom_page_ids.clear()
    srv._custom_page_ids.update(orig_custom_ids)
    srv._builtin_page_ids.clear()
    srv._builtin_page_ids.update(orig_builtin_ids)
    srv._callbacks.clear()
    srv._callbacks.update(orig_callbacks)
    srv._page_actions.clear()
    srv._page_actions.update(orig_actions)
    srv._enabled_pages = orig_enabled
    srv._style = orig_style
    srv._effective_style = orig_eff
    srv._auth_required_by_app = orig_auth_req
    reg._manual.clear()
    reg._manual.extend(orig_manual)
    reg.apply_config(None)


class _DemoPlugin:
    name = "ceo_demo"

    def __init__(self, static_root: Path):
        self._static = static_root

    def static_dir(self) -> Path:
        return self._static

    def pages(self):
        return [
            PageSpec(
                id="focus",
                title="Focus",
                kind="react",
                module="focus.js",
                group="Operating",
                order=10,
            ),
            PageSpec(
                id="revenue",
                title="Revenue & sponsors",
                kind="react",
                module="focus.js",
                group="Operating",
                order=20,
            ),
        ]


def _make_plugin(tmp_path: Path) -> _DemoPlugin:
    static = tmp_path / "static"
    static.mkdir(parents=True, exist_ok=True)
    (static / "focus.js").write_text(
        "import { createElement as h } from 'react';\n"
        "export default function Focus({ page }) { return h('h1', null, page.title); }\n",
        encoding="utf-8",
    )
    return _DemoPlugin(static)


# ── CSP inline script hashing ────────────────────────────────────────


def test_shell_inline_script_hashes_matches_executable_scripts_only():
    html = (
        '<html><head>'
        '<script id="a">console.log(1);</script>'
        '<script type="importmap">{"imports":{"react":"/_aiui/externals/react.js"}}</script>'
        '<script id="aiui-boot" type="application/json">{"sdk":1}</script>'
        '<script type="module" src="/assets/index.js"></script>'
        '</head></html>'
    )
    hashes = shell_inline_script_hashes(html)
    expected = tuple(
        sorted(
            f"'sha256-{base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()}'"
            for s in ("console.log(1);", '{"imports":{"react":"/_aiui/externals/react.js"}}')
        )
    )
    assert hashes == expected


def test_shell_csp_header_builds_strict_policy_with_hashes_and_extra():
    html = '<script>window.__X=1;</script><script type="application/json">{"a":1}</script>'
    header = shell_csp_header(html, extra={"img-src": ["https://cdn.example.com"]})
    h = shell_inline_script_hashes(html)[0]
    assert f"script-src 'self' {h}" in header
    assert "'unsafe-inline'" not in header.split("script-src")[1].split(";")[0]
    assert "frame-ancestors 'none'" in header
    assert "base-uri 'none'" in header
    assert "https://cdn.example.com" in header
    assert STRICT_SHELL_CSP["object-src"] == ["'none'"]


def test_render_shell_html_returns_html_and_hashes():
    html, hashes = render_shell_html()
    assert 'data-aiui-shell="react"' in html
    assert len(hashes) >= 3  # theme bootstrap, canonical url, importmap, __AIUI_BUILD__
    assert all(h.startswith("'sha256-") and h.endswith("'") for h in hashes)


# ── create_shell_app acceptance checks ───────────────────────────────


def test_create_shell_app_serves_plugin_under_strict_csp_and_returns_404_for_sessions(
    tmp_path: Path,
):
    plugin = _make_plugin(tmp_path)

    async def api_operations(_request: Request) -> JSONResponse:
        return JSONResponse({"ok": True, "revenue": 12500})

    app = create_shell_app(
        plugins=[plugin],
        routes=[Route("/api/operations", api_operations, methods=["GET"])],
        csp="strict",
    )
    client = TestClient(app)

    # Plugin page serves React shell HTML with strict CSP script hashes matching rendered HTML.
    res = client.get("/focus")
    assert res.status_code == 200
    assert 'data-aiui-shell="react"' in res.text
    csp = res.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    script_src = next(d for d in csp.split("; ") if d.startswith("script-src "))
    assert "'unsafe-inline'" not in script_src
    for h in shell_inline_script_hashes(res.text):
        assert h in script_src

    # Verify every executable inline <script> in the HTML is authorised by a hash in script-src.
    script_tags = re.findall(r"<script\b([^>]*)>(.*?)</script>", res.text, re.I | re.S)
    for attrs, body in script_tags:
        if "src=" in attrs or 'type="application/json"' in attrs:
            continue
        digest = base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()
        assert f"'sha256-{digest}'" in script_src

    # Root, plugin static asset, externals shim, manifest, and custom host route all work.
    assert client.get("/").status_code == 200
    assert client.get("/revenue").status_code == 200
    assert client.get("/_plugins/ceo_demo/focus.js").status_code == 200
    sdk_slug = srv._SHELL_EXTERNALS["@aiui/sdk"]
    ext = client.get(f"/_aiui/externals/{sdk_slug}.js")
    assert ext.status_code == 200
    assert "pageLinkProps" in ext.text and "useLiveData" in ext.text
    manifest = client.get("/api/shell/manifest").json()
    page_ids = [p["id"] for p in manifest["pages"]]
    assert "focus" in page_ids and "revenue" in page_ids
    assert "chat" not in page_ids and "sessions" not in page_ids
    assert client.get("/api/operations").json() == {"ok": True, "revenue": 12500}
    assert client.get("/ui-config.json").json()["style"] == "app"
    assert client.get("/health").status_code == 200

    # Agent server endpoints and unknown paths return 404 (never mounted).
    for method, path in [
        ("GET", "/sessions"),
        ("POST", "/sessions"),
        ("POST", "/run"),
        ("GET", "/agents"),
        ("GET", "/teams"),
        ("POST", "/api/chat/send"),
        ("GET", "/api/usage"),
        ("GET", "/unknown-page"),
        ("GET", "/focus/nested/unknown"),
    ]:
        resp = client.request(method, path)
        assert resp.status_code == 404, f"Expected 404 for {method} {path}, got {resp.status_code}"


def test_create_shell_app_supports_python_block_pages_and_csp_callable(tmp_path: Path):
    @aiui.page("metrics", title="Metrics", group="Ops")
    async def metrics_page():
        return aiui.layout([aiui.metric("ARR", value="$120k")])

    app = create_shell_app(
        csp=lambda _html, hashes: "default-src 'self'; script-src 'self' " + " ".join(hashes),
    )
    client = TestClient(app)

    res = client.get("/metrics")
    assert res.status_code == 200
    assert res.headers["content-security-policy"].startswith("default-src 'self'; script-src 'self' 'sha256-")
    data = client.get("/api/pages/metrics/data")
    assert data.status_code == 200
    assert data.json()["_components"][0]["type"] == "metric"
    assert client.get("/sessions").status_code == 404


def test_create_shell_app_enforces_auth_in_every_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    plugin = _make_plugin(tmp_path)

    async def api_secret(_request: Request) -> JSONResponse:
        return JSONResponse({"secret": 42})

    # 1. AUTH_ENFORCE=true (API-key auth via features.auth)
    from praisonaiui.features.auth import _auth_config, _auth_lock

    monkeypatch.setenv("AUTH_ENFORCE", "true")
    with _auth_lock:
        _auth_config["api_keys"]["tok-enforce"] = {"id": "k1", "name": "test", "created_at": 0.0}
    try:
        app = create_shell_app(
            plugins=[plugin],
            routes=[Route("/api/secret", api_secret, methods=["GET"])],
            csp="strict",
        )
        client = TestClient(app)
        assert client.get("/health").status_code == 200
        assert client.get("/focus").status_code == 200  # shell HTML stays public for sign-in
        assert client.get("/api/shell/manifest").status_code == 401
        assert client.get("/api/secret").status_code == 401
        assert client.get("/api/secret", headers={"Authorization": "Bearer tok-enforce"}).status_code == 200
        assert client.get("/sessions", headers={"Authorization": "Bearer tok-enforce"}).status_code == 404
    finally:
        with _auth_lock:
            _auth_config["api_keys"].pop("tok-enforce", None)

    # 2. AIUI_REQUIRE_TOKEN=1 (URL/bearer token mode)
    monkeypatch.delenv("AUTH_ENFORCE", raising=False)
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("AIUI_URL_TOKEN", "tok-query")
    app2 = create_shell_app(
        plugins=[plugin],
        routes=[Route("/api/secret", api_secret, methods=["GET"])],
    )
    client2 = TestClient(app2)
    assert client2.get("/api/secret").status_code == 401
    assert client2.get("/api/secret", headers={"Authorization": "Bearer tok-query"}).status_code == 200
    assert client2.get("/sessions", headers={"Authorization": "Bearer tok-query"}).status_code == 404

    # 3. require_auth=True (session/password auth)
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    monkeypatch.delenv("AIUI_URL_TOKEN", raising=False)
    app3 = create_shell_app(
        plugins=[plugin],
        routes=[Route("/api/secret", api_secret, methods=["GET"])],
        require_auth=True,
    )
    client3 = TestClient(app3)
    assert client3.get("/focus").status_code == 200
    assert client3.get("/api/shell/manifest").status_code == 401
    assert client3.get("/api/secret").status_code == 401


def test_shell_app_exports_are_lazy_on_root_import():
    code = (
        "import sys, praisonaiui as a\n"
        "assert 'praisonaiui.shell_app' not in sys.modules\n"
        "for name in ('create_shell_app', 'render_shell_html', 'shell_inline_script_hashes', 'shell_csp_header'):\n"
        "    assert name in a.__all__, name\n"
        "    assert callable(getattr(a, name)), name\n"
    )
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert res.returncode == 0, res.stderr


def test_shell_csp_header_allow_websockets_adds_ws_schemes():
    html = "<script>window.__X=1;</script>"
    without_ws = shell_csp_header(html)
    with_ws = shell_csp_header(html, allow_websockets=True)
    connect_without = next(d for d in without_ws.split("; ") if d.startswith("connect-src "))
    connect_with = next(d for d in with_ws.split("; ") if d.startswith("connect-src "))
    assert "ws:" not in connect_without and "wss:" not in connect_without
    assert "'self'" in connect_with and "ws:" in connect_with and "wss:" in connect_with


def test_create_shell_app_ws_ticket_and_authenticated_plugin_websocket(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    static = tmp_path / "static"
    static.mkdir(parents=True, exist_ok=True)
    (static / "live.js").write_text("export default function Live() { return null; }\n", encoding="utf-8")

    class _WsPlugin:
        name = "live_demo"

        def static_dir(self) -> Path:
            return static

        def pages(self):
            return [PageSpec(id="live", title="Live", kind="react", module="live.js")]

        def routes(self):
            async def echo_ws(ws: WebSocket):
                await ws.accept()
                msg = await ws.receive_text()
                await ws.send_text(f"echo:{msg}")
                await ws.close()

            return [WebSocketRoute("/ws/echo", echo_ws)]

    # Open loopback server still exposes POST /api/auth/ws-ticket.
    open_app = create_shell_app(plugins=[_WsPlugin()])
    open_client = TestClient(open_app)
    t_res = open_client.post("/api/auth/ws-ticket")
    assert t_res.status_code == 200
    assert t_res.json()["ticket"]

    # Token-authenticated server refuses unauthenticated WS and accepts single-use ticket.
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("AIUI_URL_TOKEN", "ws-secret")
    auth_app = create_shell_app(plugins=[_WsPlugin()])
    auth_client = TestClient(auth_app)

    assert auth_client.post("/api/auth/ws-ticket").status_code == 401
    with pytest.raises(WebSocketDisconnect):
        with auth_client.websocket_connect("/api/plugins/live_demo/ws/echo"):
            pass

    ticket_resp = auth_client.post(
        "/api/auth/ws-ticket", headers={"Authorization": "Bearer ws-secret"}
    )
    assert ticket_resp.status_code == 200
    ticket = ticket_resp.json()["ticket"]

    with auth_client.websocket_connect(f"/api/plugins/live_demo/ws/echo?ticket={ticket}") as ws:
        ws.send_text("ping")
        assert ws.receive_text() == "echo:ping"

    # Reusing the single-use ticket must be refused.
    with pytest.raises(WebSocketDisconnect):
        with auth_client.websocket_connect(f"/api/plugins/live_demo/ws/echo?ticket={ticket}"):
            pass

