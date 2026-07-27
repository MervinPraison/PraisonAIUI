"""Regression tests for GATEWAY_AUTH_TOKEN env pollution (issue #238).

A GATEWAY_AUTH_TOKEN leaked into an interactive shell must not silently enforce
auth on standalone create_app(). Enforcement requires explicit opt-in via
AIUI_URL_TOKEN, AIUI_REQUIRE_TOKEN=1, or YAML auth.urlToken.
"""

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import create_app


@pytest.fixture(autouse=True)
def _clear_token_env(monkeypatch):
    monkeypatch.delenv("GATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("AIUI_URL_TOKEN", raising=False)
    monkeypatch.delenv("AIUI_REQUIRE_TOKEN", raising=False)


def _get_health(monkeypatch):
    client = TestClient(create_app())
    return client.get("/api/health")


def test_open_without_any_token(monkeypatch):
    resp = _get_health(monkeypatch)
    assert resp.status_code == 200


def test_gateway_token_alone_does_not_enforce(monkeypatch):
    monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "gw_leaked_token")
    client = TestClient(create_app())
    resp = client.get("/api/health")
    assert resp.status_code == 200


def test_aiui_url_token_enforces_auth(monkeypatch):
    monkeypatch.setenv("AIUI_URL_TOKEN", "abcdef123456789012345678901234567890")
    client = TestClient(create_app())
    resp = client.get("/api/nonexistent")
    assert resp.status_code == 401
    assert resp.json()["error"] == "Unauthorized"


def test_gateway_token_with_require_flag_enforces(monkeypatch):
    token = "abcdef123456789012345678901234567890"
    monkeypatch.setenv("GATEWAY_AUTH_TOKEN", token)
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    client = TestClient(create_app())
    assert client.get("/api/nonexistent").status_code == 401
    assert (
        client.get(
            "/api/nonexistent",
            headers={"Authorization": f"Bearer {token}"},
        ).status_code
        != 401
    )


def test_gateway_token_with_require_flag_variants(monkeypatch):
    for value in ("true", "yes", "TRUE", "Yes"):
        monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "abcdef123456789012345678901234567890")
        monkeypatch.setenv("AIUI_REQUIRE_TOKEN", value)
        client = TestClient(create_app())
        assert client.get("/api/nonexistent").status_code == 401


def test_gateway_token_with_yaml_url_token_enforces(monkeypatch):
    monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "abcdef123456789012345678901234567890")
    config = {"auth": {"urlToken": "abcdef123456789012345678901234567890"}}
    client = TestClient(create_app(config=config))
    assert client.get("/api/nonexistent").status_code == 401


def test_require_flag_falsey_keeps_open(monkeypatch):
    monkeypatch.setenv("GATEWAY_AUTH_TOKEN", "gw_leaked_token")
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "0")
    client = TestClient(create_app())
    assert client.get("/api/health").status_code == 200
