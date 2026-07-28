"""Regression tests for opt-in token auth activation (#238, #251).

The mere presence of GATEWAY_AUTH_TOKEN / AIUI_URL_TOKEN in the environment
(e.g. leaking into a developer shell after a gateway run) must not force 401
on standalone create_app() + TestClient. Token auth activates only when
explicitly opted in via AIUI_REQUIRE_TOKEN, YAML auth.requireToken, or
require_auth=True.
"""

import pytest
from starlette.testclient import TestClient

from praisonaiui import server
from praisonaiui.server import create_app


@pytest.fixture(autouse=True)
def _reset_state():
    server.reset_state()
    yield
    server.reset_state()


def test_env_token_alone_does_not_force_401(monkeypatch):
    monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "test-secret-token")
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    client = TestClient(create_app())
    assert client.get("/api/agents").status_code == 200


def test_aiui_url_token_alone_does_not_force_401(monkeypatch):
    monkeypatch.setenv("AIUI_URL_TOKEN", "test-secret-token")
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    client = TestClient(create_app())
    assert client.get("/api/agents").status_code == 200


def test_require_token_env_opt_in_enforces_401(monkeypatch):
    monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "test-secret-token")
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    client = TestClient(create_app())
    assert client.get("/api/agents").status_code == 401


def test_require_token_env_opt_in_allows_bearer(monkeypatch):
    monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "test-secret-token")
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    client = TestClient(create_app())
    resp = client.get(
        "/api/agents",
        headers={"Authorization": "Bearer test-secret-token"},
    )
    assert resp.status_code == 200


def test_config_require_token_opt_in_enforces_401(monkeypatch):
    monkeypatch.setenv("AIUI_URL_TOKEN", "test-secret-token")
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    client = TestClient(create_app(config={"auth": {"requireToken": True}}))
    assert client.get("/api/agents").status_code == 401


def test_require_auth_opt_in_enforces_401(monkeypatch):
    monkeypatch.setenv("AIUI_URL_TOKEN", "test-secret-token")
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)
    client = TestClient(create_app(require_auth=True))
    assert client.get("/api/agents").status_code == 401
