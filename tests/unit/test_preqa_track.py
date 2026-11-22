"""tools/preqa track: issue counting and the repo budgets file (no browser needed)."""

import sys
from pathlib import Path

PREQA = Path(__file__).resolve().parents[2] / "tools" / "preqa"
sys.path.insert(0, str(PREQA))

from preqa import budgets  # noqa: E402
from preqa.track import Collector  # noqa: E402  (Playwright is imported only when a run starts)


def test_repo_budgets_file_names_real_metrics():
    """Every key in tools/preqa/budgets.json is one the tracker produces (no typos)."""
    col = Collector({}, {})
    for name in ("first_content_cold_ms", "first_content_warm_ms", "reload_ms", "nav_ms", "hover_nav_ms",
                 "back_forward_ms", "rapid_final_ms", "two_tabs_ms", "search_open_ms", "search_query_ms"):
        col.add(name, 10)
    col.bytes["/"] = {"bytes": {k: 1 for k in ("js", "css", "font", "json", "md", "html", "total")},
                      "requests": {k: 1 for k in ("js", "css", "font", "json", "md", "total")}}
    data = budgets.load(PREQA / "budgets.json")
    assert budgets.compare(col.metrics(), data, "preqa") == []
    assert budgets.compare(col.metrics(), data, "prod") == []


def test_collector_counts_issues_and_ignores():
    col = Collector({"console": ["favicon"]}, {})
    col.issue("console", flow="x", text="GET /favicon.ico 404")
    col.issue("console", flow="x", text="TypeError: boom")
    col.issue("held", flow="x", url="/a.md", ms=1200)
    col.docs_load += [{"ms": 50, "outcome": "ok"}, {"ms": 9000, "outcome": "timeout"}]
    m = col.metrics()
    assert (m["console_errors"], m["held_requests"], m["skeleton_max_ms"]) == (1, 1, 0)
    assert (m["docs_load_events"], m["docs_load_problems"], m["docs_load_ms"]["max"]) == (2, 1, 9000)


def test_inline_pages_are_not_docs_load_problems():
    """A page whose Markdown was inlined in its HTML is the best case, not a problem (failed main after #584)."""
    col = Collector({}, {})
    col.docs_load += [{"outcome": "inline", "ms": 0}, {"outcome": "ok", "ms": 5}, {"console": "aiui:docs-load ..."}]
    assert col.metrics()["docs_load_problems"] == 0
    for bad in ("retry", "failed", "inline-mismatch", "duplicate"):
        col.docs_load.append({"outcome": bad, "ms": 1})
    assert col.metrics()["docs_load_problems"] == 4
