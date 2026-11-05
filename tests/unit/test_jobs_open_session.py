"""Issue #323 — Jobs rows link to their chat session when ``session_id`` is set.

Source-parsing test, mirroring ``test_session_search_dashboard.py``.
"""

from __future__ import annotations

from pathlib import Path

JOBS_JS = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins" / "jobs.js"
)


def _src() -> str:
    return JOBS_JS.read_text(encoding="utf-8")


def test_open_session_button_only_when_session_id():
    src = _src()
    assert "job.session_id ? `<button" in src
    assert 'data-session-id="${escapeAttr(job.session_id)}"' in src


def test_open_session_reuses_session_select_event():
    src = _src()
    assert "function openJobSession(sessionId)" in src
    assert "selectPage('chat')" in src
    assert "'aiui:session-select'" in src
    assert "window.aiuiOpenJobSession = openJobSession;" in src
