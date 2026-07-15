"""Tests for issue #220 — Channel Inbox unified multi-channel message hub.

Asserts the committed frontend view source
``src/praisonaiui/templates/frontend/plugins/views/inbox.js`` provides the
three-pane triage shell (queue, conversation, context rail), thread-building
helpers, assign-agent + status persistence via session state, inline reply via
the chat transport, and deep links to /chat and /work. Also verifies the view
is registered in ``dashboard.js`` and the ``inbox`` page in ``server.py``, and
that ``channels.js`` links to the inbox.
"""

from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_FRONTEND = _ROOT / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
INBOX_VIEW = _FRONTEND / "views" / "inbox.js"
CHANNELS_VIEW = _FRONTEND / "views" / "channels.js"
DASHBOARD = _FRONTEND / "dashboard.js"
SESSIONS_EXT = _ROOT / "src" / "praisonaiui" / "features" / "sessions_ext.py"
SERVER = _ROOT / "src" / "praisonaiui" / "server.py"


def _inbox() -> str:
    return INBOX_VIEW.read_text()


class TestThreePaneShell:
    def test_view_exists(self):
        assert INBOX_VIEW.exists()

    def test_three_panes_present(self):
        src = _inbox()
        assert "inbox-queue" in src
        assert "inbox-conv" in src
        assert "inbox-rail" in src

    def test_exports_render(self):
        assert "export async function render(container)" in _inbox()

    def test_marks_page_container(self):
        assert "data-page', 'inbox'" in _inbox()


class TestThreadBuilder:
    def test_grouping_helpers_exported(self):
        src = _inbox()
        assert "export function groupMessagesBySender" in src
        assert "export function buildThreadRow" in src
        assert "export function sortThreads" in src

    def test_sort_uses_status_priority(self):
        src = _inbox()
        assert "priority" in src
        assert "waiting_on_agent" in src


class TestFilters:
    def test_platform_and_status_filters(self):
        src = _inbox()
        assert "inbox-platform-chips" in src
        assert "inbox-status-chips" in src
        assert "Search conversations" in src


class TestAssignAndStatus:
    def test_assign_persists_via_session_state(self):
        src = _inbox()
        assert "/state" in src
        assert "inbox_threads" in src
        assert "assigned_agent" in src

    def test_status_pills_present(self):
        src = _inbox()
        for status in ("open", "waiting_on_agent", "waiting_on_customer", "resolved"):
            assert status in src

    def test_agent_sources(self):
        src = _inbox()
        assert "/agents" in src
        assert "/api/agents/definitions" in src


class TestReplyTransport:
    def test_reply_uses_chat_send(self):
        src = _inbox()
        assert "/api/chat/send" in src
        assert "session_id" in src

    def test_history_fetch(self):
        assert "/api/chat/history/" in _inbox()


class TestEscalationLinks:
    def test_open_in_chat_link(self):
        assert "/chat?session=" in _inbox()

    def test_escalate_to_work_hub_link(self):
        assert "/work?card=" in _inbox()


class TestEmptyState:
    def test_no_channels_links_to_config(self):
        src = _inbox()
        assert "No channels configured" in src
        assert '/channels' in src


class TestRegistration:
    def test_route_registered_in_dashboard(self):
        src = DASHBOARD.read_text()
        assert "inbox:" in src
        assert "/plugins/views/inbox.js" in src

    def test_page_registered_in_server(self):
        src = SERVER.read_text()
        assert '"id": "inbox"' in src
        assert "Channel Inbox" in src

    def test_channels_links_to_inbox(self):
        assert 'href="/inbox"' in CHANNELS_VIEW.read_text()


class TestSessionsPlatformField:
    def test_sessions_list_surfaces_platform(self):
        src = SESSIONS_EXT.read_text()
        assert '"platform"' in src
        assert '"channel_id"' in src
