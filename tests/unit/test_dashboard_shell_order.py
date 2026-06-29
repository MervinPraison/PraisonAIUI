"""Regression tests for #166 — buildDashboard() insertBefore NotFoundError.

buildDashboard() called `root.insertBefore(shellHeader, main)` before `main`
was a child of `root`, violating the DOM contract and throwing
NotFoundError. That aborted the dashboard plugin init, blocking Ctrl+K and
the browser chat input. These source-parsing tests assert `main` is appended
to `root` before any insertBefore references it, mirroring
`test_session_search_dashboard.py`.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
DASHBOARD_JS = FRONTEND / "dashboard.js"


class TestDashboardShellOrder:
    def _build_body(self) -> str:
        src = DASHBOARD_JS.read_text()
        m = re.search(
            r"function buildDashboard\([^)]*\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "buildDashboard not found"
        return m.group(1)

    def test_main_appended_before_insert_before(self):
        body = self._build_body()
        append_idx = body.find("root.appendChild(main)")
        insert_idx = body.find("root.insertBefore(shellHeader, main)")
        assert append_idx != -1, "root.appendChild(main) not found"
        assert insert_idx != -1, "root.insertBefore(shellHeader, main) not found"
        assert append_idx < insert_idx, (
            "main must be appended to root before insertBefore(shellHeader, main)"
        )

    def test_shell_header_insert_guarded_by_children(self):
        body = self._build_body()
        m = re.search(
            r"if \(shellHeader\.children\.length\)\s*"
            r"root\.insertBefore\(shellHeader, main\)",
            body,
        )
        assert m, "shellHeader insert must be guarded by children.length"
