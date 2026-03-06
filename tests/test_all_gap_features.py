"""Comprehensive tests for ALL gap features (Gaps 1-25).

Tests each new feature module:
  * Protocol compliance (BaseFeatureProtocol)
  * Data models
  * Manager implementations
  * Auto-registration
"""

from __future__ import annotations

import pytest


# ── Helper ───────────────────────────────────────────────────────

def _make_features():
    """Auto-register and return features dict."""
    from praisonaiui.features import auto_register_defaults, get_features
    auto_register_defaults()
    return get_features()


# ═══════════════════════════════════════════════════════════════════
# Gap 1-5: Chat Feature
# ═══════════════════════════════════════════════════════════════════

class TestChatFeature:
    def test_registered(self):
        features = _make_features()
        assert "chat" in features

    def test_protocol_compliance(self):
        from praisonaiui.features.chat import PraisonAIChat
        f = PraisonAIChat()
        assert f.name == "chat"
        assert len(f.routes()) >= 3

    @pytest.mark.asyncio
    async def test_send_and_history(self):
        from praisonaiui.features.chat import ChatManager
        mgr = ChatManager()
        result = await mgr.send_message("hi", session_id="s1")
        assert "message_id" in result
        history = await mgr.get_history("s1")
        assert len(history) == 1
        assert history[0]["content"] == "hi"

    @pytest.mark.asyncio
    async def test_abort_no_run(self):
        from praisonaiui.features.chat import ChatManager
        mgr = ChatManager()
        r = await mgr.abort_run("nonexistent")
        assert r["status"] == "no_active_run"

    def test_chat_message_model(self):
        from praisonaiui.features.chat import ChatMessage
        msg = ChatMessage(role="user", content="test", session_id="s1")
        d = msg.to_dict()
        assert d["role"] == "user"
        assert "message_id" in d
        assert "timestamp" in d


# ═══════════════════════════════════════════════════════════════════
# Gap 6: Attachments Feature
# ═══════════════════════════════════════════════════════════════════

class TestAttachmentsFeature:
    def test_registered(self):
        features = _make_features()
        assert "attachments" in features

    def test_protocol_compliance(self):
        from praisonaiui.features.attachments import PraisonAIAttachments
        f = PraisonAIAttachments()
        assert f.name == "attachments"
        paths = [r.path for r in f.routes()]
        assert "/api/chat/attachments" in paths

    def test_upload_and_list(self):
        from praisonaiui.features.attachments import AttachmentManager
        mgr = AttachmentManager()
        meta = mgr.upload(
            data=b"hello world",
            filename="test.txt",
            content_type="text/plain",
            session_id="s1",
        )
        assert meta["id"]
        assert meta["size"] == 11
        items = mgr.list_for_session("s1")
        assert len(items) == 1
        # cleanup
        mgr.delete(meta["id"])

    def test_upload_too_large(self):
        from praisonaiui.features.attachments import AttachmentManager
        mgr = AttachmentManager(max_size_mb=0)
        with pytest.raises(ValueError, match="too large"):
            mgr.upload(b"x", "f.txt", "text/plain")

    def test_upload_bad_type(self):
        from praisonaiui.features.attachments import AttachmentManager
        mgr = AttachmentManager()
        with pytest.raises(ValueError, match="not allowed"):
            mgr.upload(b"x", "f.exe", "application/x-executable")


# ═══════════════════════════════════════════════════════════════════
# Gap 8: Config Hot-Reload Feature
# ═══════════════════════════════════════════════════════════════════

class TestConfigHotReloadFeature:
    def test_registered(self):
        features = _make_features()
        assert "config_hot_reload" in features

    def test_protocol_compliance(self):
        from praisonaiui.features.config_hot_reload import PraisonAIConfigHotReload
        f = PraisonAIConfigHotReload()
        assert f.name == "config_hot_reload"
        assert len(f.routes()) >= 3

    def test_watcher_status(self):
        from praisonaiui.features.config_hot_reload import ConfigWatcher
        w = ConfigWatcher(poll_interval=1.0)
        status = w.get_status()
        assert status["watching"] is False
        assert status["poll_interval"] == 1.0


# ═══════════════════════════════════════════════════════════════════
# Gap 10: Model Fallback Feature
# ═══════════════════════════════════════════════════════════════════

class TestModelFallbackFeature:
    def test_registered(self):
        features = _make_features()
        assert "model_fallback" in features

    def test_protocol_compliance(self):
        from praisonaiui.features.model_fallback import PraisonAIModelFallback
        f = PraisonAIModelFallback()
        assert f.name == "model_fallback"

    def test_fallback_chain(self):
        from praisonaiui.features.model_fallback import ModelFallbackManager
        mgr = ModelFallbackManager()
        assert mgr.get_fallback_chain() == []
        mgr.set_fallback_chain(["gpt-4o", "gpt-4o-mini"])
        assert mgr.get_fallback_chain() == ["gpt-4o", "gpt-4o-mini"]

    def test_models_list(self):
        from praisonaiui.features.model_fallback import ModelFallbackManager
        mgr = ModelFallbackManager()
        models = mgr.get_models()
        assert len(models) > 0


