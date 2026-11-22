"""``python -m preqa <command>`` (run from tools/preqa). Exit 0 PASS, 1 FAIL, 2 error.

    serve   serve a built site GitHub-Pages-style, dashboard at /preqa/
    build   build a ref (main, a branch, pr/<n>) into $PREQA_HOME/sites/<name>
    poll    build main when origin/main moved, then track (the 5-minute timer)
    track   run the checks against targets, append history, report, notify
    report  rewrite report.json from the history
"""

from __future__ import annotations

import argparse
import fcntl
import json
import sys
from contextlib import contextmanager
from pathlib import Path

from . import budgets, history, notify, report, serve, site

HERE = Path(__file__).resolve().parent.parent
DEFAULT_TARGETS = ["preqa=http://127.0.0.1:8700", "prod=https://ui.praison.ai"]


@contextmanager
def locked():
    """One build or track at a time on a host (timers can overlap)."""
    site.home().mkdir(parents=True, exist_ok=True)
    with open(site.home() / ".lock", "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        yield


def _summary(records: list[dict]) -> str:
    lines = []
    for r in records:
        if r["status"] == "FAIL":
            lines.append(f"FAILED {r['target']} ({r.get('sha', '')[:8]}): "
                         + "; ".join([budgets.describe(b) for b in r.get("breaches", [])]
                                     + ([r["error"]] if r.get("error") else [])))
    for r in records:
        m = r.get("metrics", {})
        get = lambda k: budgets.lookup(m, k)
        lines.append(
            f"{r['status']} {r['target']} {r.get('sha', '')[:8]} cold p95 {get('first_content_cold_ms.p95')} ms,"
            f" warm p95 {get('first_content_warm_ms.p95')}, nav p95 {get('nav_ms.p95')}, reload p95"
            f" {get('reload_ms.p95')}, skeleton max {get('skeleton_max_ms')}, held {get('held_requests')},"
            f" stalled {get('stalled_requests')}, failed {get('failed_requests')}, console {get('console_errors')},"
            f" js {get('bytes.js')} B ({r.get('duration_s')} s)")
    return "\n".join(lines)


def cmd_track(a) -> int:
    from . import track  # imports Playwright lazily

    targets = dict(t.split("=", 1) for t in (a.target or DEFAULT_TARGETS))
    b = budgets.load(a.budgets)
    with locked():
        records = track.track(targets, b, pages=a.pages, runs=a.runs, fail_fast=a.fail_fast)
        return _finish(a, records)


def _finish(a, records: list[dict]) -> int:
    if a.history:
        for r in records:
            history.append(a.history, r)
        report.write(a.history, a.report or Path(a.history).parent / "dashboard")
        if not a.no_notify:
            notify.run(a.history, records, a.report_url)
    if a.out:
        Path(a.out).write_text(json.dumps(records, indent=1), encoding="utf-8")
    print(_summary(records), flush=True)
    return 1 if any(r["status"] == "FAIL" for r in records) else 0


def cmd_poll(a) -> int:
    sha = site.remote_sha(a.ref)
    if sha and sha == site.current(site.name_for(a.ref)).get("sha") and not a.force:
        return 0
    with locked():
        rec = site.build(a.ref)
    print(json.dumps(rec), flush=True)
    if not rec.get("ok"):
        fail = {"ts": history.utc_now(), "target": "preqa", "sha": rec.get("sha", sha), "status": "FAIL",
                "error": f"build failed: {rec.get('error', '')[-300:]}", "metrics": {}, "breaches": []}
        return _finish(a, [fail])
    return cmd_track(a) if a.track else 0


def main(argv=None) -> int:
    home = site.home()
    p = argparse.ArgumentParser(prog="preqa", description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve", add_help=False)
    sub.add_parser("netfault", add_help=False)
    b = sub.add_parser("build")
    b.add_argument("--ref", default="main")
    for name in ("track", "poll"):
        t = sub.add_parser(name)
        t.add_argument("--target", action="append", help="name=url (repeat); default pre-QA and production")
        t.add_argument("--budgets", default=str(HERE / "budgets.json"))
        t.add_argument("--pages", nargs="*", help="paths to load (default: track.PAGES)")
        t.add_argument("--runs", type=int, default=3)
        t.add_argument("--fail-fast", action="store_true", help="stop a target at its first breach")
        t.add_argument("--history", default=str(home / "history"), help="'' to keep no history")
        t.add_argument("--report", help="dashboard dir (default: <history>/../dashboard)")
        t.add_argument("--report-url", default="http://127.0.0.1:8700/preqa/")
        t.add_argument("--no-notify", action="store_true")
        t.add_argument("--out", help="also write this run's records to a JSON file")
        if name == "poll":
            t.add_argument("--ref", default="main")
            t.add_argument("--track", action="store_true", help="run the checks after a new build")
            t.add_argument("--force", action="store_true", help="build even if the sha is unchanged")
    r = sub.add_parser("report")
    r.add_argument("--history", default=str(home / "history"))
    r.add_argument("--out", default=str(home / "dashboard"))
    a, rest = p.parse_known_args(argv)
    if a.cmd == "serve":
        serve.main(rest)
        return 0
    if a.cmd == "netfault":
        from . import netfault

        return netfault.main(rest)
    if rest:
        p.error(f"unrecognized arguments: {' '.join(rest)}")
    if a.cmd == "build":
        with locked():
            rec = site.build(a.ref)
        print(json.dumps(rec))
        return 0 if rec.get("ok") else 1
    if a.cmd == "report":
        rep = report.write(a.history, a.out)
        print(f"{rep['status']}: {rep['runs']} runs -> {a.out}/report.json")
        return 0
    return cmd_poll(a) if a.cmd == "poll" else cmd_track(a)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(2)
