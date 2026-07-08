"""Regression tests for #178 — Ctrl+K command palette exposure and idempotency.

The dashboard command palette (initCommandPalette / openCommandPalette /
.db-cmdk-overlay) is implemented in the shipped bundle, but the acceptance
criteria require openCommandPalette to be reachable from the global scope
(``typeof openCommandPalette === 'function'``) and require that repeated
initialisation (HMR / full reload) does not double-register the keydown
handler. These source-parsing tests mirror ``test_dashboard_shell_order.py``.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
DASHBOARD_JS = FRONTEND / "dashboard.js"


class TestCommandPalette:
    def _src(self) -> str:
        return DASHBOARD_JS.read_text()

    def test_open_command_palette_exposed_globally(self):
        src = self._src()
        assert "window.openCommandPalette = openCommandPalette" in src, (
            "openCommandPalette must be exposed on window for the global "
            "'typeof openCommandPalette === function' acceptance criterion"
        )

    def test_open_command_palette_on_aiui_namespace(self):
        src = self._src()
        assert "window.aiui.openCommandPalette = openCommandPalette" in src

    def test_init_command_palette_guarded_against_double_register(self):
        src = self._src()
        m = re.search(
            r"function initCommandPalette\([^)]*\)\s*\{(.*?)^}",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "initCommandPalette not found"
        body = m.group(1)
        assert "_paletteInitialized" in body, (
            "initCommandPalette must guard against duplicate registration"
        )
        assert "return" in body, (
            "initCommandPalette must early-return when already initialised"
        )

    def test_init_command_palette_called_after_build(self):
        src = self._src()
        build_idx = src.find("await buildDashboard()")
        init_idx = src.find("initCommandPalette();")
        assert build_idx != -1, "buildDashboard call not found"
        assert init_idx != -1, "initCommandPalette call not found"
        assert build_idx < init_idx, (
            "initCommandPalette must run after buildDashboard so the shell exists"
        )

    def test_ctrl_and_meta_k_bound(self):
        src = self._src()
        assert re.search(
            r"e\.ctrlKey \|\| e\.metaKey", src
        ), "Ctrl+K / Cmd+K must both open the palette"
