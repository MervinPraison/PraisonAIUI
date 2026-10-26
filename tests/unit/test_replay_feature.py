"""PraisonAI Replay feature: runs listing, events, SSE tail, safety (contract v1 §1, §5)."""

from __future__ import annotations

import json
import shutil
import threading
import time
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "replay"
NAMES = ("team_handoff", "flow_parallel_loop", "legacy_v10")


def _lines(name: str) -> list[str]:
    return (FIXTURES / f"{name}.jsonl").read_text(encoding="utf-8").splitlines(keepends=True)


@pytest.fixture()
def traces(tmp_path, monkeypatch):
    d = tmp_path / "traces"
    d.mkdir()
    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(d))
    monkeypatch.delenv("PRAISON_HOME", raising=False)
    return d


@pytest.fixture()
def isolated_server(tmp_path, monkeypatch):
    """create_app() writes a config store; keep it out of the developer's home."""
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path / "aiui-data"))
    monkeypatch.setenv("PRAISONAI_HOME", str(tmp_path / "praisonai-home"))


@pytest.fixture()
def feature():
    from praisonaiui.features.replay import ReplayFeature

    f = ReplayFeature()
    f.poll_interval = 0.02
    f.ping_interval = 0.15
    f.quiet_period = 0.3
    return f


@pytest.fixture()
def client(feature):
    app = Starlette(routes=feature.routes())
    return TestClient(app)


def _copy_all(d: Path) -> None:
    for name in NAMES:
        dst = d / f"{name}.jsonl"
        shutil.copy(FIXTURES / f"{name}.jsonl", dst)


# ── traces dir resolution ────────────────────────────────────────────


def test_traces_dir_precedence(tmp_path, monkeypatch):
    from praisonaiui.features import _trace_jsonl as tj

    monkeypatch.delenv("PRAISONAI_TRACES_DIR", raising=False)
    monkeypatch.delenv("PRAISON_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    assert tj.traces_dir() == tmp_path / "home" / ".praison" / "traces"
    monkeypatch.setenv("PRAISON_HOME", str(tmp_path / "ph"))
    assert tj.traces_dir() == tmp_path / "ph" / "traces"
    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(tmp_path / "explicit"))
    assert tj.traces_dir() == tmp_path / "explicit"


# ── /api/replay/runs ─────────────────────────────────────────────────


def test_runs_lists_fixtures_newest_first(traces, client):
    _copy_all(traces)
    r = client.get("/api/replay/runs")
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    by_id = {row["run_id"]: row for row in rows}
    assert set(by_id) == set(NAMES)
    # newest first by started_at
    started = [row["started_at"] for row in rows]
    assert started == sorted(started, reverse=True)

    team = by_id["team_handoff"]
    assert team["session_id"] == "sess-team-01"
    assert team["kind"] == "team"
    assert team["name"] == "Solar sail brief"
    assert team["status"] == "completed"
    assert team["live"] is False
    assert team["events"] == 36
    assert team["agents"] == ["Manager", "Researcher", "Writer"]
    assert team["cost_usd"] == pytest.approx(0.006741, abs=1e-9)
    assert team["ended_at"] == pytest.approx(1767225612.25)
    assert team["path"].endswith("team_handoff.jsonl")
    assert team["event_run_id"] == "team-handoff-01"

    legacy = by_id["legacy_v10"]  # schema 1.0: no workflow_start, still listed
    assert legacy["kind"] == "session"
    assert legacy["status"] == "completed"
    assert legacy["schema_version"] == "1.0"
    assert legacy["agents"] == ["Assistant", "Checker"]
    assert legacy["events"] == 16


def test_runs_empty_or_missing_dir(tmp_path, monkeypatch, client):
    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(tmp_path / "nope"))
    r = client.get("/api/replay/runs")
    assert r.status_code == 200
    assert r.json() == []


def test_run_without_end_marker_is_live(traces, client):
    lines = _lines("team_handoff")
    (traces / "half.jsonl").write_text("".join(lines[:20]), encoding="utf-8")
    row = client.get("/api/replay/runs").json()[0]
    assert row["run_id"] == "half"
    assert row["live"] is True
    assert row["status"] == "running"
    assert "ended_at" not in row


