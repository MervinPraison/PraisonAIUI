"""Regression tests for issue #189.

The Channels dashboard view lost its CRUD controls in the 3961508 refactor,
leaving a read-only page (list + restart only). These tests assert the
committed frontend view source
``src/praisonaiui/templates/frontend/plugins/views/channels.js`` restores the
Add Channel modal and per-card actions (Enable/Disable, Restart, Test, Delete),
aligned with the #176 secret policy (env references, no plaintext token paste
by default) and the #172 dropdown contrast fix (``.db-form-select``).
"""

from __future__ import annotations

from pathlib import Path

_FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
CHANNELS_VIEW = _FRONTEND / "views" / "channels.js"
EXPLORER_VIEW = _FRONTEND / "views" / "explorer.js"


def _view() -> str:
    return CHANNELS_VIEW.read_text()


class TestAddChannelControls:
    def test_add_channel_button_present(self):
        src = _view()
        assert 'id="ch-add"' in src
        assert "+ Add Channel" in src

    def test_add_modal_has_platform_select(self):
        src = _view()
        assert 'id="chf-platform"' in src
        assert 'id="ch-modal"' in src

    def test_platform_select_uses_dashboard_form_class(self):
        # #172 dark-theme option contrast fix applies to .db-form-select.
        src = _view()
        assert "db-form-select" in src

    def test_save_posts_to_channels_api(self):
        src = _view()
        assert "/api/channels" in src
        assert "'POST'" in src or '"POST"' in src
        assert "JSON.stringify" in src


class TestCardActions:
    def test_all_card_actions_present(self):
        src = _view()
        for cls in ("ch-toggle", "ch-restart", "ch-test", "ch-del"):
            assert cls in src, f"missing card action {cls}"

    def test_toggle_endpoint(self):
        assert "/toggle" in _view()

    def test_test_endpoint(self):
        assert "/test" in _view()

    def test_delete_uses_confirm(self):
        src = _view()
        assert "showConfirm" in src
        assert "DELETE" in src


class TestSecretPolicy:
    def test_secret_fields_default_to_env_reference(self):
        # Placeholders steer operators to env references per #176.
        src = _view()
        assert "env:" in src

    def test_modal_surfaces_api_validation_error(self):
        src = _view()
        assert 'id="chf-error"' in src

    def test_no_inline_password_prefill(self):
        # Fields must not be pre-populated with stored secrets.
        src = _view()
        assert "value=" not in src or "***REDACTED***" not in src


class TestEmptyState:
    def test_empty_state_references_add_button(self):
        src = _view()
        assert "+ Add Channel" in src
        assert "Use the API or CLI to add channels." not in src


class TestExplorerPreset:
    def test_explorer_has_add_channel_post(self):
        src = EXPLORER_VIEW.read_text()
        assert "Add Channel" in src
        assert "env:TELEGRAM_BOT_TOKEN" in src
