"""Docs sign-in: front matter groups, and llms files, MCP, Ask AI, search and feedback per reader."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from praisonaiui.compiler import Compiler
from praisonaiui.schema.models import Config, DocsAuthConfig

NAV = {"Accept": "text/html", "Sec-Fetch-Mode": "navigate"}
PAGES = {
    "index.md": "---\ntitle: Home\n---\n\nWelcome home text.\n",
    "open.md": "---\ntitle: Open\npublic: true\n---\n\nOpen page text.\n",
    "secret.md": "---\ntitle: Secret\n---\n\nSecret plans text.\n",
    "team.md": "---\ntitle: Team\ngroups: [team-a]\n---\n\nTeam only text.\n",
}
AUTH = {"password": "env:DOCS_PASSWORD", "users": {"alice": {"password": "env:ALICE_PASSWORD", "groups": ["team-a"]}},
        "public": ["/"]}


def _build(tmp_path, auth=AUTH):
    for name, text in PAGES.items():
        (tmp_path / "docs").mkdir(exist_ok=True)
        (tmp_path / "docs" / name).write_text(text, encoding="utf-8")
    data = {"site": {"title": "Acme Docs"}, "style": "docs", "content": {"docs": {"dir": "docs", "auth": auth}}}
    compiler = Compiler(Config.model_validate(data), base_path=tmp_path)
    assert compiler.compile(output_dir=tmp_path / "out").success
    return tmp_path / "out", compiler


@pytest.fixture
def site(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCS_PASSWORD", "shared-pass")
    monkeypatch.setenv("ALICE_PASSWORD", "alice-pass")
    from praisonaiui.cli import _static_site_app

    return TestClient(_static_site_app(_build(tmp_path)[0]), base_url="http://localhost")


def _sign_in(client, password):
    assert client.post("/__aiui/login", data={"password": password}, follow_redirects=False).status_code == 303


def _mcp(client, tool, **args):
    msg = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}}
    return client.post("/mcp", json=msg).json()["result"]


def test_signed_out_agents_and_search_see_only_open_pages(site):
    for name in ("/llms.txt", "/.well-known/llms.txt", "/llms-full.txt"):
        text = site.get(name).text
        assert "Open" in text and "Secret" not in text and "Team" not in text, name
    assert "## MCP server" in site.get("/llms.txt").text
    assert _mcp(site, "read_page", path="/docs/secret")["isError"] is True
    assert "Open page text." in _mcp(site, "read_page", path="/docs/open")["content"][0]["text"]
    assert "Secret" not in _mcp(site, "list_pages")["content"][0]["text"]
    assert "/docs/secret" not in _mcp(site, "search_docs", query="secret plans")["content"][0]["text"]
    assert "/docs/secret" not in site.get("/api/docs/search?q=secret plans").text
    assert site.post("/api/docs/feedback", json={"path": "/docs/secret", "value": 1}).status_code == 404
    assert site.post("/api/docs/feedback", json={"path": "/docs/open", "value": 1}).status_code == 200


def test_a_group_page_is_a_404_to_readers_outside_the_group(site):
    assert site.get("/docs/team", headers=NAV).status_code == 401  # signed out: they may be a member
    _sign_in(site, "shared-pass")
    assert "Secret plans text." in site.get("/docs/secret.md").text
    for path in ("/docs/team.md", "/docs/Team.source.md", "/docs/team/"):
        assert site.get(path).status_code == 404, path
    assert site.get("/docs/team", headers=NAV).status_code == 404
    assert "/docs/team" not in site.get("/docs-nav.json").text
    assert "/docs/team" not in {p["p"] for p in site.get("/search-index.json").json()["pages"]}
    assert "Team only" not in site.get("/llms-full.txt").text
    assert _mcp(site, "read_page", path="/docs/team")["isError"] is True


def test_a_group_member_reads_the_group_page(site):
    _sign_in(site, "alice-pass")
    assert "Team only text." in site.get("/docs/team.md").text
    assert "Team only text." in site.get("/llms-full.txt").text
    assert "Team only text." in _mcp(site, "read_page", path="/docs/team")["content"][0]["text"]


def test_groups_config_and_checks(tmp_path):
    readers = DocsAuthConfig.model_validate(AUTH).readers()
    assert readers == [("reader", "DOCS_PASSWORD", []), ("alice", "ALICE_PASSWORD", ["team-a"])]
    out, compiler = _build(tmp_path, {**AUTH, "users": {"bob": "env:BOB"}})
    assert '"/docs/team": ["team-a"]' in (out / "aiui-access.json").read_text()
    issues = [i for i in compiler.lint_content() if i.code == 7017]
    assert [(i.file, i.message) for i in issues] == [("docs/team.md", "no reader is in group team-a")]
