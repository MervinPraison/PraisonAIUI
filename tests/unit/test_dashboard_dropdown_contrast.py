"""Regression tests for issue #172.

Two dark-theme defects on the dashboard shell:

1. Native ``<select>`` option popups inherited the dashboard's light
   foreground colour while the browser painted a white system background,
   producing unreadable white-on-white platform labels (WCAG AA failure).

2. The sidebar header brand text could overlap an adjacent control because
   the long title had no overflow/ellipsis guard and the absolutely
   positioned toggle reserved no space.

Both fixes live in the committed dashboard bundle
``src/praisonaiui/templates/frontend/plugins/dashboard.js`` (``DASHBOARD_STYLE``).
"""

from __future__ import annotations

import re
from pathlib import Path

DASHBOARD_JS = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend"
    / "plugins" / "dashboard.js"
)


def _style() -> str:
    src = DASHBOARD_JS.read_text()
    m = re.search(r"const DASHBOARD_STYLE = `(.*?)`;", src, re.DOTALL)
    assert m, "DASHBOARD_STYLE template literal not found"
    return m.group(1)


class TestSelectOptionContrast:
    """Native option popups must use a dark surface with light text."""

    def test_form_select_option_has_explicit_colors(self):
        style = _style()
        m = re.search(r"\.db-form-select option[^{]*\{([^}]*)\}", style)
        assert m, "no explicit styling for .db-form-select option"
        body = m.group(1)
        assert "background-color" in body
        assert "color" in body
        assert "var(--db-text)" in body

    def test_generic_dashboard_select_option_styled(self):
        style = _style()
        assert ".db-active select option" in style or "#root select option" in style

    def test_selected_option_is_highlighted(self):
        style = _style()
        assert "option:checked" in style


class TestSidebarHeaderNoOverlap:
    """Sidebar brand text must not overlap adjacent controls."""

    def test_header_reserves_space_and_truncates(self):
        style = _style()
        m = re.search(r"\n  \.db-sidebar-header\s*\{([^}]*)\}", style)
        assert m, ".db-sidebar-header base rule not found"
        body = m.group(1)
        assert "min-width: 0" in body or "min-width:0" in body
        assert "padding-right" in body

    def test_header_label_has_ellipsis(self):
        style = _style()
        assert "text-overflow: ellipsis" in style
        assert "white-space: nowrap" in style

    def test_logo_does_not_shrink(self):
        style = _style()
        m = re.search(r"\.db-sidebar-header \.logo\s*\{([^}]*)\}", style)
        assert m, ".db-sidebar-header .logo rule not found"
        assert "flex-shrink: 0" in m.group(1)
