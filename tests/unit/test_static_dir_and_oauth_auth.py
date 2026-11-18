"""static_dir content and OAuth sign-in under every auth mode (ARCHITECTURE R8).

static_dir: the public part of a ``create_app(static_dir=...)`` mount is the
generated HTML shell, code, style, font and image files, and HTML pages, which
under AUTH_ENFORCE / require_auth are served without their content (the
inlined markdown and the ``<noscript>`` copy) so a signed-out browser gets the
app and its sign-in prompt. Markdown, JSON and other files need credentials in
every auth mode, as they already did under ``AIUI_REQUIRE_TOKEN``.
``AIUI_PUBLIC_STATIC_DIR=1`` restores a fully public folder.

OAuth: ``/api/auth/oauth/{provider}`` and its callback answer a logged-out
browser (they only redirect), ``return_url`` must be a same-origin path, and
the session token comes back in the URL fragment, never in a query string.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest
from starlette.testclient import TestClient

import praisonaiui.server as srv
from praisonaiui.oauth_providers import safe_return_url

MODES = ["auth_enforce", "require_auth", "url_token"]
DATA_FILES = ["/docs/runbook.md", "/search-index.json", "/notes/data.txt"]
PAGES = ["/docs/guide", "/docs/guide.html", "/notes/", "/"]
CODE_FILES = ["/logo.png", "/site.css", "/app.js"]


# A built page: its body is inlined twice (noscript and the markdown JSON).
PAGE = (
    '<html><head><title>{0}</title></head><body><div id="root"></div>'
    "<noscript><p>internal {0} body</p></noscript>"
    '<script type="application/json" id="aiui-initial-doc">{{"text": "internal {0} md"}}</script>'
    "</body></html>"
)


@pytest.fixture
def site(tmp_path: Path) -> Path:
    root = tmp_path / "site"
    (root / "docs").mkdir(parents=True)
    (root / "notes").mkdir()
    (root / "docs" / "runbook.md").write_text("# runbook: internal")
    (root / "docs" / "guide.html").write_text(PAGE.format("guide"))
    (root / "notes" / "index.html").write_text(PAGE.format("notes"))
    (root / "notes" / "data.txt").write_text("internal data")
    (root / "search-index.json").write_text('{"internal": true}')
    (root / "logo.png").write_bytes(b"\x89PNG")
    (root / "site.css").write_text("body{}")
    (root / "app.js").write_text("// app")
    (root / "index.html").write_text(PAGE.format("home"))
    return root


@pytest.fixture
def make_app(monkeypatch, tmp_path):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "data"))

    def _make(mode: str, static_dir: Path | None = None, style: str | None = None):
        srv.reset_state()
        if style:
            srv.set_style(style)
        creds: dict[str, str] = {}
        require_auth = False
        if mode == "auth_enforce":
            from praisonaiui.features import auth as feature_auth

            monkeypatch.setenv("AUTH_ENFORCE", "true")
            monkeypatch.setitem(feature_auth._auth_config["api_keys"], "pk_static_test", {"name": "t"})
            creds = {"Authorization": "Bearer pk_static_test"}
        elif mode == "require_auth":
            from praisonaiui.auth import create_token

            require_auth = True
            creds = {"Authorization": f"Bearer {create_token('tester')}"}
        elif mode == "url_token":
            monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
            monkeypatch.setenv("AIUI_URL_TOKEN", "s3cret")
            creds = {"Authorization": "Bearer s3cret"}
        app = srv.create_app(static_dir=static_dir, require_auth=require_auth)
        return TestClient(app, raise_server_exceptions=False), creds

    yield _make
    srv.reset_state()


# ── static_dir ──────────────────────────────────────────────────────


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("path", DATA_FILES)
def test_static_dir_content_needs_credentials(make_app, site, mode, path):
    client, creds = make_app(mode, site)
    anon = client.get(path, follow_redirects=False)
    assert anon.status_code == 401, f"{mode} {path}: {anon.status_code}"
    assert "internal" not in anon.text
    signed_in = client.get(path, headers=creds, follow_redirects=False)
    assert signed_in.status_code == 200 and "internal" in signed_in.text


@pytest.mark.parametrize("mode", ["auth_enforce", "require_auth"])
@pytest.mark.parametrize("path", PAGES)
def test_static_dir_pages_are_shells_without_content(make_app, site, mode, path):
    client, creds = make_app(mode, site)
    for headers in ({"Accept": "text/html"}, {}, creds):
        r = client.get(path, headers=headers)
        assert r.status_code == 200 and "<title>" in r.text
        assert "internal" not in r.text, f"{mode} {path}: page content served"


@pytest.mark.parametrize("path", [p for p in PAGES if p != "/"])  # "/" is the generated shell outside style docs
def test_open_server_serves_pages_unchanged(make_app, site, path):
    client, _ = make_app("open", site)
    assert "internal" in client.get(path).text


def test_url_token_mode_serves_full_pages_to_a_signed_in_browser(make_app, site):
    client, creds = make_app("url_token", site)
    assert client.get("/docs/guide").status_code == 401
    assert "internal guide body" in client.get("/docs/guide", headers=creds).text


@pytest.mark.parametrize("mode", ["auth_enforce", "require_auth"])
@pytest.mark.parametrize("path", CODE_FILES)
def test_static_dir_code_and_images_stay_public(make_app, site, mode, path):
    client, _ = make_app(mode, site)
    assert client.get(path).status_code == 200


@pytest.mark.parametrize("mode", ["auth_enforce", "require_auth"])
def test_static_dir_shell_stays_public(make_app, site, mode):
    client, _ = make_app(mode, site)
    nav = client.get("/chat", headers={"Accept": "text/html"})
    assert nav.status_code == 200 and nav.headers["content-type"].startswith("text/html")


@pytest.mark.parametrize("mode", ["auth_enforce", "require_auth"])
def test_static_dir_traversal_is_not_public(make_app, site, mode):
    client, _ = make_app(mode, site)
    r = client.get("/docs/%2e%2e/docs/runbook.md")
    assert r.status_code in (401, 404) and "internal" not in r.text


@pytest.mark.parametrize("mode", ["auth_enforce", "require_auth"])
def test_public_static_dir_opt_out(make_app, site, mode, monkeypatch):
    monkeypatch.setenv("AIUI_PUBLIC_STATIC_DIR", "1")
    client, _ = make_app(mode, site)
    assert client.get("/docs/runbook.md").status_code == 200
    assert "internal guide body" in client.get("/docs/guide").text


# ── OAuth ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value,expected",
    [
        ("/", "/"),
        ("/chat?x=1", "/chat?x=1"),
        ("/chat#frag", "/chat"),
        ("https://evil.example/steal", "/"),
        ("//evil.example/x", "/"),
        ("/\\evil.example/x", "/"),
        ("javascript:alert(1)", "/"),
        ("evil.example", "/"),
        ("/ok\r\nSet-Cookie: x", "/"),
        ("", "/"),
        (None, "/"),
    ],
)
def test_safe_return_url(value, expected):
    assert safe_return_url(value) == expected


@pytest.fixture
def github_env(monkeypatch):
    from praisonaiui.auth import _oauth_callbacks

    _oauth_callbacks.clear()
    monkeypatch.setenv("AIUI_OAUTH_GITHUB_CLIENT_ID", "cid")
    monkeypatch.setenv("AIUI_OAUTH_GITHUB_CLIENT_SECRET", "csecret")
    with patch(
        "praisonaiui.oauth_providers.GitHubProvider.exchange_code_for_token",
        AsyncMock(return_value={"access_token": "gh"}),
    ), patch(
        "praisonaiui.oauth_providers.GitHubProvider.get_user_info",
        AsyncMock(return_value={"login": "octo", "name": "Octo"}),
    ):
        yield


def _sign_in(client: TestClient, return_url: str):
    start = client.get("/api/auth/oauth/github", params={"return_url": return_url}, follow_redirects=False)
    assert start.status_code == 302, start.text
    state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    return client.get(
        "/api/auth/oauth/github/callback",
        params={"code": "c", "state": state},
        follow_redirects=False,
    )


@pytest.mark.parametrize("mode", ["open", "auth_enforce", "require_auth"])
def test_oauth_sign_in_starts_without_credentials(make_app, github_env, mode):
    client, _ = make_app(mode)
    done = _sign_in(client, "/chat")
    assert done.status_code == 302
    location = done.headers["location"]
    parts = urlsplit(location)
    assert parts.path == "/chat" and not parts.netloc
    assert "token=" not in parts.query
    assert parts.fragment.startswith("token=")


@pytest.mark.parametrize("target", ["https://evil.example/steal", "//evil.example/steal"])
def test_oauth_never_redirects_off_site(make_app, github_env, target):
    client, _ = make_app("open")
    location = _sign_in(client, target).headers["location"]
    assert location.startswith("/#token=")
    assert "evil.example" not in location


def test_oauth_token_signs_in_under_require_auth(make_app, github_env):
    client, _ = make_app("require_auth")
    assert client.get("/sessions").status_code == 401
    token = urlsplit(_sign_in(client, "/").headers["location"]).fragment.removeprefix("token=")
    assert client.get("/sessions", headers={"Authorization": f"Bearer {token}"}).status_code == 200


# ── a docs site served from static_dir ──────────────────────────────


@pytest.mark.parametrize("style,expected", [("docs", {"items": [{"title": "Guide"}]}), ("chat", {"items": []})])
def test_docs_style_serves_the_built_navigation(make_app, site, style, expected):
    (site / "docs-nav.json").write_text('{"items": [{"title": "Guide"}]}')
    (site / "route-manifest.json").write_text('{"routes": [{"match": "/docs/**"}]}')
    client, _ = make_app("open", site, style)
    assert client.get("/docs-nav.json").json() == expected
    routes = client.get("/route-manifest.json").json()
    assert routes == ({"routes": [{"match": "/docs/**"}]} if style == "docs" else {})
