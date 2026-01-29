"""Tests for plugin system."""

from typing import Any, Dict, List

import pytest

from praisonaiui.plugins import (
    BasePlugin,
    PluginManager,
    PluginProtocol,
    get_plugin_manager,
    register_plugin,
    unregister_plugin,
)
from praisonaiui.schema import Config


class TestPluginManager:
    """Tests for PluginManager."""

    def test_register_plugin(self):
        """Test registering a plugin."""
        manager = PluginManager()

        class TestPlugin(BasePlugin):
            @property
            def name(self) -> str:
                return "test-plugin"

        plugin = TestPlugin()
        manager.register(plugin)

        assert "test-plugin" in manager.list_plugins()
        assert manager.get_plugin("test-plugin") is plugin

    def test_register_duplicate_raises(self):
        """Test registering duplicate plugin raises error."""
        manager = PluginManager()

        class TestPlugin(BasePlugin):
            @property
            def name(self) -> str:
                return "duplicate"

        manager.register(TestPlugin())

        with pytest.raises(ValueError, match="already registered"):
            manager.register(TestPlugin())

    def test_unregister_plugin(self):
        """Test unregistering a plugin."""
        manager = PluginManager()

        class TestPlugin(BasePlugin):
            @property
            def name(self) -> str:
                return "to-remove"

        manager.register(TestPlugin())
        assert "to-remove" in manager.list_plugins()

        manager.unregister("to-remove")
        assert "to-remove" not in manager.list_plugins()

    def test_unregister_unknown_raises(self):
        """Test unregistering unknown plugin raises error."""
        manager = PluginManager()

        with pytest.raises(ValueError, match="not found"):
            manager.unregister("nonexistent")

    def test_run_hook_chain(self):
        """Test hooks are called in chain, modifying data."""
        manager = PluginManager()

        class DoublePlugin(BasePlugin):
            @property
            def name(self) -> str:
                return "double"

            def on_scan_complete(self, pages: List[Any]) -> List[Any]:
                return pages + pages  # Double the list

        class FilterPlugin(BasePlugin):
            @property
            def name(self) -> str:
                return "filter"

            def on_scan_complete(self, pages: List[Any]) -> List[Any]:
                return [p for p in pages if p != "remove"]

        manager.register(DoublePlugin())
        manager.register(FilterPlugin())

        result = manager.run_hook("scan_complete", ["a", "remove", "b"])
        # Both plugins run, filter then double (or vice versa depending on order)
        assert "remove" not in result

    def test_run_hook_unknown_raises(self):
        """Test running unknown hook raises error."""
        manager = PluginManager()

        with pytest.raises(ValueError, match="Unknown hook"):
            manager.run_hook("nonexistent", {})


class TestBasePlugin:
    """Tests for BasePlugin."""

    def test_default_hooks_pass_through(self):
        """Test default hook implementations pass data through."""

        class MinimalPlugin(BasePlugin):
            @property
            def name(self) -> str:
                return "minimal"

        plugin = MinimalPlugin()

        # All defaults should return input unchanged
        pages = [1, 2, 3]
        assert plugin.on_scan_complete(pages) is pages

        nav = {"items": []}
        assert plugin.on_nav_built(nav) is nav

        result = {"data": "test"}
        assert plugin.on_compile_complete(result) is result


class TestGlobalManager:
    """Tests for global plugin manager functions."""

    def test_get_plugin_manager_singleton(self):
        """Test global manager is singleton."""
        # Reset global
        import praisonaiui.plugins as pm

        pm._plugin_manager = None

        m1 = get_plugin_manager()
        m2 = get_plugin_manager()
        assert m1 is m2

    def test_register_unregister_global(self):
        """Test global register/unregister functions."""
        import praisonaiui.plugins as pm

        pm._plugin_manager = None  # Reset

        class GlobalTestPlugin(BasePlugin):
            @property
            def name(self) -> str:
                return "global-test"

        register_plugin(GlobalTestPlugin())
        assert "global-test" in get_plugin_manager().list_plugins()

        unregister_plugin("global-test")
        assert "global-test" not in get_plugin_manager().list_plugins()
