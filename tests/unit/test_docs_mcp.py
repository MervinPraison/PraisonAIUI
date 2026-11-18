"""The docs MCP server on ``aiui serve`` / ``aiui dev`` (docs_mcp.py,
docs/features/ai-ready-docs.md#mcp-server): JSON-RPC over POST /mcp, the three
tools, the server card, the llms.txt and ui-config.json entries, the
``content.docs.mcp: false`` switch and the Host / Origin checks."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
import yaml
from starlette.testclient import TestClient

from praisonaiui.cli import _static_site_app
from praisonaiui.compiler.compiler import Compiler
from praisonaiui.docs_mcp import DocsMcp, search, stem, term_match
from praisonaiui.schema.models import Config

DOCS = {
    "index.md": "---\ntitle: Home\n---\n# Home\n\nWelcome to Acme.\n",
    "guide/install.md": "---\ntitle: Install\ndescription: Get Acme running.\n---\n# Install\n\n"
    "## Using pip\n\nRun pip install acme to get the package.\n\n## Upgrading\n\nNewer releases.\n",
    "guide/themes.md": "---\ntitle: Themes\nkeywords: [colours]\n---\n# Themes\n\nPick a preset theme.\n",
}


def _build(tmp_path: Path, extra: str = "") -> Path:
    for rel, text in DOCS.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    config = Config.model_validate(
        yaml.safe_load(f"site: {{title: Acme Docs}}\ncontent:\n  docs:\n    dir: docs\n{extra}")
    )
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def _rpc(client: TestClient, method: str, params: dict | None = None, rid: int = 1):
    body = {"jsonrpc": "2.0", "id": rid, "method": method, **({"params": params} if params else {})}
    return client.post("/mcp", json=body, headers={"Accept": "application/json, text/event-stream"})


def _call(client: TestClient, name: str, args: dict) -> dict:
    res = _rpc(client, "tools/call", {"name": name, "arguments": args})
    assert res.status_code == 200
    return res.json()["result"]


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(_static_site_app(_build(tmp_path)))


def test_initialize_negotiates_the_version_and_lists_read_only_tools(client: TestClient) -> None:
    res = _rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                      "clientInfo": {"name": "t", "version": "1"}})
    result = res.json()["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["serverInfo"]["name"] == "acme-docs" and result["capabilities"] == {"tools": {"listChanged": False}}
    old = _rpc(client, "initialize", {"protocolVersion": "1999-01-01"}).json()["result"]
    assert old["protocolVersion"] == "2025-11-25"
    note = client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert note.status_code == 202 and note.content == b""
    assert _rpc(client, "ping").json()["result"] == {}
    tools = _rpc(client, "tools/list").json()["result"]["tools"]
    assert [t["name"] for t in tools] == ["search_docs", "read_page", "list_pages"]
    assert all(t["annotations"]["readOnlyHint"] for t in tools)


def test_search_docs_ranks_like_the_search_dialog(client: TestClient) -> None:
    text = _call(client, "search_docs", {"query": "how do I pip install"})["content"][0]["text"]
    assert text.startswith("1. Install > Using pip\n   path: /docs/guide/install#using-pip\n")
    assert "url: http://testserver/docs/guide/install#using-pip" in text
    # title before text, keywords match, typos and stems forgiven
    assert _call(client, "search_docs", {"query": "install"})["content"][0]["text"].startswith("1. Install\n")
    assert "1. Themes" in _call(client, "search_docs", {"query": "colours"})["content"][0]["text"]
    assert "Using pip" in _call(client, "search_docs", {"query": "pakage", "limit": 3})["content"][0]["text"]
    none = _call(client, "search_docs", {"query": "zebra"})
    assert none["isError"] is False and "No pages match" in none["content"][0]["text"]
    assert _call(client, "search_docs", {"query": ""})["isError"] is True
    assert _call(client, "search_docs", {"query": "pip", "limit": "5"})["isError"] is True
    assert stem("themes") == stem("theming") and term_match("instal", "install") == 0.7


def test_read_page_takes_a_path_or_url_and_stays_in_the_site(client: TestClient) -> None:
    for path in ("/docs/guide/install", "docs/guide/install.md", "http://x/docs/guide/install/#using-pip"):
        result = _call(client, "read_page", {"path": path})
        assert result["isError"] is False and result["content"][0]["text"].startswith("# Install\n\n> Get Acme running.")
    assert _call(client, "read_page", {"path": "/"})["content"][0]["text"].startswith("# Home")
    for bad in ("/docs/nope", "/../../etc/passwd", "/ui-config.json", ""):
        assert _call(client, "read_page", {"path": bad})["isError"] is True
    pages = _call(client, "list_pages", {})["content"][0]["text"]
    assert pages.startswith("# Acme Docs") and "/docs/guide/install.md" in pages


def test_json_rpc_errors(client: TestClient) -> None:
    assert _rpc(client, "nope").json()["error"]["code"] == -32601
    assert _rpc(client, "tools/call", {"name": "write_file"}).json()["error"]["code"] == -32602
    bad = client.post("/mcp", content=b"{", headers={"Content-Type": "application/json"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == -32700
    assert client.post("/mcp", json=[{"jsonrpc": "2.0", "id": 1, "method": "ping"}]).json()["error"]["code"] == -32600
    assert client.post("/mcp", content=b"x", headers={"Content-Type": "text/plain"}).status_code == 415
    big = client.post("/mcp", content=b"[" + b" " * 70_000 + b"]", headers={"Content-Type": "application/json"})
    assert big.status_code == 413
    assert client.get("/mcp").status_code == 405 and client.get("/mcp").headers["allow"] == "POST"
    old = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                      headers={"MCP-Protocol-Version": "1999-01-01"})
    assert old.status_code == 400


def test_discovery_card_llms_and_ui_config(client: TestClient) -> None:
    card = client.get("/.well-known/mcp").json()
    assert card["transport"] == {"type": "streamable-http", "url": "http://testserver/mcp"}
    assert [t["name"] for t in card["tools"]] == ["search_docs", "read_page", "list_pages"]
    assert client.get("/.well-known/mcp.json").json() == client.get("/.well-known/mcp/server-card.json").json() == card
    for path in ("/llms.txt", "/.well-known/llms.txt"):
        llms = client.get(path).text
        assert llms.endswith("## MCP server\n\n- [Acme Docs MCP server](http://testserver/mcp): search and read "
                             "these docs from an AI tool (Streamable HTTP, read-only)\n")
    config = client.get("/ui-config.json").json()
    assert config["mcp"] == {"url": "/mcp", "name": "acme-docs"} and config["site"]["title"] == "Acme Docs"
    assert client.get("/docs/guide/install").headers["content-type"].startswith("text/html")


def test_off_with_content_docs_mcp_false_and_on_a_static_host(tmp_path: Path) -> None:
    out = _build(tmp_path, "    mcp: false\n")
    # The static files carry no MCP: a static host serves the build as it is.
    assert json.loads((out / "ui-config.json").read_text())["mcp"] is False
    assert "MCP server" not in (out / "llms.txt").read_text() and not (out / ".well-known" / "mcp").exists()
    client = TestClient(_static_site_app(out))
    assert client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code != 200
    assert client.get("/.well-known/mcp").status_code == 404
    assert client.get("/ui-config.json").json()["mcp"] is False
    assert "MCP server" not in client.get("/llms.txt").text


def _asgi(app, method: str, path: str, headers: dict, body: bytes = b"") -> int:
    """Call ``app`` as a server on 127.0.0.1 (the address DNS rebinding targets); its status."""
    scope = {"type": "http", "method": method, "path": path, "raw_path": path.encode(), "query_string": b"",
             "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()], "scheme": "http",
             "server": ("127.0.0.1", 8000), "client": ("127.0.0.1", 5000), "http_version": "1.1", "root_path": ""}
    sent: list[dict] = []

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent[0]["status"]


def test_host_and_origin_checks(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("AIUI_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv("AIUI_ALLOWED_ORIGINS", raising=False)
    app = _static_site_app(_build(tmp_path))
    ping = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}).encode()
    json_ct = {"content-type": "application/json"}
    assert _asgi(app, "POST", "/mcp", {"host": "127.0.0.1:8000", **json_ct}, ping) == 200
    assert _asgi(app, "POST", "/mcp", {"host": "evil.example", **json_ct}, ping) == 400
    assert _asgi(app, "GET", "/.well-known/mcp", {"host": "evil.example"}) == 400
    cross = {"host": "127.0.0.1:8000", "origin": "https://evil.example", "sec-fetch-site": "cross-site", **json_ct}
    assert _asgi(app, "POST", "/mcp", cross, ping) == 403
    monkeypatch.setenv("AIUI_ALLOWED_HOSTS", "docs.acme.dev")
    assert _asgi(app, "POST", "/mcp", {"host": "docs.acme.dev", **json_ct}, ping) == 200


def test_search_order_and_index_reload(tmp_path: Path) -> None:
    out = _build(tmp_path)
    mcp = DocsMcp.for_site(out)
    assert mcp is not None
    index = json.loads((out / "search-index.json").read_text())
    hits = search(index, "pip install")
    assert [h["anchor"] for h in hits][:1] == ["using-pip"] and all(h["score"] > 0 for h in hits)
    assert DocsMcp.for_site(tmp_path / "docs") is None  # not a build


def test_official_mcp_client_connects(tmp_path: Path) -> None:
    """The reference Python SDK lists and calls the tools over Streamable HTTP, in process."""
    mcp_client = pytest.importorskip("mcp.client.streamable_http")
    httpx2 = pytest.importorskip("httpx2")
    if not hasattr(mcp_client, "streamable_http_client"):
        pytest.skip("this mcp SDK has no streamable_http_client(http_client=)")
    from mcp import Client

    app = _static_site_app(_build(tmp_path))

    async def run() -> tuple[list[str], str]:
        http = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://127.0.0.1")
        transport = mcp_client.streamable_http_client("http://127.0.0.1/mcp", http_client=http)
        async with Client(transport) as c:
            tools = [t.name for t in (await c.list_tools()).tools]
            page = await c.call_tool("read_page", {"path": "/docs/guide/install"})
            return tools, page.content[0].text

    tools, text = asyncio.run(run())
    assert tools == ["search_docs", "read_page", "list_pages"] and text.startswith("# Install")
