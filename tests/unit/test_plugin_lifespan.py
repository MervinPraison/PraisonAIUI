"""Tests for AiuiPlugin.lifespan(app) startup/shutdown hooks and failure isolation."""

from __future__ import annotations

from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

import pytest
from starlette.routing import WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocket, WebSocketDisconnect

from praisonaiui import server as srv
from praisonaiui.plugin_registry import ExtensionPolicy, PageSpec, get_plugin_registry
from praisonaiui.shell_app import create_shell_app


@pytest.fixture(autouse=True)
def _clean_registry(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("AUTH_ENFORCE", raising=False)
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    monkeypatch.delenv("AIUI_URL_TOKEN", raising=False)
    monkeypatch.delenv("GATEWAY_AUTH_TOKEN", raising=False)

    reg = get_plugin_registry()
    orig_manual = list(reg._manual)
    orig_policy = reg.policy
    reg._manual.clear()
    reg.set_policy(ExtensionPolicy(), explicit=False)
    yield
    reg._manual.clear()
    reg._manual.extend(orig_manual)
    reg.set_policy(orig_policy, explicit=False)


def test_plugin_lifespan_runs_startup_and_lifo_shutdown_in_shell_app():
    events: list[str] = []

    class _AsyncPlugin:
        name = "alpha_life"

        @asynccontextmanager
        async def lifespan(self, app):
            events.append(f"start:alpha:{app is not None}")
            try:
                yield
            finally:
                events.append("stop:alpha")

    class _SyncPlugin:
        name = "beta_life"

        @contextmanager
        def lifespan(self, app):
            events.append(f"start:beta:{app is not None}")
            try:
                yield
            finally:
                events.append("stop:beta")

    app = create_shell_app(plugins=[_AsyncPlugin(), _SyncPlugin()])
    assert events == []
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert events == ["start:alpha:True", "start:beta:True"]
    assert events == ["start:alpha:True", "start:beta:True", "stop:beta", "stop:alpha"]


def test_plugin_lifespan_runs_in_create_app():
    events: list[str] = []

    class _WorkerPlugin:
        name = "worker_life"

        @asynccontextmanager
        async def lifespan(self, _app):
            events.append("up")
            try:
                yield
            finally:
                events.append("down")

    get_plugin_registry().register(_WorkerPlugin())
    app = srv.create_app()
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert events == ["up"]
    assert events == ["up", "down"]


def test_plugin_lifespan_isolates_startup_and_shutdown_failures():
    events: list[str] = []

    class _BrokenStartPlugin:
        name = "broken_start"

        @asynccontextmanager
        async def lifespan(self, _app):
            events.append("broken_start:try")
            raise RuntimeError("boom on startup")
            yield  # pragma: no cover

    class _BrokenStopPlugin:
        name = "broken_stop"

        @asynccontextmanager
        async def lifespan(self, _app):
            events.append("broken_stop:start")
            try:
                yield
            finally:
                events.append("broken_stop:stop")
                raise RuntimeError("boom on shutdown")

    class _HealthyPlugin:
        name = "healthy_life"

        @asynccontextmanager
        async def lifespan(self, _app):
            events.append("healthy:start")
            try:
                yield
            finally:
                events.append("healthy:stop")

    app = create_shell_app(plugins=[_BrokenStartPlugin(), _BrokenStopPlugin(), _HealthyPlugin()])
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert events == ["broken_start:try", "broken_stop:start", "healthy:start"]

    assert events == [
        "broken_start:try",
        "broken_stop:start",
        "healthy:start",
        "healthy:stop",
        "broken_stop:stop",
    ]


def test_disabled_plugin_lifespan_never_runs():
    events: list[str] = []

    class _OffPlugin:
        name = "disabled_life"

        @asynccontextmanager
        async def lifespan(self, _app):
            events.append("should-not-run")
            yield

    reg = get_plugin_registry()
    reg.set_policy(ExtensionPolicy(disabled=["disabled_life"]), explicit=True)
    app = create_shell_app(plugins=[_OffPlugin()])
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
    assert events == []


def test_plugin_websocket_with_lifespan_authenticated_in_auth_enforce_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from praisonaiui.features.auth import _auth_config, _auth_lock

    static = tmp_path / "static"
    static.mkdir(parents=True, exist_ok=True)
    (static / "runner.js").write_text("export default function Runner() { return null; }\n", encoding="utf-8")

    state = {"active": False, "cleaned": False}

    class _RunnerPlugin:
        name = "runner_ws"

        def static_dir(self) -> Path:
            return static

        def pages(self):
            return [PageSpec(id="runner", title="Runner", kind="react", module="runner.js")]

        @asynccontextmanager
        async def lifespan(self, _app):
            state["active"] = True
            try:
                yield
            finally:
                state["active"] = False
                state["cleaned"] = True

        def routes(self):
            async def ws_events(ws: WebSocket):
                await ws.accept()
                await ws.send_json({"active": state["active"]})
                await ws.close()

            return [WebSocketRoute("/ws/events", ws_events)]

    monkeypatch.setenv("AUTH_ENFORCE", "true")
    with _auth_lock:
        _auth_config["api_keys"]["runner-key"] = {"id": "rk1", "name": "test", "created_at": 0.0}
    try:
        app = create_shell_app(plugins=[_RunnerPlugin()])
        with TestClient(app) as client:
            assert state["active"] is True
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect("/api/plugins/runner_ws/ws/events"):
                    pass

            ticket = client.post(
                "/api/auth/ws-ticket", headers={"Authorization": "Bearer runner-key"}
            ).json()["ticket"]
            with client.websocket_connect(f"/api/plugins/runner_ws/ws/events?ticket={ticket}") as ws:
                assert ws.receive_json() == {"active": True}
        assert state["active"] is False
        assert state["cleaned"] is True
    finally:
        with _auth_lock:
            _auth_config["api_keys"].pop("runner-key", None)
