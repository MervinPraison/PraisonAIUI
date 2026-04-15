"""Test reset_state() clears all mutable server globals."""

from praisonaiui import server as srv


class TestResetState:
    """Verify reset_state() restores server to pristine condition."""

    def test_callbacks_cleared(self):
        srv._callbacks["test"] = lambda: None
        srv.reset_state()
        assert "test" not in srv._callbacks
        assert len(srv._callbacks) == 0

    def test_agents_cleared(self):
        srv._agents["a1"] = {"name": "a1"}
        srv.reset_state()
        assert len(srv._agents) == 0

    def test_style_reset_to_none(self):
        srv.set_style("dashboard")
        srv.reset_state()
        assert srv._style is None

    def test_branding_reset_to_default(self):
        srv.set_branding(title="Custom", logo="X")
        srv.reset_state()
        assert srv._branding == {"title": "PraisonAI", "logo": "🦞"}

    def test_provider_reset_to_none(self):
        srv._provider = "fake"
        srv.reset_state()
        assert srv._provider is None

    def test_usage_stats_reset(self):
        srv._usage_stats["total_requests"] = 42
        srv.reset_state()
        assert srv._usage_stats["total_requests"] == 0

    # ── G-T1: missing globals ────────────────────────────────────

    def test_chat_mode_reset_to_none(self):
        srv._chat_mode = {"mode": "floating"}
        srv.reset_state()
        assert srv._chat_mode is None

    def test_brand_color_reset_to_none(self):
        srv._brand_color = "#ff0000"
        srv.reset_state()
        assert srv._brand_color is None

    def test_effective_style_reset_to_chat(self):
        srv._effective_style = "dashboard"
        srv.reset_state()
        assert srv._effective_style == "chat"

    def test_selected_profile_reset(self):
        srv._selected_profile = {"id": "prof-1"}
        srv.reset_state()
        assert srv._selected_profile == {"id": None}

    # ── G-T2: ThemeManager singleton ─────────────────────────────

    def test_theme_manager_reset(self):
        from praisonaiui.features.theme import get_theme_manager
        mgr = get_theme_manager()
        mgr.register_theme("test-custom", {"accent": "#abcdef"})
        assert "test-custom" in mgr.list_themes()

        srv.reset_state()

        mgr2 = get_theme_manager()
        assert "test-custom" not in mgr2.list_themes()


class TestThemeIntegration:
    """Tests for theme-related gaps G-T4, G-T5."""

    def setup_method(self):
        srv.reset_state()

    # ── G-T5: Default preset alignment ───────────────────────────

    def test_theme_manager_default_is_zinc(self):
        from praisonaiui.features.theme import get_theme_manager
        mgr = get_theme_manager()
        assert mgr.get_theme() == "zinc"

    def test_theme_manager_default_vars_match_zinc(self):
        from praisonaiui.features.theme import get_theme_manager, PRESET_COLORS
        mgr = get_theme_manager()
        v = mgr.get_vars()
        assert v["--db-accent"] == PRESET_COLORS["zinc"]["accent"]

    # ── G-T4: Server-side theme injection in _build_html ─────────

    def test_build_html_dashboard_includes_theme_vars(self):
        html = srv._build_html("dashboard")
        assert "aiui-server-theme" in html
        # Default zinc accent should be present
        assert "--db-accent" in html

    def test_build_html_dashboard_custom_theme(self):
        from praisonaiui.features.theme import get_theme_manager
        mgr = get_theme_manager()
        mgr.register_theme("teal-dark", {"accent": "#14b8a6"})
        mgr.set_theme("teal-dark")
        html = srv._build_html("dashboard")
        assert "#14b8a6" in html

    def test_build_html_chat_no_theme_vars(self):
        html = srv._build_html("chat")
        assert "aiui-server-theme" not in html
