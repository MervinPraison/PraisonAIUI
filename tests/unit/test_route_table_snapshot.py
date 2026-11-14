"""The default route table of ``create_app()`` is pinned (gap G6).

Routes move out of ``create_app`` into the built-in records that own them,
one domain at a time. A move must not add, drop or change a route: every
(kind, path, methods) row of the default app equals the snapshot in
``fixtures/route_table_snapshot.json``. Mount order may change, so rows are
compared as a sorted list; the order that matters is checked separately.

Regenerate (only for an intended route change, with the reason in the PR)::

    AIUI_REGEN_ROUTE_SNAPSHOT=1 pytest tests/unit/test_route_table_snapshot.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import praisonaiui.config_store as config_store
import praisonaiui.server as srv

SNAPSHOT = Path(__file__).parent / "fixtures" / "route_table_snapshot.json"


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.delenv("AIUI_TEMPLATES_DIR", raising=False)
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    yield
    srv.reset_state()


def route_rows(app) -> list[list]:
    return [
        [type(r).__name__, getattr(r, "path", ""), sorted(getattr(r, "methods", None) or ())]
        for r in app.routes
    ]


@pytest.mark.parametrize("style", ["dashboard", "app"])
def test_default_route_table_matches_the_snapshot(style):
    srv.set_style(style)
    rows = sorted(route_rows(srv.create_app()))
    if os.environ.get("AIUI_REGEN_ROUTE_SNAPSHOT") and style == "dashboard":
        body = ",\n".join(" " + json.dumps(r) for r in rows)
        SNAPSHOT.write_text(f"[\n{body}\n]\n", encoding="utf-8")
    expected = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    missing = [r for r in expected if r not in rows]
    added = [r for r in rows if r not in expected]
    assert (missing, added) == ([], [])
    assert rows == expected  # duplicates too


def test_route_order_that_matters_is_kept():
    rows = route_rows(srv.create_app())
    # page navigations are decided before any API route
    assert rows[0][0] == "NavigationRoute"
    # the SPA catch-all comes last, so it shadows nothing
    assert rows[-1][1] == "/{path:path}"
    assert rows[-2][1] == "/"