def test_ignores_non_jsonl_and_unsafe_names(traces, client):
    _copy_all(traces)
    (traces / "notes.txt").write_text("x", encoding="utf-8")
    (traces / "bad name.jsonl").write_text(_lines("legacy_v10")[0], encoding="utf-8")
    ids = {row["run_id"] for row in client.get("/api/replay/runs").json()}
    assert ids == set(NAMES)


# ── /api/replay/runs/{id}/events ─────────────────────────────────────


def test_events_and_graph(traces, client):
    _copy_all(traces)
    data = client.get("/api/replay/runs/team_handoff/events").json()
    assert len(data["events"]) == 36
    assert data["graph"]["schema"] == "praisonai.graph/1"
    assert data["graph"]["process"] == "hierarchical"
    assert data["run"]["run_id"] == "team_handoff"
    legacy = client.get("/api/replay/runs/legacy_v10/events").json()
    assert legacy["graph"] is None
    assert len(legacy["events"]) == 16


def test_events_after_seq(traces, client):
    _copy_all(traces)
    data = client.get("/api/replay/runs/team_handoff/events?after_seq=30").json()
    assert [e["sequence_num"] for e in data["events"]] == [31, 32, 33, 34, 35]
    # graph still comes from the (earlier) workflow_start
    assert data["graph"] is not None
    assert client.get("/api/replay/runs/team_handoff/events?after_seq=-1").json()["events"][0]["sequence_num"] == 0
    assert client.get("/api/replay/runs/team_handoff/events?after_seq=abc").status_code == 400


def test_unknown_event_types_and_fields_pass_through(traces, client):
    _copy_all(traces)
    events = client.get("/api/replay/runs/flow_parallel_loop/events").json()["events"]
    odd = [e for e in events if e["event_type"] == "context_rebalance"]
    assert len(odd) == 1
    assert odd[0]["future_field"] == {"x": 1}


def test_partial_last_line_ignored_until_complete(traces, client):
    lines = _lines("legacy_v10")
    path = traces / "growing.jsonl"
    last = lines[-1]
    path.write_text("".join(lines[:-1]) + last[:25], encoding="utf-8")
    first = client.get("/api/replay/runs/growing/events").json()["events"]
    assert len(first) == 15  # half-written session_end is not surfaced
    assert first[-1]["event_type"] == "agent_end"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(last[25:])
    second = client.get("/api/replay/runs/growing/events").json()["events"]
    assert len(second) == 16
    assert second[-1]["event_type"] == "session_end"


def test_complete_last_line_without_newline_is_read(traces, client):
    text = "".join(_lines("legacy_v10")).rstrip("\n")
    (traces / "nonl.jsonl").write_text(text, encoding="utf-8")
    events = client.get("/api/replay/runs/nonl/events").json()["events"]
    assert len(events) == 16


def test_garbage_lines_are_skipped(traces, client):
    lines = _lines("legacy_v10")
    (traces / "dirty.jsonl").write_text(lines[0] + "not json\n[1,2]\n\n" + "".join(lines[1:]), encoding="utf-8")
    assert len(client.get("/api/replay/runs/dirty/events").json()["events"]) == 16


# ── safety ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "run_id",
    ["..", ".", "a b", "a;b", "%2e%2e", "..%2Fsecret", "x%00y", "ü"],
)
def test_path_traversal_ids_rejected(traces, client, run_id):
    secret = traces.parent / "secret.jsonl"
    secret.write_text(_lines("legacy_v10")[0], encoding="utf-8")
    for suffix in ("events", "stream"):
        r = client.get(f"/api/replay/runs/{run_id}/{suffix}")
        assert r.status_code in (400, 404), (run_id, suffix, r.status_code)
        assert "legacy-sess-10" not in r.text


def test_run_path_validation_unit(tmp_path):
    from praisonaiui.features import _trace_jsonl as tj

    assert tj.run_path("../etc/passwd", tmp_path) is None
    assert tj.run_path("..", tmp_path) is None
    assert tj.run_path("a/b", tmp_path) is None
    assert tj.run_path("ok-run_1.2", tmp_path) == tmp_path / "ok-run_1.2.jsonl"


