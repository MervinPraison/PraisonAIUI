"""Tests for the chat prefill-composer listener lifecycle (issue #209).

The 'aiui:prefill-composer' listener must be registered as a module-scope
singleton and torn down in cleanup(), so repeated SPA navigations between
/code-studio and /chat do not stack duplicate handlers on window.
"""

from pathlib import Path

VIEWS = Path("src/praisonaiui/templates/frontend/plugins/views")


class TestChatPrefillListenerLifecycle:
    def test_module_scope_handler_declared(self):
        src = (VIEWS / "chat.js").read_text()
        assert "let prefillHandler = null;" in src

    def test_ensure_prefill_listener_guard(self):
        src = (VIEWS / "chat.js").read_text()
        assert "function ensurePrefillListener()" in src
        assert "if (prefillHandler) return;" in src

    def test_render_uses_singleton_not_inline_addlistener(self):
        src = (VIEWS / "chat.js").read_text()
        assert "ensurePrefillListener();" in src
        # The listener is added exactly once, inside the guard helper.
        assert src.count("window.addEventListener('aiui:prefill-composer'") == 1

    def test_cleanup_removes_listener(self):
        src = (VIEWS / "chat.js").read_text()
        assert "window.removeEventListener('aiui:prefill-composer', prefillHandler)" in src
        assert src.count("prefillHandler = null;") >= 2
