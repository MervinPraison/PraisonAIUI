"""Regression tests for #177 — offline chat send produces no user-visible error.

The browser E2E audit simulated offline mode on /chat and found no visible
error feedback. These source-parsing tests assert the fixes:

  RC-2  selectPage shows a shell error (.db-error / role=alert) when
        #db-main-content is missing instead of returning silently.
  RC-3  the HTTP fallback catch path surfaces an offline hint plus a toast.
  RC-3b system error bubbles (prefixed with ❌) get role="alert" for a11y.
  RC-4  ws.send() is wrapped in try/catch with a user-visible error.
"""

from __future__ import annotations

from pathlib import Path

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
DASHBOARD_JS = FRONTEND / "dashboard.js"
CHAT_JS = FRONTEND / "views" / "chat.js"


class TestSelectPageShellError:
    def test_shell_error_helper_defined(self):
        src = DASHBOARD_JS.read_text()
        assert "function showShellError(" in src
        assert "role" in src and "'alert'" in src
        assert "db-error" in src

    def test_select_page_calls_shell_error_on_missing_main(self):
        src = DASHBOARD_JS.read_text()
        idx = src.find("const main = document.getElementById('db-main-content')")
        assert idx != -1
        region = src[idx:idx + 400]
        assert "if (!main)" in region
        assert "showShellError(" in region


class TestChatOfflineMessaging:
    def test_toast_imported(self):
        src = CHAT_JS.read_text()
        assert "import { showToast } from '../toast.js';" in src

    def test_offline_hint_in_fallback(self):
        src = CHAT_JS.read_text()
        assert "navigator.onLine === false" in src
        assert "You are offline. " in src

    def test_fallback_catch_shows_toast(self):
        src = CHAT_JS.read_text()
        idx = src.find("fetch('/api/chat/send'")
        assert idx != -1
        region = src[idx:idx + 900]
        assert ".catch(" in region
        assert "showToast(" in region
        assert "appendMessage('system'" in region
        assert "setStatus('error')" in region


class TestSystemErrorRoleAlert:
    def test_append_message_sets_role_alert(self):
        src = CHAT_JS.read_text()
        idx = src.find("function appendMessage(")
        assert idx != -1
        region = src[idx:idx + 700]
        assert "setAttribute('role', 'alert')" in region
        assert "startsWith('❌')" in region


class TestWebSocketSendGuard:
    def test_ws_send_wrapped_in_try_catch(self):
        src = CHAT_JS.read_text()
        idx = src.find("ws.send(JSON.stringify(payload))")
        assert idx != -1
        before = src[max(0, idx - 120):idx]
        after = src[idx:idx + 300]
        assert "try {" in before
        assert "catch" in after
        assert "Connection lost. Message not sent." in after