def test_symlink_escaping_dir_is_rejected(traces, client, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    target = outside / "x.jsonl"
    target.write_text(_lines("legacy_v10")[0], encoding="utf-8")
    link = traces / "sneaky.jsonl"
    try:
        link.symlink_to(target)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable")
    assert client.get("/api/replay/runs/sneaky/events").status_code == 400


def test_unknown_run_is_404(traces, client):
    assert client.get("/api/replay/runs/nope/events").status_code == 404
    assert client.get("/api/replay/runs/nope/stream").status_code == 404


# ── SSE stream ───────────────────────────────────────────────────────


def _parse_sse(text: str) -> list[tuple[str, str, str | None]]:
    out = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        name, data, ident = "message", [], None
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
            elif line.startswith("id:"):
                ident = line[3:].strip()
        if data or name != "message":
            out.append((name, "\n".join(data), ident))
    return out


def test_stream_tails_appended_lines(traces, client, monkeypatch):
    """Lines written while the stream is open (including one written in two
    halves) arrive exactly once, in order; the stream ends after session_end."""
    from praisonaiui.features import _trace_jsonl as tj

    monkeypatch.setattr(tj, "LIVE_WINDOW_S", 8)  # safety net: never hang the suite
    lines = _lines("team_handoff")
    path = traces / "live-run.jsonl"
    path.write_text("".join(lines[:10]), encoding="utf-8")

    def writer():
        time.sleep(0.15)
        for i, line in enumerate(lines[10:]):
            with open(path, "a", encoding="utf-8") as fh:
                if i == 5:  # a line split across two writes
                    fh.write(line[:30])
                    fh.flush()
                    time.sleep(0.08)
                    fh.write(line[30:])
                else:
                    fh.write(line)
            time.sleep(0.01)

    t = threading.Thread(target=writer, daemon=True)
    t.start()
    started = time.monotonic()
    with client.stream("GET", "/api/replay/runs/live-run/stream") as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    elapsed = time.monotonic() - started
    t.join(timeout=5)

    msgs = _parse_sse(body)
    ctx = [json.loads(d) for name, d, _ in msgs if name == "ctx"]
    assert [e["sequence_num"] for e in ctx] == list(range(36))
    assert [ident for name, _, ident in msgs if name == "ctx"] == [str(i) for i in range(36)]
    assert msgs[-1][0] == "end"
    assert any(name == "ping" for name, _, _ in msgs)
    assert elapsed < 7, "stream should end shortly after session_end + quiet period"


def test_stream_after_seq_and_last_event_id(traces, client):
    shutil.copy(FIXTURES / "legacy_v10.jsonl", traces / "done.jsonl")
    with client.stream("GET", "/api/replay/runs/done/stream?after_seq=12") as r:
        body = "".join(r.iter_text())
    seqs = [json.loads(d)["sequence_num"] for n, d, _ in _parse_sse(body) if n == "ctx"]
    assert seqs == [13, 14, 15]
    # reconnect: Last-Event-ID beats an older after_seq in the URL
    with client.stream("GET", "/api/replay/runs/done/stream?after_seq=2", headers={"Last-Event-ID": "14"}) as r:
        body = "".join(r.iter_text())
    seqs = [json.loads(d)["sequence_num"] for n, d, _ in _parse_sse(body) if n == "ctx"]
    assert seqs == [15]


def test_stream_ends_for_stale_unfinished_file(traces, client, monkeypatch):
    from praisonaiui.features import _trace_jsonl as tj

    monkeypatch.setattr(tj, "LIVE_WINDOW_S", 0.4)
    (traces / "stale.jsonl").write_text("".join(_lines("team_handoff")[:5]), encoding="utf-8")
    with client.stream("GET", "/api/replay/runs/stale/stream") as r:
        body = "".join(r.iter_text())
    msgs = _parse_sse(body)
    assert len([m for m in msgs if m[0] == "ctx"]) == 5
    assert msgs[-1][0] == "end" and "stale" in msgs[-1][1]


def test_stream_restarts_when_file_is_truncated(tmp_path):
    from praisonaiui.features import _trace_jsonl as tj

    path = tmp_path / "r.jsonl"
    lines = _lines("legacy_v10")
    path.write_text("".join(lines), encoding="utf-8")
    tail = tj.TailReader(path)
    assert len(tail.poll()) == 16
    path.write_text(lines[0], encoding="utf-8")  # writer restarted the file
    again = tail.poll()
    assert len(again) == 1 and again[0]["sequence_num"] == 0


# ── registration / entry point ───────────────────────────────────────


def test_feature_registered_by_default():
    from praisonaiui.features import auto_register_defaults, get_feature

    auto_register_defaults()
    f = get_feature("replay")
    assert f is not None
    paths = {r.path for r in f.routes()}
    assert paths == {
        "/api/replay/runs",
        "/api/replay/runs/{run_id}/events",
        "/api/replay/runs/{run_id}/stream",
    }


def test_replay_page_and_routes_mounted_in_server(traces, isolated_server):
    import praisonaiui as aiui
    import praisonaiui.server as server

    _copy_all(traces)
    server.reset_state()
    aiui.set_style("dashboard")
    app = server.create_app()
    c = TestClient(app)
    pages = c.get("/api/pages").json()["pages"]
    page = next((p for p in pages if p["id"] == "replay"), None)
    assert page is not None
    assert page["title"] == "Replay"
    assert page["group"] == "Control"
    assert page["api_endpoint"] == "/api/replay/runs"
    assert len(c.get("/api/replay/runs").json()) == 3
    assert c.get("/plugins/views/replay.js").status_code == 200
    assert c.get("/plugins/views/replay-core.js").status_code == 200


def test_replay_app_whitelists_replay_first(traces, isolated_server):
    import praisonaiui.server as server
    from praisonaiui.features.replay import REPLAY_PAGES, configure_replay_app

    server.reset_state()
    configure_replay_app()
    try:
        app = server.create_app()
        pages = TestClient(app).get("/api/pages").json()["pages"]
        builtin = [p["id"] for p in pages if p["id"] in REPLAY_PAGES]
        assert builtin[0] == "replay"
        assert set(builtin) == set(REPLAY_PAGES)
        assert "chat" not in {p["id"] for p in pages}
    finally:
        server.reset_state()


def test_replay_app_module_is_importable_and_documented():
    import importlib

    src = (Path(__file__).resolve().parents[2] / "src" / "praisonaiui" / "replay_app.py").read_text(encoding="utf-8")
    assert "aiui run" in src and "/replay?run=" in src
    import praisonaiui.server as server

    try:
        importlib.import_module("praisonaiui.replay_app")
        assert server.get_style() == "dashboard"
    finally:
        server.reset_state()


def test_cli_list(traces, feature):
    _copy_all(traces)
    out = feature._cli_list()
    assert "team_handoff" in out and "Solar sail brief" in out


# ── standalone export helper ─────────────────────────────────────────


def test_standalone_html_is_self_contained():
    from praisonaiui.features.replay import standalone_html

    events = [json.loads(line) for line in _lines("team_handoff")]
    events[3]["data"]["evil"] = "</script><script>alert(1)</script>"
    html = standalone_html(events, title="Run <1>")
    assert html.count("<script") == 3  # data + core + view, nothing injected
    assert "</script><script>alert" not in html
    assert "window.__REPLAY_DATA__" in html
    assert "export function buildModel" in html and "export async function render" in html
    assert "<title>Run &lt;1&gt;</title>" in html
    for banned in ("http://", "https://", "cdn"):
        # SVG namespace URI is a name, not a fetch
        assert banned not in html.replace("http://www.w3.org/2000/svg", ""), banned
    # graph is picked up from workflow_start when not passed
    payload = html.split("window.__REPLAY_DATA__ = ", 1)[1].split(";</script>", 1)[0]
    data = json.loads(payload)
    assert data["graph"]["schema"] == "praisonai.graph/1"
    assert len(data["events"]) == 36
