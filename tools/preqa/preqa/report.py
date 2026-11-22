"""Turn the run history into ``report.json`` for the dashboard (``dashboard/index.html``)."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import history
from . import telemetry as field

# Metrics drawn as trends on the dashboard (dotted paths into run["metrics"]).
TREND_METRICS = [
    "first_content_cold_ms.p95",
    "first_content_warm_ms.p95",
    "nav_ms.p95",
    "reload_ms.p95",
    "hover_nav_ms.p95",
    "back_forward_ms.p95",
    "rapid_final_ms.p95",
    "two_tabs_ms.p95",
    "search_query_ms.p95",
    "skeleton_max_ms",
    "held_requests",
    "stalled_requests",
    "failed_requests",
    "console_errors",
    "bytes.js",
    "bytes.css",
    "bytes.font",
    "bytes.json",
]
DASHBOARD = Path(__file__).resolve().parent.parent / "dashboard" / "index.html"


def _get(metrics: dict, key: str):
    cur = metrics
    for part in key.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur if isinstance(cur, (int, float)) else None


def build(runs: list[dict], max_points: int = 300, issue_days: int = 7) -> dict:
    latest = history.latest_by_target(runs)
    trends: dict[str, dict[str, list]] = {m: {} for m in TREND_METRICS}
    for rec in runs[-max_points * max(1, len(latest)) :]:
        for m in TREND_METRICS:
            v = _get(rec.get("metrics", {}), m)
            if v is not None:
                trends[m].setdefault(rec["target"], []).append([rec["ts"], v, rec.get("sha", "")[:8]])
    slowest = []
    for target, rec in latest.items():
        for path, page in (rec.get("pages") or {}).items():
            slowest.append({"target": target, "path": path, **{k: page.get(k) for k in ("cold_p95", "warm_p95", "reload_p95")}})
    slowest.sort(key=lambda r: -(r.get("cold_p95") or 0))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=issue_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    issues = []
    for rec in runs:
        if rec["ts"] < cutoff:
            continue
        for kind in ("held", "stalled", "failed", "skeleton", "timeouts", "console"):
            for item in (rec.get("issues") or {}).get(kind, []):
                issues.append({"ts": rec["ts"], "target": rec["target"], "sha": rec.get("sha", "")[:8], "kind": kind, **item})
    issues.sort(key=lambda r: r["ts"], reverse=True)
    status = "PASS" if latest and all(r.get("status") == "PASS" for r in latest.values()) else "FAIL"
    if not latest:
        status = "NO DATA"
    return {
        "generated": history.utc_now(),
        "status": status,
        "latest": {
            t: {k: r.get(k) for k in ("ts", "status", "sha", "base", "breaches", "metrics", "build", "error")}
            for t, r in latest.items()
        },
        "trends": trends,
        "slowest": slowest[:25],
        "issues": issues[:500],
        "runs": len(runs),
    }


def write(history_dir: str | Path, out_dir: str | Path, telemetry: list[Path] | None = None) -> dict:
    errors: list[str] = []
    report = build(history.load_runs(history_dir, errors))
    report["history_errors"] = errors[-20:]
    # Readers' load records (opt-in content.docs.telemetry), when a store exists: preqa/telemetry.py
    report["telemetry"] = field.summary(telemetry if telemetry is not None else field.default_paths(Path(history_dir).parent))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "report.json.tmp"
    tmp.write_text(json.dumps(report, separators=(",", ":")), encoding="utf-8")
    tmp.replace(out / "report.json")
    if DASHBOARD.is_file():
        shutil.copyfile(DASHBOARD, out / "index.html")
    return report
