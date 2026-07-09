"""Regression tests for C-01 — Ctrl+K session search in the dashboard style.

Issue #155: PR #145 shipped SessionSearch in React layouts only. The dashboard
style (`dashboard.js`) skips React entirely, so Ctrl+K never reached the primary
ops example. These tests assert the vanilla-JS palette is wired into
`dashboard.js` (and its session-select handler into the chat view), mirroring the
source-parsing approach used by `test_form_input_names.py`.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
DASHBOARD_JS = FRONTEND / "dashboard.js"
CHAT_JS = FRONTEND / "views" / "chat.js"


class TestDashboardSessionSearch:
    def _src(self) -> str:
        return DASHBOARD_JS.read_text()

    def test_ctrl_k_keydown_handler_present(self):
        # The Ctrl+K binding is owned by the command palette, which exposes a
        # "Search sessions…" entry that routes to openSessionSearch(). Assert the
        # UX contract (Ctrl+K reaches session search) rather than where the
        # keydown listener physically lives.
        src = self._src()
        assert "initSessionSearch" in src
        # Ctrl+K / Cmd+K ownership lives in the command palette
        # (initCommandPalette), which exposes a "Search sessions…" entry that
        # calls openSessionSearch. initSessionSearch only owns Escape-to-close.
        m = re.search(
            r"function initCommandPalette\(\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "initCommandPalette not found"
        body = m.group(1)
        assert "keydown" in body
        assert "ctrlKey" in body and "metaKey" in body
        assert "'k'" in body or '"k"' in body
        assert "preventDefault" in body
        # The palette must route the "sessions" action to openSessionSearch().
        assert "openSessionSearch()" in src
        assert "action: 'sessions'" in src or 'action: "sessions"' in src

        # initSessionSearch owns only Escape-to-close for the session palette.
        m = re.search(
            r"function initSessionSearch\(\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "initSessionSearch not found"
        assert "Escape" in m.group(1), (
            "initSessionSearch must own Escape-to-close for the session palette"
        )

    def test_palette_fetches_sessions_endpoint(self):
        src = self._src()
        m = re.search(
            r"async function openSessionSearch\(\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "openSessionSearch not found"
        assert "/sessions" in m.group(1)

    def test_select_navigates_via_selectPage(self):
        src = self._src()
        m = re.search(
            r"function selectSession\(sessionId\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "selectSession not found"
        body = m.group(1)
        assert "selectPage" in body
        assert "aiui:session-select" in body

    def test_init_invokes_session_search(self):
        src = self._src()
        init_idx = src.find("async function init()")
        assert init_idx != -1, "init() not found"
        invoke_idx = src.find("initSessionSearch()", init_idx)
        approval_idx = src.find("initApprovalStream()", init_idx)
        build_idx = src.find("await buildDashboard()", init_idx)
        assert invoke_idx != -1, "initSessionSearch() not invoked in init()"
        assert build_idx < invoke_idx, "session search must init after dashboard build"
        assert abs(invoke_idx - approval_idx) < 400, (
            "initSessionSearch() should be wired alongside initApprovalStream()"
        )

    def test_public_api_exposes_open_session_search(self):
        src = self._src()
        assert "window.aiui.openSessionSearch" in src

    def test_escape_closes_palette(self):
        src = self._src()
        assert "closeSessionSearch" in src
        m = re.search(
            r"function initSessionSearch\(\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert "Escape" in m.group(1)


class TestChatViewSessionSelectListener:
    def _src(self) -> str:
        return CHAT_JS.read_text()

    def test_chat_listens_for_session_select(self):
        src = self._src()
        assert "aiui:session-select" in src
        assert "addEventListener('aiui:session-select'" in src

    def test_chat_loads_selected_session(self):
        src = self._src()
        m = re.search(
            r"sessionSelectHandler\s*=\s*\(e\)\s*=>\s*\{(.*?)\};",
            src, re.DOTALL,
        )
        assert m, "sessionSelectHandler not found"
        assert "loadSession" in m.group(1)

    def test_chat_cleanup_removes_listener(self):
        src = self._src()
        m = re.search(
            r"export function cleanup\(\)\s*\{(.*?)\n}",
            src, re.DOTALL,
        )
        assert m, "cleanup() not found"
        assert "removeEventListener('aiui:session-select'" in m.group(1)
