"""Eval Quality Cockpit (STITCH-009) view + helper wiring tests.

Validates the client-side refactor of the Evaluation view into a regression
dashboard. No backend changes are expected — all trend/regression logic is
derived in JS from existing endpoints, so these tests assert the shipped view
source and that the eval APIs still expose the shapes the cockpit consumes.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
VIEWS = FRONTEND / "views"


def _eval_source() -> str:
    return (VIEWS / "eval.js").read_text(encoding="utf-8")


def _helpers_source() -> str:
    return (VIEWS / "_helpers.js").read_text(encoding="utf-8")


def test_eval_view_file_exists():
    assert (VIEWS / "eval.js").exists()


def test_helpers_export_cockpit_functions():
    src = _helpers_source()
    for fn in ("bucketByDay", "detectRegression", "trendArrow", "regressionBadge"):
        assert f"export function {fn}" in src, fn


def test_cockpit_title_and_zones():
    src = _eval_source()
    assert "Eval Quality Cockpit" in src
    assert "Suite Health" in src
    assert "Baseline Compare" in src
    assert "Run Eval" in src
    assert "Run History" in src


def test_cockpit_uses_helpers():
    src = _eval_source()
    assert "bucketByDay" in src
    assert "detectRegression" in src
    assert "sparklineSVG" in src
    assert "regressionBadge" in src


def test_cockpit_fault_tolerant_fetch():
    src = _eval_source()
    assert "Promise.allSettled" in src
    assert "/api/eval/status" in src
    assert "/api/eval/scores" in src
    assert "/api/eval?limit=" in src
    assert "/api/eval/judges" in src


def test_cockpit_run_posts_to_run_endpoint():
    src = _eval_source()
    assert "/api/eval/run" in src
    assert "method: 'POST'" in src


def test_cockpit_baseline_uses_localstorage():
    src = _eval_source()
    assert "aiui_eval_baseline_id" in src
    assert "aiui_eval_baseline_snapshot" in src
    assert "localStorage" in src


def test_cockpit_debug_link_falls_back_to_traces():
    src = _eval_source()
    assert "session_id" in src
    assert "/runs?session=" in src
    assert "'traces'" in src


def test_cockpit_escapes_case_content():
    src = _eval_source()
    assert "esc(" in src
    # eval content must never be raw-interpolated as innerHTML
    assert "esc((e.input" in src
    assert "esc((e.output" in src


def test_eval_still_registered_in_dashboard():
    src = (FRONTEND / "dashboard.js").read_text(encoding="utf-8")
    assert "/plugins/views/eval.js" in src


def test_eval_api_shapes_still_present():
    from starlette.testclient import TestClient

    import praisonaiui as aiui
    import praisonaiui.server as server

    server.reset_state()
    aiui.set_style("dashboard")
    app = server.create_app()
    client = TestClient(app)

    status = client.get("/api/eval/status")
    assert status.status_code == 200
    assert "sdk_available" in status.json()

    scores = client.get("/api/eval/scores")
    assert scores.status_code == 200
    assert "scores" in scores.json()

    evals = client.get("/api/eval?limit=200")
    assert evals.status_code == 200
    assert "evaluations" in evals.json()

    judges = client.get("/api/eval/judges")
    assert judges.status_code == 200
    assert "judges" in judges.json()

    run = client.post(
        "/api/eval/run",
        json={
            "agent_id": "researcher",
            "input": "2+2",
            "output": "4",
            "expected": "4",
            "score": 1.0,
            "passed": True,
        },
    )
    assert run.status_code == 200
    result = run.json().get("result", {})
    assert result.get("agent_id") == "researcher"
    assert result.get("score") == 1.0
