"""Signed, stateless session tokens and the httpOnly session cookie."""

from __future__ import annotations

import base64
import json
import os
import stat

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from typer.testing import CliRunner

import praisonaiui.server as srv
from praisonaiui import auth, auth_tokens
from praisonaiui.server import create_app

ALICE = {"username": "alice", "password": "alice-pass-1"}


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    """Own data dir (secret file, sign-out log), accounts and env per test."""
    prev_style = srv._style
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    for var in ("AIUI_AUTH_SECRET", "AIUI_SESSION_LIFETIME", "AUTH_ENFORCE", "AIUI_URL_TOKEN",
                "GATEWAY_AUTH_TOKEN", "AIUI_REQUIRE_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(auth, "_users", {})
    monkeypatch.setattr(auth, "_login_callback", None)
    monkeypatch.setattr(auth_tokens, "_revocations", auth_tokens._Revocations())
    auth_tokens.configure(None)
    auth.register_user(ALICE["username"], ALICE["password"])
    yield
    auth_tokens.configure(None)
    srv._style = prev_style


def _client(base_url: str = "http://testserver", **kw) -> TestClient:
    return TestClient(create_app(**kw), base_url=base_url, raise_server_exceptions=False)


def _login(client: TestClient) -> str:
    r = client.post("/login", json=ALICE)
    assert r.status_code == 200
    return r.json()["token"]


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _claims(token: str) -> dict:
    body = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


def test_session_survives_app_recreation_with_the_auto_secret():
    token = _login(_client(require_auth=True))
    # A restart (or another worker): new app, new in-process state, same data dir.
    auth._tokens.clear()
    fresh = _client(require_auth=True)
    assert fresh.get("/api/sessions", headers=_bearer(token)).status_code == 200
    assert fresh.get("/me", headers=_bearer(token)).json()["id"] == "alice"


def test_session_works_on_any_worker_sharing_the_env_secret(monkeypatch, tmp_path):
    monkeypatch.setenv("AIUI_AUTH_SECRET", "x" * 40)
    token = _login(_client(require_auth=True))
    # Another replica: different data dir, same AIUI_AUTH_SECRET.
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "replica"))
    assert _client(require_auth=True).get("/api/sessions", headers=_bearer(token)).status_code == 200
    monkeypatch.setenv("AIUI_AUTH_SECRET", "y" * 40)
    assert _client(require_auth=True).get("/api/sessions", headers=_bearer(token)).status_code == 401


def test_secret_file_is_private_created_once_and_never_logged(tmp_path, caplog):
    caplog.set_level("DEBUG")
    auth.create_token("alice")
    path = tmp_path / "auth_secret"
    secret = path.read_text().strip()
    assert len(secret) >= 64
    assert os.name != "posix" or stat.S_IMODE(path.stat().st_mode) == 0o600
    auth_tokens._keys_cache.clear()
    auth.create_token("alice")
    assert path.read_text().strip() == secret
    assert secret not in caplog.text
    assert [p.name for p in tmp_path.iterdir() if p.name.startswith(".auth_secret")] == []


def test_tampered_and_garbage_tokens_are_rejected():
    token = auth.create_token("alice")
    head, body, sig = token.split(".")
    forged = dict(_claims(token), sub="admin")
    forged_body = base64.urlsafe_b64encode(json.dumps(forged).encode()).rstrip(b"=").decode()
    assert auth.validate_token(token) == "alice"
    assert auth.validate_token(f"{head}.{forged_body}.{sig}") is None
    assert auth.validate_token(f"{head}.{body}.{sig[:-2]}AA") is None
    assert auth.validate_token(f"{head}.{body}") is None
    for junk in ("", "v1.", "v1.x.y", "v1.!!.??", "nonsense", "v1.é.é"):
        assert auth.validate_token(junk) is None


def test_expired_token_is_rejected(monkeypatch):
    token = auth.create_token("alice")
    exp = _claims(token)["exp"]
    monkeypatch.setattr(auth_tokens, "_now", lambda: exp - 1)
    assert auth.validate_token(token) == "alice"
    monkeypatch.setattr(auth_tokens, "_now", lambda: exp + 1)
    assert auth.validate_token(token) is None


