"""Opt-in docs load telemetry: the /api/docs/telemetry endpoint of aiui serve, its store and ``aiui docs telemetry``."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient
from typer.testing import CliRunner

from praisonaiui import docs_telemetry as dt
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

URL = "/api/docs/telemetry"
SAME_ORIGIN = {"Origin": "http://testserver", "Content-Type": "text/plain;charset=UTF-8"}
RETRY = {"v": 1, "type": "aiui:docs-load", "url": "/docs/api/sessions.source.md?x=1#h", "kind": "doc",
         "attempt": 1, "of": 3, "ms": 3001, "outcome": "retry", "reason": "headers-timeout", "at": 5,
         "page": "/docs/api/sessions?utm=me", "userId": "u-1", "ip": "1.2.3.4"}
OK = {"url": "/docs/api/sessions.source.md", "kind": "doc", "attempt": 2, "of": 3, "ms": 120, "outcome": "ok",
      "status": 200, "sampled": True}


@pytest.fixture
def store(tmp_path, monkeypatch) -> Path:
    file = tmp_path / "data" / "telemetry.jsonl"
    monkeypatch.setattr(dt, "store_path", lambda: file)
    return file


def _client(tmp_path: Path, telemetry=None, docs: bool = True, **extra) -> TestClient:
    """aiui serve on a minimal build; ``telemetry``: the ui-config.json ``telemetry`` entry (None: absent)."""
    out = tmp_path / "out"
    out.mkdir(parents=True)
    (out / "index.html").write_text("<!doctype html><title>x</title>", encoding="utf-8")
    config = {"site": {"title": "Acme Docs"}, **({"telemetry": telemetry} if telemetry is not None else {}), **extra}
    (out / "ui-config.json").write_text(json.dumps(config), encoding="utf-8")
    if docs:
        (out / "docs-nav.json").write_text('{"items": []}', encoding="utf-8")
    return TestClient(_static_site_app(out))


def _post(client, body, headers=SAME_ORIGIN):
    return client.post(URL, content=json.dumps(body), headers=headers)


def test_records_are_stored_without_anything_personal(tmp_path, store):
    client = _client(tmp_path, {})
    assert client.get(URL).json() == {"enabled": True}
    r = _post(client, {"records": [RETRY, OK]}, {**SAME_ORIGIN, "X-Forwarded-For": "9.9.9.9", "User-Agent": "Secret/1"})
    assert r.status_code == 200 and r.json() == {"ok": True, "stored": 2}
    text = store.read_text()
    for private in ("testclient", "1.2.3.4", "9.9.9.9", "u-1", "Secret", "utm", "x=1"):
        assert private not in text
    first, second = dt.load()
    assert set(first) == set(dt.FIELDS)
    assert (first["url"], first["page"], first["outcome"], first["reason"], first["site"]) == (
        "/docs/api/sessions.source.md", "/docs/api/sessions", "retry", "headers-timeout", "Acme Docs")
    assert (second["sampled"], second["status"]) == (True, 200)


@pytest.mark.parametrize("body", [
    {}, {"records": []}, {"records": "x"}, {"records": [{**OK, "url": "docs/x"}]},
    {"records": [{**OK, "url": "//evil.example/x"}]}, {"records": [{**OK, "kind": "chat"}]},
    {"records": [{**OK, "outcome": "great"}]}, {"records": [{**OK, "ms": -1}]}, {"records": [{**OK, "ms": True}]},
    {"records": [{**OK, "attempt": 99}]}, {"records": [{**OK, "reason": "<script>"}]},
    {"records": [{**OK, "status": 42}]}, {"records": [OK] * (dt.MAX_RECORDS + 1)}, [1],
])
def test_bad_bodies_are_refused(tmp_path, store, body):
    r = _post(_client(tmp_path, {}), body)
    assert r.status_code == 400 and "error" in r.json()
    assert not store.exists()


def test_guards(tmp_path, store):
    client = _client(tmp_path, {})
    body = {"records": [OK]}
    assert _post(client, body, {"Origin": "https://evil.example", "Content-Type": "text/plain"}).status_code == 403
    assert _post(client, body, {**SAME_ORIGIN, "Content-Type": "application/x-www-form-urlencoded"}).status_code == 415
    big = {"records": [{**OK, "detail": "x" * 200}] * 49, "pad": "y" * dt.MAX_BODY_BYTES}
    assert _post(client, big).status_code == 413
    assert client.put(URL, json=body).status_code == 405
    assert _post(client, body, {**SAME_ORIGIN, "Content-Type": "application/json"}).status_code == 200


def test_rate_limit_and_full_store(tmp_path, store, monkeypatch):
    client = _client(tmp_path, {})
    codes = [_post(client, {"records": [OK]}).status_code for _ in range(dt.RATE_LIMIT + 1)]
    assert codes[:-1] == [200] * dt.RATE_LIMIT and codes[-1] == 429
    monkeypatch.setattr(dt, "MAX_STORE_BYTES", store.stat().st_size)
    assert _post(_client(tmp_path / "again", {}), {"records": [OK]}).status_code == 507


@pytest.mark.parametrize("kw", [{}, {"telemetry": {"endpoint": "https://collect.example.com/t"}}, {"telemetry": {}, "docs": False}],
                         ids=["off-by-default", "own-endpoint", "not-a-docs-build"])
def test_no_endpoint_unless_opted_in(tmp_path, store, kw):
    client = _client(tmp_path, **kw)
    assert client.get(URL).headers["content-type"].startswith("text/html")  # the SPA page, no endpoint
    _post(client, {"records": [OK]})
    assert not store.exists()
    assert "docsTelemetry" not in client.get("/ui-config.json").json()


@pytest.mark.parametrize("extra", [{}, {"mcp": False}, {"mcp": False, "assistant": False},
                                   {"mcp": False, "assistant": False, "pageFooter": {"feedback": False}}],
                         ids=["mcp-serves-config", "assistant-serves-config", "telemetry-serves-config", "no-feedback"])
def test_served_config_names_the_endpoint(tmp_path, extra):
    """Only a server that stores records says so: the page never probes, so a static host gets nothing."""
    config = _client(tmp_path, {}, **extra).get("/ui-config.json")
    assert config.headers["cache-control"] == "no-cache"
    data = config.json()
    assert data["docsTelemetry"] == {"url": URL}
    assert data["site"] == {"title": "Acme Docs"}
    if "pageFooter" not in extra:
        assert data["docsFeedback"] == {"url": "/api/docs/feedback"}  # votes still announced


def _build(tmp_path: Path, **docs_kwargs) -> dict:
    docs = tmp_path / "docs"
    docs.mkdir(parents=True)
    (docs / "index.md").write_text("# Home\n", encoding="utf-8")
    config = Config(
        site=SiteConfig(title="Docs"),
        content=ContentConfig(docs=ContentSourceConfig(dir=str(docs), **docs_kwargs)),
        templates={"docs": TemplateConfig(layout="ThreeColumnLayout", slots={})},
        routes=[RouteConfig(match="/docs/**", template="docs")],
    )
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(out).success
    return json.loads((out / "ui-config.json").read_text(encoding="utf-8"))


def test_built_config(tmp_path):
    assert "telemetry" not in _build(tmp_path / "a")  # off by default: nothing is ever sent
    assert _build(tmp_path / "b", telemetry=True)["telemetry"] == {}
    own = _build(tmp_path / "c", telemetry={"endpoint": "https://collect.example.com/t", "sampleRate": 0.5})
    assert own["telemetry"] == {"endpoint": "https://collect.example.com/t", "sampleRate": 0.5}
    assert "docsTelemetry" not in own
    with pytest.raises(ValidationError):
        ContentSourceConfig(dir="docs", telemetry={"endpoint": "javascript:alert(1)"})
    with pytest.raises(ValidationError):
        ContentSourceConfig(dir="docs", telemetry={"sampleRate": 2})


def test_cli_lists_and_filters(tmp_path, store):
    client = _client(tmp_path, {})
    _post(client, {"records": [RETRY, OK, {**OK, "url": "/docs-nav.json", "kind": "manifest", "ms": 40}]})
    runner = CliRunner()
    table = runner.invoke(app, ["docs", "telemetry"], env={"COLUMNS": "200"})
    assert table.exit_code == 0 and "sessions.source.md" in table.output and "headers-timeout" in table.output
    problems = json.loads(runner.invoke(app, ["docs", "telemetry", "--format", "json", "--outcome", "problems"]).output)
    assert [r["outcome"] for r in problems] == ["retry"]
    assert len(json.loads(runner.invoke(app, ["docs", "telemetry", "-f", "json", "--since", "1h"]).output)) == 3
    assert json.loads(runner.invoke(app, ["docs", "telemetry", "-f", "json", "--since", "2999-01-01"]).output) == []
    csv_out = runner.invoke(app, ["docs", "telemetry", "-f", "csv"]).output
    assert csv_out.splitlines()[0] == ",".join(dt.FIELDS)
    assert runner.invoke(app, ["docs", "telemetry", "--outcome", "nope"]).exit_code != 0
    rows = dt.by_url(dt.load())
    assert rows[0]["url"] == "/docs/api/sessions.source.md" and rows[0]["problems"] == 1 and rows[0]["p50_ms"] in (120, 3001)


def test_empty_store_and_since_parsing(tmp_path, store):
    out = CliRunner().invoke(app, ["docs", "telemetry"]).output
    assert "No load records yet" in out
    now = datetime(2026, 1, 2, tzinfo=timezone.utc)
    assert dt.parse_since("1d", now) == datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert dt.parse_since("2026-01-01T00:00:00", now).tzinfo is not None
