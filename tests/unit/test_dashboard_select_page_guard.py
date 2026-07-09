"""Regression tests for #175 — selectPage() silent abort when #db-main-content missing.

The dashboard style (`dashboard.js`) skips React. When the shell layout is
incomplete and `#db-main-content` is absent, `selectPage()` used to return
silently, leaving every view empty with no console error or user-visible signal.
These source-parsing tests assert the defensive guard and error surface are
wired in, mirroring `test_session_search_dashboard.py`.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
DASHBOARD_JS = FRONTEND / "dashboard.js"


class TestSelectPageGuard:
    def _select_page_body(self) -> str:
        src = DASHBOARD_JS.read_text()
        m = re.search(
            r"async function selectPage\(pageId\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "selectPage not found"
        return m.group(1)

    def test_missing_main_logs_console_error(self):
        body = self._select_page_body()
        m = re.search(
            r"if \(!main\)\s*\{(.*?)\}", body, re.DOTALL,
        )
        assert m, "guard for missing #db-main-content not found"
        guard = m.group(1)
        assert "console.error" in guard
        assert "db-main-content" in guard

    def test_missing_main_surfaces_init_error(self):
        body = self._select_page_body()
        m = re.search(
            r"if \(!main\)\s*\{(.*?)\}", body, re.DOTALL,
        )
        assert m, "guard for missing #db-main-content not found"
        assert "showDashboardInitError" in m.group(1)

    def test_missing_page_logs_console_error(self):
        body = self._select_page_body()
        m = re.search(
            r"if \(!page\)\s*\{(.*?)\}", body, re.DOTALL,
        )
        assert m, "guard for missing page not found"
        assert "console.error" in m.group(1)

    def test_show_dashboard_init_error_helper_present(self):
        src = DASHBOARD_JS.read_text()
        m = re.search(
            r"function showDashboardInitError\(message\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "showDashboardInitError helper not found"
        helper = m.group(1)
        assert "db-init-error" in helper
        assert "role" in helper and "alert" in helper

    def test_no_silent_combined_return(self):
        body = self._select_page_body()
        assert "if (!main || !page) return;" not in body
