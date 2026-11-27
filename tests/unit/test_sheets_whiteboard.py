"""Unit & HTTP tests for aiui.sheet(), aiui.whiteboard(), artifacts.KINDS, and Example 35."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
from praisonaiui.features import artifacts

EXAMPLE_APP = (
    Path(__file__).resolve().parents[2]
    / "examples"
    / "python"
    / "35-sheets-whiteboard-dashboard"
    / "app.py"
)


def test_sheet_builder_tabs_and_shorthand():
    multi = aiui.sheet(
        "Q4 Plan",
        id="q4",
        tabs=[{"name": "Budget", "grid": [["Item", "Cost"], ["Total", "=SUM(B2:B2)"]]}],
    )
    assert multi["type"] == "sheet"
    assert multi["id"] == "q4"
    assert multi["title"] == "Q4 Plan"
    assert multi["tabs"][0]["name"] == "Budget"

    short = aiui.sheet("Mini", headers=["A", "B"], rows=[[1, "=A2*2"]])
    assert short == {"type": "sheet", "title": "Mini", "headers": ["A", "B"], "rows": [[1, "=A2*2"]]}

    with pytest.raises(ValueError):
        aiui.sheet("Empty")


def test_whiteboard_builder_and_exports():
    board = aiui.whiteboard(
        [{"id": "n1", "type": "sticky", "text": "Hello", "x": 10, "y": 20}],
        title="Arch",
        id="w1",
    )
    assert board == {
        "type": "whiteboard",
        "title": "Arch",
        "id": "w1",
        "items": [{"id": "n1", "type": "sticky", "text": "Hello", "x": 10, "y": 20}],
    }
    assert "sheet" in aiui.__all__
    assert "whiteboard" in aiui.__all__
    assert "sheet" in artifacts.KINDS
    assert "whiteboard" in artifacts.KINDS


def test_example_35_studio_page_serves_sheet_and_whiteboard():
    from praisonaiui.server import create_app, reset_state

    reset_state()
    try:
        spec = importlib.util.spec_from_file_location("example_35_studio", EXAMPLE_APP)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        app = create_app()
        client = TestClient(app)

        pages_resp = client.get("/api/pages")
        assert pages_resp.status_code == 200
        page_ids = [p["id"] for p in pages_resp.json()["pages"]]
        assert "studio" in page_ids

        data_resp = client.get("/api/pages/studio/data")
        assert data_resp.status_code == 200
        payload = data_resp.json()
        components = payload.get("_components") or payload.get("components") or []
        types = {c["type"] for c in components}
        assert {"header", "caption", "columns", "chart", "sheet", "whiteboard"}.issubset(types)
    finally:
        reset_state()