# ═══════════════════════════════════════════════════════════════════
# Gap 15: Subagents Feature
# ═══════════════════════════════════════════════════════════════════

class TestSubagentsFeature:
    def test_registered(self):
        features = _make_features()
        assert "subagents" in features

    def test_protocol_compliance(self):
        from praisonaiui.features.subagents import PraisonAISubagents
        f = PraisonAISubagents()
        assert f.name == "subagents"

    def test_spawn_and_tree(self):
        from praisonaiui.features.subagents import SubagentManager
        mgr = SubagentManager()
        mgr.register_spawn("parent", "child", "s1")
        tree = mgr.get_tree("s1")
        assert tree["total_spawns"] == 1
        assert len(tree["roots"]) == 1
        assert tree["roots"][0]["name"] == "parent"
        assert tree["roots"][0]["children"][0]["name"] == "child"


# ═══════════════════════════════════════════════════════════════════
# Gap 19: Theme Feature
# ═══════════════════════════════════════════════════════════════════

class TestThemeFeature:
    def test_registered(self):
        features = _make_features()
        assert "theme" in features

    def test_protocol_compliance(self):
        from praisonaiui.features.theme import PraisonAITheme
        f = PraisonAITheme()
        assert f.name == "theme"

    def test_themes_available(self):
        from praisonaiui.features.theme import ThemeManager
        mgr = ThemeManager()
        themes = mgr.list_themes()
        assert "dark" in themes
        assert "light" in themes

    def test_set_theme(self):
        from praisonaiui.features.theme import ThemeManager
        mgr = ThemeManager()
        assert mgr.get_theme() == "dark"
        mgr.set_theme("light")
        assert mgr.get_theme() == "light"

    def test_css_vars(self):
        from praisonaiui.features.theme import ThemeManager
        mgr = ThemeManager()
        v = mgr.get_vars("dark")
        assert "--chat-bg" in v
        assert "--chat-text" in v

    def test_custom_theme(self):
        from praisonaiui.features.theme import ThemeManager
        mgr = ThemeManager()
        mgr.register_theme("ocean", {"--chat-bg": "#001122"})
        assert "ocean" in mgr.list_themes()
        v = mgr.get_vars("ocean")
        assert v["--chat-bg"] == "#001122"


# ═══════════════════════════════════════════════════════════════════
# Gap 22: Browser Automation Feature
# ═══════════════════════════════════════════════════════════════════

class TestBrowserAutomationFeature:
    def test_registered(self):
        features = _make_features()
        assert "browser_automation" in features

    def test_protocol_compliance(self):
        from praisonaiui.features.browser_automation import PraisonAIBrowserAutomation
        f = PraisonAIBrowserAutomation()
        assert f.name == "browser_automation"

    def test_status(self):
        from praisonaiui.features.browser_automation import BrowserAutomationManager
        mgr = BrowserAutomationManager()
        status = mgr.get_status()
        assert "available" in status
        assert "backends" in status


# ═══════════════════════════════════════════════════════════════════
# Gap 25: Protocol Version Feature
# ═══════════════════════════════════════════════════════════════════

class TestProtocolVersionFeature:
    def test_registered(self):
        features = _make_features()
        assert "protocol" in features

    def test_protocol_compliance(self):
        from praisonaiui.features.protocol_version import PraisonAIProtocol
        f = PraisonAIProtocol()
        assert f.name == "protocol"

    def test_version_info(self):
        from praisonaiui.features.protocol_version import ProtocolInfo
        info = ProtocolInfo()
        d = info.to_dict()
        assert "version" in d
        assert "event_types" in d
        assert "features" in d

    def test_compatibility(self):
        from praisonaiui.features.protocol_version import ProtocolInfo
        info = ProtocolInfo()
        assert info.is_compatible("1.0.0")
        assert info.is_compatible("1.5.0")
        assert not info.is_compatible("2.0.0")
        assert not info.is_compatible("invalid")

    def test_event_types(self):
        from praisonaiui.features.protocol_version import EVENT_TYPES
        assert "chat" in EVENT_TYPES
        assert "run_content" in EVENT_TYPES
        assert "tool_call_started" in EVENT_TYPES


# ═══════════════════════════════════════════════════════════════════
# Meta: All Features Registered
# ═══════════════════════════════════════════════════════════════════

class TestAllFeaturesRegistered:
    def test_total_feature_count(self):
        features = _make_features()
        # Original 16 + 7 new = 23+
        assert len(features) >= 23

    def test_all_new_features_present(self):
        features = _make_features()
        new_features = [
            "chat", "theme", "config_hot_reload", "protocol",
            "attachments", "model_fallback", "browser_automation",
            "subagents",
        ]
        for name in new_features:
            assert name in features, f"Feature '{name}' not registered"

    @pytest.mark.asyncio
    async def test_all_features_healthy(self):
        features = _make_features()
        for name, f in features.items():
            h = await f.health()
            assert h["status"] in ("ok", "degraded"), f"Feature '{name}' unhealthy: {h}"
