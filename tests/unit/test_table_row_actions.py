"""Tests for #336 — opt-in stable row IDs, selection and row actions on table()."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from praisonaiui import table

DASHBOARD_JS = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "dashboard.js"
)


class TestTableHelper:
    def test_static_payload_unchanged(self):
        assert table(headers=["A"], rows=[["x"]]) == {
            "type": "table", "headers": ["A"], "rows": [["x"]],
        }

    def test_row_ids_and_actions(self):
        t = table(headers=["Name"], rows=[["Acme"], ["Beta"]],
                  row_ids=["c1", "c2"], actions=["Edit"])
        assert t["row_ids"] == ["c1", "c2"]
        assert t["actions"] == ["Edit"]

    def test_row_ids_length_mismatch(self):
        with pytest.raises(ValueError):
            table(headers=["A"], rows=[["x"], ["y"]], row_ids=["1"])

    def test_row_ids_unique(self):
        with pytest.raises(ValueError):
            table(headers=["A"], rows=[["x"], ["y"]], row_ids=["1", "1"])

    def test_actions_require_row_ids(self):
        with pytest.raises(ValueError):
            table(headers=["A"], rows=[["x"]], actions=["Edit"])


class TestRenderTable:
    def _body(self) -> str:
        src = DASHBOARD_JS.read_text(encoding="utf-8")
        m = re.search(r"function renderTable\(comp\)\s*\{(.*?)^}", src,
                      re.DOTALL | re.MULTILINE)
        assert m, "renderTable not found"
        return m.group(1)

    def test_selection_is_opt_in_and_uses_row_id(self):
        body = self._body()
        assert "comp.row_ids" in body
        assert "aiui:table-select" in body
        assert "rowId" in body

    def test_keyboard_and_pointer_selection(self):
        body = self._body()
        assert "tabIndex = 0" in body
        assert "'click', select" in body
        assert "'Enter'" in body and "' '" in body
        assert "aria-selected" in body

    def test_row_actions_are_buttons(self):
        body = self._body()
        assert "aiui:table-action" in body
        assert "btn.type = 'button'" in body
        assert "stopPropagation" in body

    def test_events_bubble(self):
        assert "bubbles: true" in self._body()