def test_key_rotation_new_signs_old_still_verifies(monkeypatch):
    old, new = "o" * 40, "n" * 40
    monkeypatch.setenv("AIUI_AUTH_SECRET", old)
    old_token = auth.create_token("alice")
    monkeypatch.setenv("AIUI_AUTH_SECRET", f"{new},{old}")
    assert auth.validate_token(old_token) == "alice"
    new_token = auth.create_token("alice")
    monkeypatch.setenv("AIUI_AUTH_SECRET", new)  # old secret retired: its sessions end
    assert auth.validate_token(old_token) is None
    assert auth.validate_token(new_token) == "alice"


def test_opaque_tokens_from_older_code_still_validate(monkeypatch):
    from datetime import datetime, timedelta

    later = datetime.utcnow() + timedelta(hours=1)
    monkeypatch.setattr(auth, "_tokens", {"opaque": {"user_id": "alice", "expires_at": later}})
    assert auth.validate_token("opaque") == "alice"
    assert auth.revoke_token("opaque") is True and auth.validate_token("opaque") is None


def test_parse_lifetime():
    good = {3600: 3600, "90": 90, "30m": 1800, "12h": 43200, "14d": 1209600, "2w": 1209600}
    assert {v: auth_tokens.parse_lifetime(v) for v in good} == good
    for bad in ("", "0", "-1h", "soon", "1y", True):
        with pytest.raises(ValueError):
            auth_tokens.parse_lifetime(bad)


def test_lifetime_default_yaml_and_env(monkeypatch):
    claims = _claims(_login(_client()))
    assert claims["exp"] - int(claims["iat"]) in (14 * 86400 - 1, 14 * 86400)
    client = _client(config={"auth": {"sessionLifetime": "2h"}})
    claims = _claims(_login(client))
    assert claims["exp"] - int(claims["iat"]) in (7199, 7200)
    assert "Max-Age=7200" in client.post("/login", json=ALICE).headers["set-cookie"]
    monkeypatch.setenv("AIUI_SESSION_LIFETIME", "1d")
    claims = _claims(_login(_client(config={"auth": {"sessionLifetime": "2h"}})))
    assert claims["exp"] - int(claims["iat"]) in (86399, 86400)


def test_bad_yaml_fails_loudly():
    with pytest.raises(ValueError):
        create_app(config={"auth": {"sessionLifetime": "forever"}})
    with pytest.raises(ValueError):
        create_app(config={"auth": {"cookie": {"sameSite": "sometimes"}}})
    from praisonaiui.schema.models import AuthConfig

    cfg = AuthConfig.model_validate(
        {"sessionLifetime": "7d", "cookie": {"name": "s", "sameSite": "strict", "path": "/app"}}
    )
    assert cfg.session_lifetime == "7d"
    assert cfg.cookie.same_site == "strict" and cfg.cookie.path == "/app"


def _set_cookie(response) -> str:
    return response.headers.get("set-cookie", "")


def test_login_sets_httponly_cookie_secure_on_https_and_keeps_json_token():
    r = _client().post("/login", json=ALICE)
    cookie = _set_cookie(r)
    assert cookie.startswith(f"aiui_session={r.json()['token']};")
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Path=/;" in cookie
    assert "Max-Age=1209600" in cookie
    assert "Secure" not in cookie  # plain http
    assert "Secure" in _set_cookie(_client("https://testserver").post("/login", json=ALICE))
    r = _client().post("/login", json=ALICE, headers={"X-Forwarded-Proto": "https"})
    assert "Secure" in _set_cookie(r)


