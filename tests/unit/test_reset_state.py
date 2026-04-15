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
