"""R8 for the layout data routes (ADR 0003, Track D): /api/artifacts* and
/api/runs* answer only with credentials in every auth mode, and stay out of
the public surface.

The routes are mounted here with ``register_feature`` so the check does not
depend on which layout is available (their records gate on layouts)."""

from __future__ import annotations

import pytest
from starlette.routing import Route
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui import http_guard

TOKEN = "s3cret-layout-data"


@pytest.fixture(autouse=True)
def _mounted(tmp_path, monkeypatch):
    from praisonaiui.features import _features, register_feature
    from praisonaiui.features.artifacts import ArtifactsFeature
    from praisonaiui.features.run_ledger import RunLedgerFeature, reset_run_ledger

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("PRAISONAI_HOME", raising=False)
    prev = srv._style
    feats = [ArtifactsFeature(), RunLedgerFeature()]
    for f in feats:
        register_feature(f)
    yield
    for f in feats:
        if _features.get(f.name) is f:
            del _features[f.name]
    reset_run_ledger()
    srv._style = prev


def _routes(app) -> list[tuple[str, str]]:
    out = []
    for route in app.routes:
        if isinstance(route, Route) and route.path.startswith(("/api/artifacts", "/api/runs")):
            for method in sorted(route.methods or ()):
                if method not in ("HEAD", "OPTIONS"):
                    out.append((method, route.path))
    return out


def _concrete(path: str) -> str:
    return path.replace("{session_id}", "s1").replace("{key:path}", "a/b.py").replace("{run_id}", "r1")


def _call(client: TestClient, method: str, path: str, **headers):
    body = {"kind": "code", "content": "x"} if method == "PUT" else None
    return client.request(method, _concrete(path), json=body, headers=headers)


EXPECTED = {
    ("GET", "/api/artifacts"),
    ("GET", "/api/artifacts/{session_id}"),
    ("DELETE", "/api/artifacts/{session_id}"),
    ("PUT", "/api/artifacts/{session_id}/{key:path}"),
    ("DELETE", "/api/artifacts/{session_id}/{key:path}"),
    ("GET", "/api/runs"),
    ("GET", "/api/runs/kpis"),
    ("GET", "/api/runs/agents"),
    ("GET", "/api/runs/{run_id}"),
}


def test_no_layout_data_path_is_public():
    for method, path in EXPECTED:
        scope = {"type": "http", "method": method, "path": _concrete(path)}
        assert not http_guard.is_public_http(scope), (method, path)


def _check(client: TestClient, ok_headers: dict) -> None:
    routes = _routes(client.app)
    assert set(routes) == EXPECTED
    for method, path in routes:
        r = _call(client, method, path)
        assert r.status_code == 401, (method, path, r.status_code)
        r = _call(client, method, path, Origin="http://evil.example")
        assert r.status_code in (401, 403), (method, path, r.status_code)
    for method, path in routes:
        r = _call(client, method, path, **ok_headers)
        assert r.status_code in (200, 404), (method, path, r.status_code, r.text)


def test_auth_enforce(monkeypatch):
    from praisonaiui.features import auth as feature_auth

    monkeypatch.setitem(feature_auth._auth_config["api_keys"], TOKEN, {"name": "t"})
    monkeypatch.setenv("AUTH_ENFORCE", "true")
    client = TestClient(srv.create_app(), raise_server_exceptions=False)
    _check(client, {"Authorization": f"Bearer {TOKEN}"})


def test_url_token_mode(monkeypatch):
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("AIUI_URL_TOKEN", TOKEN)
    client = TestClient(srv.create_app(), raise_server_exceptions=False)
    _check(client, {"Authorization": f"Bearer {TOKEN}"})
    r = client.get("/api/runs?token=wrong")
    assert r.status_code == 401


def test_require_auth(monkeypatch):
    from praisonaiui.auth import create_token, register_user

    client = TestClient(srv.create_app(require_auth=True), raise_server_exceptions=False)
    user = register_user("layout-data-user", "pw-layout-1")
    _check(client, {"Authorization": f"Bearer {create_token(user['id'])}"})


def test_open_server_answers_and_refuses_cross_site_writes():
    client = TestClient(srv.create_app(), raise_server_exceptions=False)
    assert set(_routes(client.app)) == EXPECTED
    assert client.get("/api/runs").status_code == 200
    assert client.put("/api/artifacts/s1/k", json={"kind": "code"}).status_code == 200
    evil = client.put("/api/artifacts/s1/k", json={"kind": "code"}, headers={"Origin": "http://evil.example"})
    assert evil.status_code == 403
    evil = client.delete("/api/artifacts/s1", headers={"Origin": "http://evil.example"})
    assert evil.status_code == 403
