"""Unit tests for the Cost FinOps Strip (STITCH-013, #223).

Covers:
  * Budget threshold + today-sum logic (mirrors the JS helpers).
  * FinOps config schema section + cross-field validation.
  * Frontend component presence in overview.js / chat.js / _helpers.js.
  * i18n keys for strip/banner/chip.
"""

from __future__ import annotations

from pathlib import Path

from praisonaiui.features.config_runtime import CONFIG_SCHEMA, validate_config
from praisonaiui.features.i18n import JSONLocaleManager

FRONTEND = (
    Path(__file__).resolve().parents[2]
    / "src" / "praisonaiui" / "templates" / "frontend" / "plugins"
)
HELPERS_JS = FRONTEND / "views" / "_helpers.js"
OVERVIEW_JS = FRONTEND / "views" / "overview.js"
CHAT_JS = FRONTEND / "views" / "chat.js"


def _compute_budget_pct(today: float, budget) -> float | None:
    """Python mirror of computeBudgetPct."""
    if not budget or budget <= 0:
        return None
    pct = today / budget * 100
    if pct < 0:
        return 0
    return min(pct, 100)


def _budget_level(pct, warn_pct: int = 80, critical_pct: int = 95) -> str:
    """Python mirror of budgetLevelFor."""
    if pct is None:
        return "none"
    if pct >= critical_pct:
        return "critical"
    if pct >= warn_pct:
        return "warn"
    return "none"


def _sum_today_tokens(timeseries: list[dict]) -> int:
    """Python mirror of sumTodayTokens (uses fixed today key for determinism)."""
    today_key = "2026-07-15"
    dated = [p for p in timeseries if isinstance(p.get("hour_key"), str)]
    scope = [p for p in dated if p["hour_key"].startswith(today_key)] if dated else timeseries
    return sum(int(p.get("tokens", 0) or 0) for p in scope)


def _short_model(model: str) -> str:
    idx = model.rfind("/")
    return model[idx + 1:] if idx >= 0 else model


class TestBudgetPct:
    def test_80_percent(self):
        assert _compute_budget_pct(1_600_000, 2_000_000) == 80

    def test_null_budget(self):
        assert _compute_budget_pct(1_000_000, None) is None

    def test_zero_budget_treated_as_unset(self):
        assert _compute_budget_pct(1_000_000, 0) is None

    def test_over_budget_capped_at_100(self):
        assert _compute_budget_pct(3_000_000, 2_000_000) == 100


class TestBudgetLevel:
    def test_below_warn_is_none(self):
        assert _budget_level(79) == "none"

    def test_at_warn_is_warn(self):
        assert _budget_level(80) == "warn"
        assert _budget_level(82) == "warn"

    def test_at_critical_is_critical(self):
        assert _budget_level(95) == "critical"
        assert _budget_level(96) == "critical"

    def test_null_pct_is_none(self):
        assert _budget_level(None) == "none"


class TestSumTodayTokens:
    def test_only_today_buckets_summed(self):
        ts = [
            {"hour_key": "2026-07-15-08", "tokens": 100},
            {"hour_key": "2026-07-15-09", "tokens": 200},
            {"hour_key": "2026-07-14-23", "tokens": 999},
        ]
        assert _sum_today_tokens(ts) == 300

    def test_falls_back_to_all_when_undated(self):
        ts = [{"tokens": 10}, {"tokens": 20}]
        assert _sum_today_tokens(ts) == 30


class TestShortModel:
    def test_strips_provider_prefix(self):
        assert _short_model("anthropic/claude-3-5-sonnet") == "claude-3-5-sonnet"

    def test_no_prefix_unchanged(self):
        assert _short_model("gpt-4o-mini") == "gpt-4o-mini"


class TestFinOpsConfigSchema:
    def test_finops_section_present(self):
        assert "finops" in CONFIG_SCHEMA["properties"]

    def test_finops_fields_present(self):
        props = CONFIG_SCHEMA["properties"]["finops"]["properties"]
        for field in (
            "enabled",
            "daily_token_budget",
            "daily_cost_budget_usd",
            "warn_pct",
            "critical_pct",
            "show_session_chip",
        ):
            assert field in props, f"missing finops field: {field}"

    def test_threshold_defaults(self):
        props = CONFIG_SCHEMA["properties"]["finops"]["properties"]
        assert props["warn_pct"]["default"] == 80
        assert props["critical_pct"]["default"] == 95


