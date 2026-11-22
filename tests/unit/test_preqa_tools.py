"""tools/preqa: budgets, history parsing, the report and notifications (stdlib only)."""

import json
import sys
from pathlib import Path

PREQA = Path(__file__).resolve().parents[2] / "tools" / "preqa"
sys.path.insert(0, str(PREQA))

from preqa import budgets, history, notify, report, stats  # noqa: E402

BUDGETS = {
    "defaults": {
        "nav_ms.p95": {"max": 1000},
        "held_requests": {"max": 0},
        "bytes.js": {"max": 500},
        "pages_ok": {"min": 1},
        "docs_load_problems": {"max": 0, "required": False},
    },
    "targets": {"prod": {"nav_ms.p95": {"max": 2000}, "bytes.js": None}},
}


def run(target="preqa", ts="2026-11-22T10:00:00Z", **metrics):
    m = {"nav_ms": {"p95": 100}, "held_requests": 0, "bytes": {"js": 100}, "pages_ok": 1, **metrics}
    breaches = budgets.compare(m, BUDGETS, target)
    return {"ts": ts, "target": target, "sha": "abc12345ff", "metrics": m, "breaches": breaches,
            "status": "FAIL" if breaches else "PASS", "pages": {}, "issues": {}}


def test_percentile_nearest_rank():
    assert stats.percentile([], 95) is None
    assert stats.percentile([5], 95) == 5
    assert stats.percentile(range(1, 101), 95) == 95
    assert stats.summarize([3, 1, 2]) == {"n": 3, "p50": 2, "p95": 3, "max": 3}
    assert stats.summarize([None]) == {"n": 0}


def test_budgets_pass_and_breach():
    assert budgets.compare(run()["metrics"], BUDGETS, "preqa") == []
    m = run(nav_ms={"p95": 1500}, held_requests=2, pages_ok=0)["metrics"]
    got = {(b["metric"], b["kind"]) for b in budgets.compare(m, BUDGETS, "preqa")}
    assert got == {("nav_ms.p95", "max"), ("held_requests", "max"), ("pages_ok", "min")}


def test_budgets_missing_metric_fails_unless_optional():
    m = {"nav_ms": {"p95": 1}, "bytes": {"js": 1}, "pages_ok": 1}  # no held_requests, no docs_load
    assert [b["metric"] for b in budgets.compare(m, BUDGETS, "preqa")] == ["held_requests"]
    assert budgets.describe(budgets.compare(m, BUDGETS, "preqa")[0]) == "held_requests: not measured"


def test_budgets_target_override_and_removal():
    m = run(nav_ms={"p95": 1500}, bytes={"js": 9999})["metrics"]
    assert budgets.compare(m, BUDGETS, "prod") == []
    assert len(budgets.compare(m, BUDGETS, "preqa")) == 2


def test_history_append_and_parse(tmp_path):
    history.append(tmp_path, run(ts="2026-11-22T10:00:00Z"))
    history.append(tmp_path, run(target="prod", ts="2026-10-01T10:00:00Z"))
    with open(tmp_path / "runs-2026-11.jsonl", "a") as f:
        f.write("{not json\n\n" + json.dumps({"no": "target"}) + "\n")
    history.append(tmp_path, run(ts="2026-11-22T11:00:00Z", held_requests=3))
    errors = []
    runs = history.load_runs(tmp_path, errors)
    assert [r["ts"][:13] for r in runs] == ["2026-10-01T10", "2026-11-22T10", "2026-11-22T11"]
    assert len(errors) == 2
    latest = history.latest_by_target(runs)
    assert latest["preqa"]["status"] == "FAIL" and latest["prod"]["status"] == "PASS"
    assert history.load_runs(tmp_path / "missing") == []


def test_report_status_trends_and_issues(tmp_path):
    now = history.utc_now()
    bad = run(ts=now, held_requests=1)
    bad["issues"] = {"held": [{"flow": "nav", "url": "/x.source.md", "ms": 1500}]}
    bad["pages"] = {"/": {"cold_p95": 900}, "/slow": {"cold_p95": 3000}}
    for r in (run(ts="2026-11-01T00:00:00Z"), run(target="prod", ts=now), bad):
        history.append(tmp_path / "h", r)
    rep = report.write(tmp_path / "h", tmp_path / "dash")
    assert rep["status"] == "FAIL" and rep["runs"] == 3
    assert [p[1] for p in rep["trends"]["held_requests"]["preqa"]] == [0, 1]
    assert rep["slowest"][0]["path"] == "/slow"
    assert rep["issues"][0]["kind"] == "held" and rep["issues"][0]["url"] == "/x.source.md"
    assert json.loads((tmp_path / "dash" / "report.json").read_text())["status"] == "FAIL"
    assert (tmp_path / "dash" / "index.html").is_file()
    assert report.build([])["status"] == "NO DATA"


def test_notify_once_per_new_failure(tmp_path, monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    failing = [run(held_requests=2), run(target="prod")]
    assert notify.run(tmp_path, failing) == ["preqa: held_requests = 2 > 0"]
    assert notify.run(tmp_path, failing) == []  # still failing: no second message
    assert notify.run(tmp_path, [run(target="prod")]) == []  # other target: preqa state kept
    assert notify.run(tmp_path, [run()]) == []  # recovered
    assert len(notify.run(tmp_path, failing)) == 1  # broke again: new message
    lines = (tmp_path / "notifications.jsonl").read_text().splitlines()
    assert len(lines) == 2 and json.loads(lines[0])["slack"] is False
