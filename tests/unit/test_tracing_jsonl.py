"""Tracing feature reads recorded runs from the context-trace JSONL directory.

The old SDKTracingManager looked up ``praisonaiagents.trace.list_traces`` /
``list_spans`` / ``get_trace``, which do not exist, so recorded runs never
showed up and it silently fell back to an empty in-memory store.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "replay"


@pytest.fixture()
def traces(tmp_path, monkeypatch):
    d = tmp_path / "traces"
    d.mkdir()
    for name in ("team_handoff", "flow_parallel_loop", "legacy_v10"):
        shutil.copy(FIXTURES / f"{name}.jsonl", d / f"{name}.jsonl")
    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(d))
    from praisonaiui.features import tracing

    monkeypatch.setattr(tracing, "_tracing_manager", None)
    return d


@pytest.fixture()
def client(traces):
    from praisonaiui.features.tracing import TracingFeature

    return TestClient(Starlette(routes=TracingFeature().routes()))


def test_recorded_runs_are_listed_as_traces(client):
    data = client.get("/api/traces").json()
    ids = {t["id"] for t in data["traces"]}
    assert {"team_handoff", "flow_parallel_loop", "legacy_v10"} <= ids
    team = next(t for t in data["traces"] if t["id"] == "team_handoff")
    assert team["source"] == "jsonl"
    assert team["name"] == "Solar sail brief"
    assert team["status"] == "completed"
    assert team["duration_ms"] == pytest.approx(12250, abs=1)
    assert team["span_count"] > 0
    assert team["metadata"]["session_id"] == "sess-team-01"


def test_agent_filter(client):
    data = client.get("/api/traces?agent_id=Checker").json()
    assert [t["id"] for t in data["traces"]] == ["legacy_v10"]


def test_spans_from_start_end_pairs_via_parent_seq(client):
    spans = client.get("/api/traces/spans?trace_id=team_handoff&limit=500").json()["spans"]
    kinds = {}
    for s in spans:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    assert kinds == {"session": 1, "workflow": 1, "llm": 5, "agent": 2, "task": 2, "tool": 4, "approval": 1}
    by_id = {s["id"]: s for s in spans}
    # tool span nests under the agent span that was open (parent_seq on the start)
    tool = next(s for s in spans if s["kind"] == "tool" and s["name"] == "write_file")
    parent = by_id[tool["parent_span_id"]]
    assert parent["kind"] == "agent" and parent["agent_id"] == "Writer"
    assert tool["status"] == "ok"
    assert tool["duration_ms"] == pytest.approx(50.0)
    assert tool["attributes"]["input"] == {"path": "docs/draft.md", "content": "[REDACTED]"}
    # approval pairs requested -> decided by parent_seq even though the decision has no agent
    appr = next(s for s in spans if s["kind"] == "approval")
    assert appr["status"] == "ok"
    assert appr["end_time"] == pytest.approx(1767225611.2)
    # every span closed
    assert all(s["status"] != "open" for s in spans)
    assert all(s["trace_id"] == "team_handoff" for s in spans)


def test_spans_for_legacy_file_fall_back_to_sequence_order(client):
    spans = client.get("/api/traces/spans?trace_id=legacy_v10").json()["spans"]
    by_id = {s["id"]: s for s in spans}
    names = [(s["kind"], s["agent_id"]) for s in spans]
    assert names == [
        ("session", ""),
        ("agent", "Assistant"),
        ("llm", "Assistant"),
        ("tool", "Assistant"),
        ("llm", "Assistant"),
        ("agent", "Checker"),
        ("llm", "Checker"),
    ]
    calc = next(s for s in spans if s["kind"] == "tool")
    assert by_id[calc["parent_span_id"]]["kind"] == "agent"
    assert by_id[calc["parent_span_id"]]["agent_id"] == "Assistant"
    checker_llm = spans[-1]
    assert by_id[checker_llm["parent_span_id"]]["agent_id"] == "Checker"
    assert all(s["status"] == "ok" for s in spans)


def test_parallel_branch_spans_pair_within_branch(client):
    spans = client.get("/api/traces/spans?trace_id=flow_parallel_loop&limit=500").json()["spans"]
    tools = {s["name"]: s for s in spans if s["kind"] == "tool"}
    assert tools["fetch_rss"]["duration_ms"] == pytest.approx(1250.0)
    assert tools["search_papers"]["duration_ms"] == pytest.approx(1840.0)
    assert tools["search_papers"]["attributes"]["branch_id"] == "gather/1"
    assert tools["search_papers"]["attributes"]["cost_usd"] == pytest.approx(0.001)


def test_get_trace_and_unknown(client):
    r = client.get("/api/traces/legacy_v10")
    assert r.status_code == 200
    body = r.json()
    assert body["trace"]["id"] == "legacy_v10"
    assert len(body["spans"]) == 7
    assert client.get("/api/traces/does-not-exist").status_code == 404
    assert client.get("/api/traces/../../etc/passwd").status_code == 404


def test_health_reports_source(client, tmp_path, monkeypatch):
    status = client.get("/api/traces/status").json()
    assert status["source"] == "jsonl"
    assert status["jsonl_traces"] == 3
    from praisonaiui.features import tracing

    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(tmp_path / "empty"))
    monkeypatch.setattr(tracing, "_tracing_manager", None)
    assert client.get("/api/traces/status").json()["source"] == "memory"


def test_recorded_in_memory_traces_still_work(client):
    r = client.post("/api/traces/record", json={"type": "trace", "id": "mem-1", "name": "manual"})
    assert r.status_code == 200
    ids = [t["id"] for t in client.get("/api/traces?limit=100").json()["traces"]]
    assert "mem-1" in ids and "team_handoff" in ids
    assert client.get("/api/traces/mem-1").json()["trace"]["name"] == "manual"


def test_no_dead_sdk_lookups_remain():
    src = (Path(__file__).resolve().parents[2] / "src" / "praisonaiui" / "features" / "tracing.py").read_text(encoding="utf-8")
    for dead in ('"list_traces", None', '"list_spans", None', '"get_trace", None', "trace_module"):
        assert dead not in src
    from praisonaiui.features.tracing import JsonlTracingManager, SDKTracingManager

    assert SDKTracingManager is JsonlTracingManager  # deprecated alias kept for imports


def test_cli_status_mentions_source(traces):
    from praisonaiui.features.tracing import TracingFeature

    out = TracingFeature()._cli_status()
    assert "Source: jsonl" in out