class TestFinOpsValidation:
    def test_critical_must_exceed_warn(self):
        errors = validate_config({"finops": {"warn_pct": 90, "critical_pct": 80}})
        assert any("critical_pct" in e for e in errors)

    def test_equal_thresholds_rejected(self):
        errors = validate_config({"finops": {"warn_pct": 80, "critical_pct": 80}})
        assert any("critical_pct" in e for e in errors)

    def test_valid_thresholds_pass(self):
        errors = validate_config({"finops": {"warn_pct": 80, "critical_pct": 95}})
        assert not any("critical_pct" in e for e in errors)

    def test_negative_budget_rejected(self):
        errors = validate_config({"finops": {"daily_token_budget": -5}})
        assert any("daily_token_budget" in e for e in errors)

    def test_no_finops_section_ok(self):
        assert validate_config({"model": {"name": "gpt-4o-mini"}}) == []


class TestHelpersJs:
    def test_donut_and_strip_helpers_present(self):
        src = HELPERS_JS.read_text()
        assert "export function MiniDonutSVG(" in src
        assert "export function costStripHTML(" in src
        assert "export function budgetBannerHTML(" in src

    def test_math_helpers_present(self):
        src = HELPERS_JS.read_text()
        assert "export function computeBudgetPct(" in src
        assert "export function budgetLevelFor(" in src
        assert "export function sumTodayTokens(" in src
        assert "export function formatTokens(" in src
        assert "export function formatCost(" in src

    def test_donut_empty_state_accessible(self):
        src = HELPERS_JS.read_text()
        assert 'aria-label="No model data"' in src

    def test_strip_navigates_and_is_region(self):
        src = HELPERS_JS.read_text()
        assert 'data-nav="usage"' in src
        assert 'role="region"' in src


class TestOverviewJs:
    def test_finops_imports_and_render(self):
        src = OVERVIEW_JS.read_text()
        assert "costStripHTML" in src
        assert "budgetBannerHTML" in src
        assert "function renderFinOps(" in src
        assert 'id="ov-finops"' in src

    def test_fetches_models_and_config(self):
        src = OVERVIEW_JS.read_text()
        assert "/api/usage/models" in src
        assert "/api/config/runtime" in src

    def test_graceful_degrade_state_machine(self):
        src = OVERVIEW_JS.read_text()
        assert "function finopsState(" in src
        assert "finops.enabled === false" in src


class TestChatJs:
    def test_session_cost_chip_present(self):
        src = CHAT_JS.read_text()
        assert 'id="chat-session-cost-chip"' in src
        assert "function updateSessionCostChip(" in src

    def test_finops_banner_present(self):
        src = CHAT_JS.read_text()
        assert 'id="chat-finops-banner"' in src
        assert "function updateFinopsBanner(" in src
        assert "function loadFinopsConfig(" in src

    def test_chip_updates_on_run_completed(self):
        src = CHAT_JS.read_text()
        assert "updateFinopsBanner()" in src
        assert "updateSessionCostChip(stats)" in src

    def test_context_ring_regression_preserved(self):
        src = CHAT_JS.read_text()
        assert 'id="chat-ring-wrap"' in src
        assert "function ringStateFor(" in src
        assert 'class="chat-ring-send" id="chat-send-btn"' in src


class TestI18nKeys:
    KEYS = [
        "finops.strip.title",
        "finops.strip.today",
        "finops.strip.view_usage",
        "finops.banner.warn",
        "finops.banner.critical",
        "finops.chip.label",
    ]

    def test_all_keys_present_all_locales(self):
        mgr = JSONLocaleManager()
        for locale in ("en", "es", "fr"):
            strings = mgr.get_strings(locale)
            for k in self.KEYS:
                assert k in strings, f"missing {locale} key: {k}"

    def test_banner_interpolates_pct(self):
        mgr = JSONLocaleManager()
        out = mgr.t("finops.banner.warn", locale="en", pct=82)
        assert "82" in out

    def test_chip_interpolates_tokens_and_model(self):
        mgr = JSONLocaleManager()
        out = mgr.t("finops.chip.label", locale="en", tokens="12.4k", model="gpt-4o-mini")
        assert "12.4k" in out
        assert "gpt-4o-mini" in out
