"""Unit tests for the composer context token ring (STITCH-002, #196).

Covers:
  * Backend char-based context estimator + /api/chat/context-stats route.
  * Deterministic, wire-safe serialisation.
  * Frontend ring threshold state machine + component presence in chat.js.
  * i18n keys for ring/banner/chip.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from praisonaiui.features.chat import (
    DEFAULT_CONTEXT_LIMIT,
    _chat_context_stats,
    _estimate_context_stats,
)
from praisonaiui.features.i18n import JSONLocaleManager

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
CHAT_JS = FRONTEND / "views" / "chat.js"


class _FakeRequest:
    def __init__(self, params: dict[str, str]):
        self.query_params = params


class TestEstimator:
    def test_empty_session_baseline(self):
        stats = _estimate_context_stats([], session_id="s1")
        assert stats["session_id"] == "s1"
        assert stats["limit"] == DEFAULT_CONTEXT_LIMIT
        assert stats["estimate"] is True
        # System + tools baselines only
        assert stats["breakdown"]["messages"] == 0
        assert stats["breakdown"]["memory"] == 0
        assert stats["used"] > 0

    def test_messages_increase_usage(self):
        small = _estimate_context_stats(
            [{"role": "user", "content": "hi"}], session_id="s"
        )
        big = _estimate_context_stats(
            [{"role": "user", "content": "x" * 4000}], session_id="s"
        )
        assert big["used"] > small["used"]
        assert big["breakdown"]["messages"] > small["breakdown"]["messages"]

    def test_tool_calls_count_towards_tools(self):
        msgs = [
            {
                "role": "assistant",
                "content": "done",
                "toolCalls": [{"args": "q" * 400, "result": "r" * 400}],
            }
        ]
        stats = _estimate_context_stats(msgs, session_id="s")
        baseline = _estimate_context_stats([], session_id="s")
        assert stats["breakdown"]["tools"] > baseline["breakdown"]["tools"]

    def test_usage_pct_matches_used_over_limit(self):
        stats = _estimate_context_stats(
            [{"role": "user", "content": "x" * 8000}], session_id="s", limit=100000
        )
        expected = round((stats["used"] / 100000) * 100, 1)
        assert stats["usage_pct"] == expected

    def test_zero_limit_falls_back_to_default_for_pct(self):
        stats = _estimate_context_stats([], session_id="s", limit=0)
        # limit echoed as-is, but pct computed against a safe default (no div/0)
        assert stats["limit"] == 0
        assert stats["usage_pct"] >= 0

    def test_breakdown_keys_sorted_deterministic(self):
        stats = _estimate_context_stats([], session_id="s")
        keys = list(stats["breakdown"].keys())
        assert keys == sorted(keys)
        assert set(keys) == {"memory", "messages", "system", "tools"}

    def test_top_level_keys_sorted(self):
        stats = _estimate_context_stats([], session_id="s")
        keys = list(stats.keys())
        assert keys == sorted(keys)


class TestContextStatsRoute:
    def test_unknown_session_returns_estimate_not_404(self):
        resp = asyncio.run(_chat_context_stats(_FakeRequest({"session_id": "nope"})))
        assert resp.status_code == 200

    def test_missing_session_id_ok(self):
        resp = asyncio.run(_chat_context_stats(_FakeRequest({})))
        assert resp.status_code == 200

    def test_invalid_limit_falls_back(self):
        resp = asyncio.run(
            _chat_context_stats(_FakeRequest({"session_id": "s", "limit": "abc"}))
        )
        assert resp.status_code == 200


class TestRingThresholds:
    """Mirror the JS ringStateFor thresholds against the spec table."""

    def _state(self, pct: float) -> str:
        if pct >= 95:
            return "over"
        if pct >= 85:
            return "critical"
        if pct >= 60:
            return "warning"
        return "healthy"

    def test_healthy_below_60(self):
        assert self._state(33) == "healthy"
        assert self._state(59.9) == "healthy"

    def test_warning_60_to_85(self):
        assert self._state(60) == "warning"
        assert self._state(84.9) == "warning"

    def test_critical_85_to_95(self):
        assert self._state(85) == "critical"
        assert self._state(94.9) == "critical"

    def test_over_at_95(self):
        assert self._state(95) == "over"
        assert self._state(120) == "over"


class TestChatJsComponents:
    def test_ring_dom_present(self):
        src = CHAT_JS.read_text()
        assert 'id="chat-ring-wrap"' in src
        assert 'id="chat-ring-arc"' in src
        assert 'id="chat-ring-tooltip"' in src

    def test_send_button_inside_ring_preserved_id(self):
        src = CHAT_JS.read_text()
        assert 'class="chat-ring-send" id="chat-send-btn"' in src
        assert 'aria-valuenow' in src
        assert 'aria-valuemax' in src

    def test_compaction_banner_present(self):
        src = CHAT_JS.read_text()
        assert 'id="chat-compaction-banner"' in src
        assert "function updateCompactionBanner(" in src
        assert "function dismissCompactionBanner(" in src

    def test_memory_chip_present(self):
        src = CHAT_JS.read_text()
        assert 'id="chat-memory-chip"' in src
        assert "function refreshMemoryChip(" in src

    def test_ring_state_machine_thresholds(self):
        src = CHAT_JS.read_text()
        assert "function ringStateFor(" in src
        assert "pct >= 95" in src
        assert "pct >= 85" in src
        assert "pct >= 60" in src

    def test_ws_context_events_handled(self):
        src = CHAT_JS.read_text()
        assert "case 'context_update':" in src
        assert "case 'context_compacted':" in src

    def test_poll_fallback_and_debounce(self):
        src = CHAT_JS.read_text()
        assert "function startContextPoll(" in src
        assert "function scheduleContextRefresh(" in src

    def test_existing_memory_panel_and_metrics_preserved(self):
        src = CHAT_JS.read_text()
        # Regression: do not remove existing shipped elements
        assert 'id="chat-memory-panel"' in src
        assert 'id="chat-memory-btn"' in src
        assert "function showStreamMetrics(" in src


class TestI18nKeys:
    KEYS = [
        "chat.context.healthy",
        "chat.context.warning",
        "chat.context.critical",
        "chat.context.estimate",
        "chat.compaction.banner",
        "chat.compaction.compacted",
        "chat.memory.chip",
        "chat.memory.empty_turn",
    ]

    def test_all_keys_present_en(self):
        mgr = JSONLocaleManager()
        strings = mgr.get_strings("en")
        for k in self.KEYS:
            assert k in strings, f"missing en key: {k}"

    def test_keys_present_all_locales(self):
        mgr = JSONLocaleManager()
        for locale in ("en", "es", "fr"):
            strings = mgr.get_strings(locale)
            for k in self.KEYS:
                assert k in strings, f"missing {locale} key: {k}"

    def test_memory_chip_interpolates_count(self):
        mgr = JSONLocaleManager()
        out = mgr.t("chat.memory.chip", locale="en", count=3)
        assert "3" in out
