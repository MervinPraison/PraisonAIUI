"""Self-registration (``POST /register``) policy in each auth mode.

Under ``require_auth`` (``create_app(require_auth=True)`` / YAML
``auth.requireAuth``) a token from ``/register`` passes the auth middleware,
so registration must not be open to anyone: it is allowed only for the first
user (bootstrap), for a signed-in user, or with YAML ``auth.allowSignup``.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from praisonaiui import auth
from praisonaiui.server import create_app

STRANGER = {"username": "stranger", "password": "pw-stranger-1"}


@pytest.fixture(autouse=True)
def _fresh_accounts(monkeypatch):
    """No accounts and no custom login callbacks (other tests leak both)."""
    monkeypatch.setattr(auth, "_users", {})
    monkeypatch.setattr(auth, "_login_callback", None)
    monkeypatch.setattr(auth, "_password_auth_callback", None)
    monkeypatch.setattr(auth, "_header_auth_callback", None)
    monkeypatch.setattr(auth, "_oauth_callbacks", {})


def _client(**kw) -> TestClient:
    return TestClient(create_app(**kw), raise_server_exceptions=False)


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_require_auth_stranger_cannot_register_and_get_in():
    """The gap: register 200, then a protected call 200 with that token."""
    auth.register_user("admin", "pw-admin-1")
    c = _client(require_auth=True)
    r = c.post("/register", json=STRANGER)
    token = r.json().get("token")
    if token:
        assert c.get("/api/sessions", headers=_bearer(token)).status_code == 401
    assert r.status_code == 403
    assert "token" not in r.json()
    assert "stranger" not in auth._users


def test_require_auth_yaml_closed_after_first_user():
    auth.register_user("admin", "pw-admin-1")
    c = _client(config={"auth": {"requireAuth": True}})
    assert c.post("/register", json=STRANGER).status_code == 403


def test_first_user_bootstrap_then_closed():
    c = _client(require_auth=True)
    r = c.post("/register", json={"username": "admin", "password": "pw-admin-1"})
    assert r.status_code == 200
    assert c.get("/api/sessions", headers=_bearer(r.json()["token"])).status_code == 200
    assert c.post("/register", json=STRANGER).status_code == 403


def test_no_bootstrap_when_a_login_callback_owns_accounts(monkeypatch):
    monkeypatch.setattr(auth, "_login_callback", lambda u, p: u == "ldap-user")
    c = _client(require_auth=True)
    assert c.post("/register", json=STRANGER).status_code == 403


def test_signed_in_user_can_add_a_user():
    admin = auth.register_user("admin", "pw-admin-1")
    token = auth.create_token(admin["id"])
    c = _client(require_auth=True)
    r = c.post("/register", json=STRANGER, headers=_bearer(token))
    assert r.status_code == 200
    assert "stranger" in auth._users


def test_allow_signup_opens_registration():
    auth.register_user("admin", "pw-admin-1")
    c = _client(config={"auth": {"requireAuth": True, "allowSignup": True}})
    r = c.post("/register", json=STRANGER)
    assert r.status_code == 200
    assert c.get("/api/sessions", headers=_bearer(r.json()["token"])).status_code == 200


def test_existing_users_still_log_in():
    auth.register_user("admin", "pw-admin-1")
    c = _client(require_auth=True)
    r = c.post("/login", json={"username": "admin", "password": "pw-admin-1"})
    assert r.status_code == 200
    assert c.get("/api/sessions", headers=_bearer(r.json()["token"])).status_code == 200


def test_auth_enforce_unchanged(monkeypatch):
    from praisonaiui.features import auth as feature_auth

    monkeypatch.setenv("AUTH_ENFORCE", "true")
    monkeypatch.setitem(feature_auth._auth_config["api_keys"], "pk_reg_key", {"name": "t"})
    auth.register_user("admin", "pw-admin-1")
    c = _client()
    assert c.post("/register", json=STRANGER).status_code == 401
    assert c.post("/register", json=STRANGER, headers=_bearer("pk_reg_key")).status_code == 200


def test_default_no_auth_mode_unchanged():
    auth.register_user("admin", "pw-admin-1")
    c = _client()
    r = c.post("/register", json=STRANGER)
    assert r.status_code == 200
    assert r.json()["token"]


def test_allow_signup_from_config():
    assert auth.allow_signup_from_config(None) is False
    assert auth.allow_signup_from_config({"auth": None}) is False
    assert auth.allow_signup_from_config({"auth": {"allowSignup": True}}) is True
    assert auth.allow_signup_from_config({"auth": {"allow_signup": True}}) is True


def test_yaml_schema_accepts_allow_signup():
    from praisonaiui.schema.models import AuthConfig

    assert AuthConfig().allow_signup is False
    assert AuthConfig.model_validate({"allowSignup": True}).allow_signup is True


def test_bootstrap_race_rechecked_in_handler():
    """Two first-user requests: the one that arrives second is refused."""
    import asyncio
    import json

    from starlette.requests import Request

    auth.register_user("admin", "pw-admin-1")  # the other request won
    body = json.dumps(STRANGER).encode()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/register",
        "headers": [],
        "state": {"aiui_signup_bootstrap": True},
    }
    resp = asyncio.run(auth.register_handler(Request(scope, receive)))
    assert resp.status_code == 403
    assert "stranger" not in auth._users
