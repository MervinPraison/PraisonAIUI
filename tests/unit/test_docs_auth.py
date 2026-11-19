"""Docs sign-in on aiui serve: content.docs.auth and open pages (docs_auth.py)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient

from praisonaiui.compiler import Compiler
from praisonaiui.schema.models import Config, DocsAuthConfig

NAV = {"Accept": "text/html", "Sec-Fetch-Mode": "navigate"}
PAGES = {
    "index.md": "---\ntitle: Home\n---\n\nWelcome home text.\n",
    "guides/start.md": "---\ntitle: Start\n---\n\nGuide start text.\n",
    "secret.md": "---\ntitle: Secret\n---\n\nSecret plans text.\n",
    "open.md": "---\ntitle: Open\npublic: true\n---\n\nOpen page text.\n",
}
AUTH = {"password": "env:DOCS_PASSWORD", "users": {"alice": "env:ALICE_PASSWORD"}, "public": ["/", "guides/*"]}


def _build(tmp_path: Path, auth: dict | None = AUTH, base: str | None = None) -> tuple[Path, Compiler]:
    for name, text in PAGES.items():
        (tmp_path / "docs" / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "docs" / name).write_text(text, encoding="utf-8")
    data = {"site": {"title": "Acme Docs"}, "style": "docs", "seo": {"siteUrl": "https://docs.acme.test"},
            "content": {"docs": {"dir": "docs", **({"auth": auth} if auth else {})}}}
    compiler = Compiler(Config.model_validate(data), base_path=tmp_path, url_base=base)
    result = compiler.compile(output_dir=tmp_path / "out")
    assert result.success, result.error
    return tmp_path / "out", compiler


@pytest.fixture
def site(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCS_PASSWORD", "shared-pass")
    monkeypatch.setenv("ALICE_PASSWORD", "alice-pass")
    out, _ = _build(tmp_path)
    from praisonaiui.cli import _static_site_app

    return TestClient(_static_site_app(out), base_url="http://localhost")


def _sign_in(client: TestClient, password: str) -> None:
    r = client.post("/__aiui/login", data={"password": password, "next": "/docs/secret"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/docs/secret"
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie


def test_signed_out_reader_gets_open_pages_and_the_sign_in_page(site):
    assert "Guide start text." in site.get("/docs/guides/start.md").text
    assert "Open page text." in site.get("/docs/open.source.md").text
    assert "Welcome home text." in site.get("/", headers=NAV).text
    page = site.get("/docs/secret", headers=NAV)
    assert page.status_code == 401 and "Secret plans" not in page.text
    assert 'name="password"' in page.text and 'value="/docs/secret"' in page.text
    for path in ("/docs/secret.md", "/docs/secret.source.md", "/docs/secret.html", "/docs/secret/index.html",
                 "/docs/Secret.md", "/docs//secret.md", "/docs/no-such-page", "/llms-full.txt", "/llms.txt",
                 "/aiui-access.json", "/AIUI-access.json"):
        r = site.get(path)
        assert r.status_code in (401, 404) and "Secret plans" not in r.text and "ALICE" not in r.text, path
    mcp = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_pages", "arguments": {}}}
    assert site.post("/mcp", json=mcp).status_code == 401
    assert site.get("/ui-config.json").status_code == 200


def test_indexes_hold_only_open_pages_for_a_signed_out_reader(site):
    pages = {p["p"] for p in site.get("/search-index.json").json()["pages"]}
    assert pages == {"/docs/index", "/docs/open", "/docs/guides/start"}
    assert pages == {p["p"] for p in site.get("/Search-Index.json").json()["pages"]}
    nav = site.get("/docs-nav.json")
    assert "/docs/open" in nav.text and "/docs/secret" not in nav.text
    assert nav.headers["cache-control"] == "private, no-cache"
    assert "/docs/secret" not in site.get("/sitemap.xml").text
    assert "/docs/open" in site.get("/sitemap.xml").text


def test_password_opens_every_page_and_sign_out_closes_them(site):
    _sign_in(site, "shared-pass")
    assert "Secret plans text." in site.get("/docs/secret.md").text
    assert site.get("/docs/secret.md").headers["cache-control"] == "private, no-cache"
    assert "/docs/secret" in {p["p"] for p in site.get("/search-index.json").json()["pages"]}
    assert "Secret plans text." in site.get("/llms-full.txt").text
    assert "Signed in as reader" in site.get("/__aiui/login").text
    out = site.post("/__aiui/logout", follow_redirects=False)
    assert out.status_code == 303 and "Max-Age=0" in out.headers["set-cookie"]
    site.cookies.clear()
    assert site.get("/docs/secret.md").status_code == 401
    _sign_in(site, "alice-pass")  # a named reader's own password
    assert "Signed in as alice" in site.get("/__aiui/login").text


def test_wrong_tampered_and_cross_site_attempts_are_refused(site):
    r = site.post("/__aiui/login", data={"password": "nope", "next": "//evil.test/x"})
    assert r.status_code == 401 and "not right" in r.text and 'value="/"' in r.text
    site.cookies.set("aiui_docs", "YWxpY2U.9999999999.deadbeef")
    assert site.get("/docs/secret.md").status_code == 401
    cross = site.post("/__aiui/login", data={"password": "shared-pass"}, headers={"Origin": "https://evil.test"})
    assert cross.status_code == 403
    for _ in range(9):
        site.post("/__aiui/login", data={"password": "nope"})
    assert site.post("/__aiui/login", data={"password": "shared-pass"}).status_code == 429


def test_next_after_sign_in_stays_on_the_site(site):
    r = site.post("/__aiui/login", data={"password": "shared-pass", "next": "https://evil.test"}, follow_redirects=False)
    assert r.headers["location"] == "/"


def test_base_path_build(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCS_PASSWORD", "shared-pass")
    out, _ = _build(tmp_path, base="/sub")
    from praisonaiui.cli import _static_site_app

    client = TestClient(_static_site_app(out), base_url="http://localhost")
    assert client.get("/sub/docs/secret.md").status_code == 401
    page = client.get("/sub/docs/secret", headers=NAV).text
    assert 'action="/sub/__aiui/login"' in page
    r = client.post("/sub/__aiui/login", data={"password": "shared-pass", "next": "/docs/secret"},
                    follow_redirects=False)
    assert r.headers["location"] == "/sub/docs/secret" and "Path=/sub" in r.headers["set-cookie"]
    assert "Secret plans" in client.get("/sub/docs/secret.md").text
    assert "/sub/docs/open" in client.get("/sub/llms.txt").text


def test_no_password_set_serves_only_open_pages(tmp_path, monkeypatch):
    monkeypatch.delenv("DOCS_PASSWORD", raising=False)
    monkeypatch.delenv("ALICE_PASSWORD", raising=False)
    out, _ = _build(tmp_path)
    from praisonaiui.cli import _static_site_app

    client = TestClient(_static_site_app(out), base_url="http://localhost")
    assert client.post("/__aiui/login", data={"password": ""}).status_code == 401
    assert client.get("/docs/secret.md").status_code == 401
    assert client.get("/docs/open.md").status_code == 200


def test_site_without_auth_is_unchanged(tmp_path):
    out, compiler = _build(tmp_path, auth=None)
    assert not (out / "aiui-access.json").exists()
    from praisonaiui.cli import _static_site_app

    client = TestClient(_static_site_app(out), base_url="http://localhost")
    assert "Secret plans" in client.get("/docs/secret.md").text
    issues = [i for i in compiler.lint_content() if i.code == 7017]
    assert [i.file for i in issues] == ["docs/open.md"]  # public: true without content.docs.auth


def test_config_and_build_checks(tmp_path, monkeypatch):
    with pytest.raises(ValidationError, match="env:NAME"):
        DocsAuthConfig(password="hunter2")
    with pytest.raises(ValidationError, match="set password"):
        DocsAuthConfig()
    with pytest.raises(ValidationError, match="env:NAME"):
        DocsAuthConfig(users={"bob": "hunter2"})
    assert DocsAuthConfig(users={"bob": "env:BOB_PW"}).readers() == [("bob", "BOB_PW")]
    out, compiler = _build(tmp_path, auth={**AUTH, "users": {}})
    access = json.loads((out / "aiui-access.json").read_text())
    assert "shared-pass" not in json.dumps(access) and "auth" not in json.loads((out / "ui-config.json").read_text())
    assert access["pages"]["/docs/secret"] is False and access["pages"]["/"] is True
    assert access["users"] == [{"name": "reader", "env": "DOCS_PASSWORD"}]
    result = compiler.compile(output_dir=out)
    assert any(w.startswith("7017:") for w in result.warnings)
