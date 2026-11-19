"""The docs MCP server's ``submit_feedback`` tool (docs_mcp.py, docs/features/ai-ready-docs.md#mcp-server):
listed with the site's own feedback store, saved like a reader's vote with ``source: agent``, under the
same per-client rate limit and size caps as ``/api/docs/feedback``, and hidden when feedback is off or
posted to an external ``endpoint``."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from starlette.testclient import TestClient

from praisonaiui import docs_feedback as df
from praisonaiui.cli import _static_site_app
from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config

DOCS = {
    "index.md": "---\ntitle: Home\n---\n# Home\n\nWelcome.\n",
    "guide/install.md": "---\ntitle: Install\n---\n# Install\n\nRun pip install acme.\n",
}


def _client(tmp_path: Path, extra: str = "") -> TestClient:
    for rel, text in DOCS.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    config = Config.model_validate(
        yaml.safe_load(f"site: {{title: Acme Docs}}\ncontent:\n  docs:\n    dir: docs\n{extra}")
    )
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return TestClient(_static_site_app(out))


def _rpc(client: TestClient, method: str, params: dict | None = None) -> dict:
    res = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": method, **({"params": params} if params else {})})
    assert res.status_code == 200
    return res.json()


def _submit(client: TestClient, **args) -> dict:
    return _rpc(client, "tools/call", {"name": "submit_feedback", "arguments": args})["result"]


@pytest.fixture
def store(tmp_path: Path, monkeypatch) -> Path:
    file = tmp_path / "data" / "feedback.jsonl"
    monkeypatch.setattr(df, "store_path", lambda: file)
    return file


def test_the_tool_is_listed_and_not_read_only(tmp_path: Path, store: Path) -> None:
    client = _client(tmp_path)
    tool = next(t for t in _rpc(client, "tools/list")["result"]["tools"] if t["name"] == "submit_feedback")
    assert tool["inputSchema"]["required"] == ["path", "helpful"]
    assert set(tool["inputSchema"]["properties"]) == {"path", "helpful", "comment"}
    assert "readOnlyHint" not in tool["annotations"] and tool["annotations"]["destructiveHint"] is False
    assert "submit_feedback" in [t["name"] for t in client.get("/.well-known/mcp").json()["tools"]]
    assert "submit_feedback" in _rpc(client, "initialize")["result"]["instructions"]


def test_a_report_is_stored_like_a_readers_vote(tmp_path: Path, store: Path) -> None:
    client = _client(tmp_path)
    result = _submit(client, path="http://testserver/docs/guide/install.md#run", helpful=False,
                     comment="The pip step\x00 is missing the extra.")
    assert result["isError"] is False and "/docs/guide/install" in result["content"][0]["text"]
    assert _submit(client, path="/docs/guide/install", helpful=True)["isError"] is False
    first, second = df.load()
    assert first["path"] == "/docs/guide/install" and first["value"] == -1 and first["kind"] == "page"
    assert first["comment"] == "The pip step is missing the extra." and first["source"] == "agent"
    assert first["site"] == "Acme Docs" and second["value"] == 1 and second["comment"] == ""
    assert df.by_page(df.load())[0] == {"path": "/docs/guide/install", "yes": 1, "no": 1, "code": 0, "comments": 1}


@pytest.mark.parametrize("args, error", [
    ({"helpful": True}, "needs the page's path"),
    ({"path": "/docs/guide/install", "helpful": "no"}, "helpful must be true or false"),
    ({"path": "/docs/nope", "helpful": False}, "No page at /docs/nope"),
    ({"path": "/docs/guide/install", "helpful": False, "comment": 42}, "comment must be text"),
    ({"path": "/docs/guide/install", "helpful": False, "comment": "x" * 5000}, "too large"),
])
def test_bad_reports_are_refused_and_nothing_is_stored(tmp_path: Path, store: Path, args: dict, error: str) -> None:
    result = _submit(_client(tmp_path), **args)
    assert result["isError"] is True and error in result["content"][0]["text"]
    assert df.load() == []


def test_the_rate_limit_is_shared_with_the_http_endpoint(tmp_path: Path, store: Path) -> None:
    client = _client(tmp_path)
    vote = {"path": "/docs/guide/install", "value": 1}
    headers = {"Origin": "http://testserver", "Content-Type": "application/json"}
    for _ in range(df.RATE_LIMIT - 1):
        assert client.post(df.ENDPOINT, json=vote, headers=headers).status_code == 200
    assert _submit(client, path="/docs/guide/install", helpful=True)["isError"] is False
    refused = _submit(client, path="/docs/guide/install", helpful=False)
    assert refused["isError"] is True and "try again in a minute" in refused["content"][0]["text"]
    assert client.post(df.ENDPOINT, json=vote, headers=headers).status_code == 429
    assert len(df.load()) == df.RATE_LIMIT


@pytest.mark.parametrize("extra", [
    "    feedback: false\n",
    "    feedback: {endpoint: 'https://example.com/votes'}\n",
    "    feedback: {endpoint: false}\n",
])
def test_hidden_when_feedback_is_off_or_posted_elsewhere(tmp_path: Path, store: Path, extra: str) -> None:
    client = _client(tmp_path, extra)
    tools = [t["name"] for t in _rpc(client, "tools/list")["result"]["tools"]]
    assert tools == ["search_docs", "read_page", "list_pages"]
    assert _rpc(client, "tools/call", {"name": "submit_feedback", "arguments": {
        "path": "/docs/guide/install", "helpful": False}})["error"]["code"] == -32602
    assert "read-only" in client.get("/llms.txt").text and df.load() == []
