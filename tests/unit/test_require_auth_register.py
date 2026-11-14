"""Under require_auth, POST /register must not hand strangers a session token."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui import auth
from praisonaiui.server import create_app


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    prev = srv._style
    monkeypatch.setattr(auth, "_users", {})
    monkeypatch.setattr(auth, "_tokens", {})
    for var in ("AUTH_ENFORCE", "AIUI_URL_TOKEN", "GATEWAY_AUTH_TOKEN", "AIUI_REQUIRE_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    yield
    srv._style = prev


CREDS = {"username": "mallory", "password": "x1234567"}


def test_unauthenticated_register_refused_under_require_auth():
    client = TestClient(create_app(require_auth=True), raise_server_exceptions=False)
    r = client.post("/register", json=CREDS)
    assert r.status_code in (401, 403)
    assert "token" not in r.text
    assert "mallory" not in auth._users


def test_yaml_require_auth_also_closes_register():
    client = TestClient(
        create_app(config={"auth": {"requireAuth": True}}), raise_server_exceptions=False
    )
    assert client.post("/register", json=CREDS).status_code in (401, 403)


def test_signed_in_user_can_register_another():
    auth.register_user("admin", "admin-pass")
    token = auth.create_token("admin")
    client = TestClient(create_app(require_auth=True), raise_server_exceptions=False)
    r = client.post("/register", json=CREDS, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert "mallory" in auth._users


@pytest.mark.parametrize(
    "kwargs",
    [
        {"require_auth": True, "allow_signup": True},
        {"config": {"auth": {"requireAuth": True, "allowSignup": True}}},
    ],
)
def test_allow_signup_opt_in_reopens_register(kwargs):
    client = TestClient(create_app(**kwargs), raise_server_exceptions=False)
    r = client.post("/register", json=CREDS)
    assert r.status_code == 200
    assert r.json()["token"]


def test_login_stays_public_under_require_auth():
    auth.register_user("alice", "alice-pass")
    client = TestClient(create_app(require_auth=True), raise_server_exceptions=False)
    r = client.post("/login", json={"username": "alice", "password": "alice-pass"})
    assert r.status_code == 200


def test_auth_middleware_default_excludes_do_not_include_register():
    mw = auth.AuthMiddleware(app=None, require_auth=True)
    assert "/register" not in mw.exclude_paths