def test_cookie_name_samesite_path_from_yaml_and_root_path():
    cfg = {"auth": {"cookie": {"name": "my_sess", "sameSite": "strict", "path": "/app"}}}
    cookie = _set_cookie(_client(config=cfg).post("/login", json=ALICE))
    assert cookie.startswith("my_sess=") and "SameSite=Strict" in cookie and "Path=/app;" in cookie
    cfg = {"auth": {"cookie": {"sameSite": "none"}}}
    assert "Secure" in _set_cookie(_client(config=cfg).post("/login", json=ALICE))
    client = TestClient(create_app(), root_path="/aiui", raise_server_exceptions=False)
    assert "Path=/aiui;" in _set_cookie(client.post("/login", json=ALICE))  # follows the root path


def test_cookie_alone_signs_in_http_and_websocket():
    client = _client(require_auth=True)
    assert client.get("/api/sessions").status_code == 401
    _login(client)  # the test client keeps the cookie, like a browser
    assert client.get("/api/sessions").status_code == 200
    assert client.get("/me").json()["id"] == "alice"
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "ping"})
        ws.receive_json()
    client.cookies.clear()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/chat/ws") as ws:
            ws.receive_json()


def test_expired_bearer_falls_back_to_a_valid_cookie():
    client = _client(require_auth=True)
    _login(client)
    assert client.get("/api/sessions", headers=_bearer("v1.bad.sig")).status_code == 200


def test_sliding_refresh_reissues_the_cookie_past_half_life(monkeypatch):
    client = _client(require_auth=True)
    token = _login(client)
    assert "set-cookie" not in client.get("/api/sessions").headers
    claims = _claims(token)
    monkeypatch.setattr(auth_tokens, "_now", lambda: claims["exp"] - 60)
    r = client.get("/api/sessions")
    assert r.status_code == 200
    fresh = r.cookies["aiui_session"]
    assert fresh != token and _claims(fresh)["exp"] > claims["exp"]


def test_logout_revokes_on_every_worker_and_clears_the_cookie():
    client = _client(require_auth=True)
    token = _login(client)
    r = client.post("/logout", headers=_bearer(token))
    assert r.status_code == 200
    assert "aiui_session=;" in _set_cookie(r) and "Max-Age=0" in _set_cookie(r)
    assert auth.validate_token(token) is None
    # Another worker (its own in-memory cache) reads the shared sign-out log.
    auth_tokens._revocations = auth_tokens._Revocations()
    assert _client(require_auth=True).get("/api/sessions", headers=_bearer(token)).status_code == 401
    cookie_only = _client(require_auth=True)
    token = _login(cookie_only)
    assert cookie_only.post("/logout").status_code == 200  # the cookie session alone
    assert auth.validate_token(token) is None


def test_clear_tokens_signs_a_user_out_everywhere():
    import asyncio

    first, second = auth.create_token("alice"), auth.create_token("alice")
    other = auth.create_token("bob")
    asyncio.run(auth.Session("", "alice", {}).clear_tokens())
    assert auth.validate_token(first) is None and auth.validate_token(second) is None
    assert auth.validate_token(other) == "bob"
    assert auth.validate_token(auth.create_token("alice")) == "alice"  # new sign-in works


def test_sign_out_log_drops_expired_lines(monkeypatch):
    monkeypatch.setattr(auth_tokens, "_COMPACT_AT", 2)
    for _ in range(4):
        auth.revoke_token(auth.create_token("alice"))
    live = auth.create_token("alice")
    auth.revoke_token(live)
    path = auth_tokens.data_dir() / auth_tokens.REVOKED_FILE
    assert len(path.read_text().splitlines()) == 5
    monkeypatch.setattr(auth_tokens, "_now", lambda: _claims(live)["exp"] + 10)
    auth_tokens.revoke_user("bob")  # a write past the threshold compacts
    assert len(path.read_text().splitlines()) == 1


def test_cli_create_secret_prints_a_strong_secret():
    from praisonaiui.cli import app

    first, second = (CliRunner().invoke(app, ["auth", "create-secret"]) for _ in range(2))
    assert first.exit_code == 0, first.output
    assert len(first.output.strip()) >= 64 and first.output != second.output


def test_an_empty_secret_file_is_refused(tmp_path):
    (tmp_path / "auth_secret").write_text("\n")
    with pytest.raises(RuntimeError, match="no usable secret"):
        auth.create_token("alice")
