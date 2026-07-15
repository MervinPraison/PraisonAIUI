"""Unit tests for issue #208 — i18n wiring, per-turn memory search, and a11y.

Covers post-merge gaps left by PR #206 on the chat context ring UI:
  * Gap A — ring/banner/chip strings consume i18n via a JS ``t()`` helper.
  * Gap B — memory chip uses ``POST /api/memory/search`` (per-turn hits),
    not ``GET /api/memory`` (total store).
  * Gap C — ``role="progressbar"`` lives on the ring wrapper, not the send button.
"""

from __future__ import annotations

from pathlib import Path

from praisonaiui.features.i18n import JSONLocaleManager

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
CHAT_JS = FRONTEND / "views" / "chat.js"


def _src() -> str:
    return CHAT_JS.read_text(encoding="utf-8")


class TestGapAI18nWiring:
    def test_i18n_loader_present(self):
        src = _src()
        assert "async function loadI18nStrings(" in src
        assert "/api/i18n/strings/" in src
        assert "await loadI18nStrings()" in src

    def test_t_helper_with_fallback(self):
        src = _src()
        assert "function t(key, params)" in src
        assert "I18N_FALLBACK" in src

    def test_i18n_used_at_least_four_times(self):
        # E2E regression bar from the issue: i18n key lookups >= 4
        src = _src()
        assert src.count("t('chat.") >= 4

    def test_banner_uses_i18n_key(self):
        src = _src()
        assert "t('chat.compaction.banner')" in src

    def test_compacted_flash_uses_i18n_key(self):
        src = _src()
        assert "t('chat.compaction.compacted')" in src

    def test_memory_chip_uses_i18n_key(self):
        src = _src()
        assert "t('chat.memory.chip'" in src
        assert "t('chat.memory.empty_turn')" in src

    def test_tooltip_uses_context_status_keys(self):
        src = _src()
        assert "chat.context.critical" in src
        assert "chat.context.warning" in src
        assert "chat.context.healthy" in src
        assert "t('chat.context.estimate')" in src


class TestGapBMemorySearch:
    def test_search_endpoint_used(self):
        # E2E regression bar: memory/search present >= 1
        src = _src()
        assert "/api/memory/search" in src

    def test_search_is_post_with_query(self):
        src = _src()
        assert "method: 'POST'" in src
        assert "lastUserMessage" in src
        assert "query," in src

    def test_chip_counts_results_not_total(self):
        src = _src()
        assert "data.results || []" in src
        assert "results.length" in src

    def test_last_user_message_tracked_on_send(self):
        src = _src()
        assert "lastUserMessage = content" in src


class TestGapCAccessibility:
    def test_progressbar_role_on_wrapper(self):
        src = _src()
        # Wrapper div carries the progressbar role + aria values
        assert 'id="chat-ring-wrap"' in src
        wrap_idx = src.index('id="chat-ring-wrap"')
        wrap_slice = src[wrap_idx:wrap_idx + 260]
        assert 'role="progressbar"' in wrap_slice
        assert "aria-valuenow" in wrap_slice
        assert "aria-valuemax" in wrap_slice

    def test_send_button_is_button_not_progressbar(self):
        src = _src()
        btn_idx = src.index('id="chat-send-btn"')
        btn_slice = src[btn_idx:btn_idx + 160]
        assert 'type="button"' in btn_slice
        assert 'role="progressbar"' not in btn_slice
        assert 'aria-label="Send message"' in btn_slice

    def test_aria_updates_target_wrapper(self):
        src = _src()
        assert "wrap.setAttribute('aria-valuenow'" in src


class TestI18nMemoryChipLocales:
    def test_chip_translation_interpolates_count_all_locales(self):
        mgr = JSONLocaleManager()
        for locale, word in (("en", "memories"), ("es", "recuerdos"), ("fr", "souvenirs")):
            out = mgr.t("chat.memory.chip", locale=locale, count=2)
            assert "2" in out
            assert word in out

    def test_banner_localised(self):
        mgr = JSONLocaleManager()
        assert mgr.t("chat.compaction.banner", locale="es") != mgr.t(
            "chat.compaction.banner", locale="en"
        )
        assert mgr.t("chat.compaction.banner", locale="fr") != mgr.t(
            "chat.compaction.banner", locale="en"
        )
