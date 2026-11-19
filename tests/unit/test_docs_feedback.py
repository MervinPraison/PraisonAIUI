"""Docs page feedback: the /api/docs/feedback endpoint of aiui serve, its store and ``aiui docs feedback``."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient
from typer.testing import CliRunner

from praisonaiui import docs_feedback as df
from praisonaiui.cli import _static_site_app, app
from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import (
    Config,
    ContentConfig,
    ContentSourceConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
)


def _site(tmp_path: Path) -> Path:
    """A two-page docs folder under ``tmp_path/docs``."""
    docs = tmp_path / "docs"
    (docs / "guide").mkdir(parents=True)
    (docs / "index.md").write_text("# Home\n", encoding="utf-8")
    (docs / "guide" / "first.md").write_text("# First\n", encoding="utf-8")
    return docs


def _build(tmp_path: Path, **docs_kwargs) -> tuple[dict, dict]:
    """Compile the docs site under ``tmp_path``; return (docs-nav.json, ui-config.json)."""
    config = Config(
        site=SiteConfig(title="Docs"),
        content=ContentConfig(docs=ContentSourceConfig(dir=str(tmp_path / "docs"), **docs_kwargs)),
        templates={"docs": TemplateConfig(layout="ThreeColumnLayout", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(out).success
    nav = json.loads((out / "docs-nav.json").read_text(encoding="utf-8"))
    ui = json.loads((out / "ui-config.json").read_text(encoding="utf-8"))
    return nav, ui

URL = "/api/docs/feedback"
SAME_ORIGIN = {"Origin": "http://testserver", "Content-Type": "application/json"}


@pytest.fixture
def store(tmp_path, monkeypatch) -> Path:
    file = tmp_path / "data" / "feedback.jsonl"
    monkeypatch.setattr(df, "store_path", lambda: file)
    return file


def _client(tmp_path: Path, page_footer: dict | None = None, docs: bool = True) -> TestClient:
    """aiui serve on a minimal build (a docs build has docs-nav.json)."""
    out = tmp_path / "out"
    out.mkdir(parents=True)
    (out / "index.html").write_text("<!doctype html><title>x</title>", encoding="utf-8")
    config = {"site": {"title": "Acme Docs"}, **({"pageFooter": page_footer} if page_footer else {})}
    (out / "ui-config.json").write_text(json.dumps(config), encoding="utf-8")
    if docs:
        (out / "docs-nav.json").write_text('{"items": []}', encoding="utf-8")
    return TestClient(_static_site_app(out))


def test_a_vote_then_its_comment_is_one_record(tmp_path, store):
    client = _client(tmp_path)
    assert client.get(URL).json() == {"enabled": True}
    vote_id = client.post(URL, json={"path": "/docs/guide/install", "value": -1}, headers=SAME_ORIGIN).json()["id"]
    comment = {"id": vote_id, "path": "/docs/guide/install", "value": -1, "comment": "  The pip line fails\x00 "}
    assert client.post(URL, json=comment, headers=SAME_ORIGIN).json() == {"ok": True, "id": vote_id}
    client.post(URL, json={"path": "/docs/guide/install", "value": 1}, headers=SAME_ORIGIN)
    client.post(URL, json={"path": "/docs", "kind": "code", "block": 2, "value": -1}, headers=SAME_ORIGIN)

    assert len(store.read_text().splitlines()) == 4  # append-only; the comment replaces its vote
    records = df.load()
    first = records[0]
    assert len(records) == 3
    assert (first["id"], first["comment"], first["site"], first["source"]) == (vote_id, "The pip line fails", "Acme Docs", "reader")
    assert df.by_page(records) == [
        {"path": "/docs", "yes": 0, "no": 0, "code": 1, "comments": 0},
        {"path": "/docs/guide/install", "yes": 1, "no": 1, "code": 0, "comments": 1},
    ]


@pytest.mark.parametrize("body", [
    {"path": "docs/x", "value": 1}, {"path": "/docs/x", "value": 2}, {"path": "/docs/x", "value": True},
    {"path": "/docs/x", "value": 1, "kind": "chat"}, {"path": "/docs/x", "value": 1, "kind": "code"},
    {"path": "/docs/x", "value": 1, "comment": 5}, {"path": "/" + "x" * 600, "value": 1}, ["/docs/x", 1],
])
def test_bad_bodies_are_refused(tmp_path, store, body):
    r = _client(tmp_path).post(URL, json=body, headers=SAME_ORIGIN)
    assert r.status_code == 400 and "error" in r.json()
    assert not store.exists()


def test_guards(tmp_path, store):
    client = _client(tmp_path)
    vote = {"path": "/docs/x", "value": 1}
    assert client.post(URL, json=vote, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post(URL, content="path=/docs", headers={**SAME_ORIGIN, "Content-Type": "application/x-www-form-urlencoded"}).status_code == 415
    assert client.post(URL, content=json.dumps({**vote, "comment": "x" * 5000}), headers=SAME_ORIGIN).status_code == 413
    assert client.put(URL, json=vote).status_code == 405
    # text/plain (no CORS preflight) is accepted, and the comment is capped
    r = client.post(URL, content=json.dumps({**vote, "comment": "y" * 1500}), headers={**SAME_ORIGIN, "Content-Type": "text/plain"})
    assert r.status_code == 200 and len(df.load()[0]["comment"]) == df.MAX_COMMENT


def test_rate_limit_and_full_store(tmp_path, store, monkeypatch):
    client = _client(tmp_path)
    vote = {"path": "/docs/x", "value": 1}
    codes = [client.post(URL, json=vote, headers=SAME_ORIGIN).status_code for _ in range(df.RATE_LIMIT + 1)]
    assert codes[:-1] == [200] * df.RATE_LIMIT and codes[-1] == 429

    monkeypatch.setattr(df, "MAX_STORE_BYTES", store.stat().st_size)
    client = _client(tmp_path / "again")
    assert client.post(URL, json=vote, headers=SAME_ORIGIN).status_code == 507


def test_off_when_turned_off_or_not_a_docs_build(tmp_path, store):
    for i, kw in enumerate([{"page_footer": {"feedback": False}}, {"docs": False}]):
        client = _client(tmp_path / str(i), **kw)
        assert client.get(URL).headers["content-type"].startswith("text/html")  # the SPA page, no endpoint
        client.post(URL, json={"path": "/docs", "value": 1}, headers=SAME_ORIGIN)
    assert not store.exists()


def test_csv_export_quotes_formulas(tmp_path, store):
    df.append(df.clean({"path": "/docs/a", "value": -1, "comment": "=HYPERLINK(\"http://x\")"}, "Acme"))
    df.append(df.clean({"path": "/docs/b", "value": 1}, "Other"))
    result = CliRunner().invoke(app, ["docs", "feedback", "--format", "csv", "--site", "acme"])
    assert result.exit_code == 0, result.output
    rows = list(csv.DictReader(io.StringIO(result.output)))
    assert [(r["path"], r["value"], r["comment"]) for r in rows] == [("/docs/a", "-1", "'=HYPERLINK(\"http://x\")")]

    out = tmp_path / "votes.json"
    assert CliRunner().invoke(app, ["docs", "feedback", "-f", "json", "-o", str(out)]).exit_code == 0
    assert len(json.loads(out.read_text())) == 2
    assert "2 votes" in CliRunner().invoke(app, ["docs", "feedback"]).output


def test_config_reaches_the_page_footer(tmp_path):
    _site(tmp_path)
    _, ui = _build(tmp_path, feedback={"endpoint": "https://hooks.example.com/docs", "code": True})
    assert ui["pageFooter"] == {"feedback": {"endpoint": "https://hooks.example.com/docs", "code": True}}
    _site(tmp_path / "off")
    _, ui = _build(tmp_path / "off", feedback=False)
    assert ui["pageFooter"] == {"feedback": False}
    _site(tmp_path / "on")
    _, ui = _build(tmp_path / "on", feedback=True)
    assert "pageFooter" not in ui  # zero config: the server stores votes
    with pytest.raises(ValidationError):
        ContentSourceConfig(dir="docs", feedback={"endpoint": "javascript:alert(1)"})
