"""Run Flight Recorder (STITCH-007) registration and wiring tests."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
VIEWS = FRONTEND / "views"


def test_run_recorder_view_file_exists():
    assert (VIEWS / "run-recorder.js").exists()


def test_runs_registered_in_builtin_views():
    source = (FRONTEND / "dashboard.js").read_text(encoding="utf-8")
    assert "runs:" in source
    assert "/plugins/views/run-recorder.js" in source


def test_merge_functions_present_in_view():
    source = (VIEWS / "run-recorder.js").read_text(encoding="utf-8")
    for fn in (
        "export function mergeTimelineEvents",
        "export function classifySpan",
        "export function correlateSpanLogs",
        "export function parseSessionIdFromUrl",
    ):
        assert fn in source, fn


def test_helpers_export_new_primitives():
    source = (VIEWS / "_helpers.js").read_text(encoding="utf-8")
    for fn in (
        "export function formatDuration",
        "export function emptyState",
        "export function traceStatusBadge",
        "export function timelineRow",
    ):
        assert fn in source, fn


def test_view_exports_render_and_cleanup():
    source = (VIEWS / "run-recorder.js").read_text(encoding="utf-8")
    assert "export async function render" in source
    assert "export function cleanup" in source
    assert "abort" in source.lower()


def test_traces_banner_links_to_runs():
    source = (VIEWS / "traces.js").read_text(encoding="utf-8")
    assert 'href="/runs"' in source
    assert "Run Flight Recorder" in source


def test_overview_activity_deep_links_to_runs():
    source = (VIEWS / "overview.js").read_text(encoding="utf-8")
    assert "/runs?session_id=" in source


def test_work_hub_debug_run_link():
    source = (VIEWS / "work-hub.js").read_text(encoding="utf-8")
    assert "/runs?session_id=" in source
    assert "Debug this run" in source


def test_open_in_chat_uses_session_select_event():
    source = (VIEWS / "run-recorder.js").read_text(encoding="utf-8")
    assert "aiui:session-select" in source


def test_runs_page_registered_in_server():
    from starlette.testclient import TestClient

    import praisonaiui as aiui
    import praisonaiui.server as server

    server.reset_state()
    aiui.set_style("dashboard")
    app = server.create_app()
    client = TestClient(app)
    resp = client.get("/api/pages")
    assert resp.status_code == 200
    pages = resp.json().get("pages") or []
    runs = next((p for p in pages if p.get("id") == "runs"), None)
    assert runs is not None
    assert runs["group"] == "Control"
    assert runs["order"] == 22
