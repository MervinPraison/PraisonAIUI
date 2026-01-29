"""Plugin system for PraisonAIUI.

Provides extensibility through hooks and custom component registration.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Protocol

from .schema import Config


class PluginProtocol(Protocol):
    """Protocol that all plugins must implement."""

    @property
    def name(self) -> str:
        """Unique plugin name."""
        ...

    def on_config_loaded(self, config: Config) -> Config:
        """Called after config is loaded. Can modify config."""
        ...

    def on_scan_complete(self, pages: List[Any]) -> List[Any]:
        """Called after docs are scanned. Can modify pages."""
        ...

    def on_nav_built(self, nav: Dict[str, Any]) -> Dict[str, Any]:
        """Called after navigation is built. Can modify nav."""
        ...

    def on_compile_complete(self, result: Any) -> Any:
        """Called after compilation. Can modify result."""
        ...


@dataclass
class PluginHook:
    """A registered hook callback."""

    plugin_name: str
    callback: Callable
    priority: int = 0  # Higher runs first


class PluginManager:
    """Manages plugin registration and hook execution."""

    def __init__(self) -> None:
        self._plugins: Dict[str, PluginProtocol] = {}
        self._hooks: Dict[str, List[PluginHook]] = {
            "config_loaded": [],
            "scan_complete": [],
            "nav_built": [],
            "compile_complete": [],
        }

    def register(self, plugin: PluginProtocol) -> None:
        """Register a plugin."""
        if plugin.name in self._plugins:
            raise ValueError(f"Plugin '{plugin.name}' already registered")
        self._plugins[plugin.name] = plugin

        # Auto-register hooks based on methods
        if hasattr(plugin, "on_config_loaded"):
            self._hooks["config_loaded"].append(PluginHook(plugin.name, plugin.on_config_loaded))
        if hasattr(plugin, "on_scan_complete"):
            self._hooks["scan_complete"].append(PluginHook(plugin.name, plugin.on_scan_complete))
        if hasattr(plugin, "on_nav_built"):
            self._hooks["nav_built"].append(PluginHook(plugin.name, plugin.on_nav_built))
        if hasattr(plugin, "on_compile_complete"):
            self._hooks["compile_complete"].append(
                PluginHook(plugin.name, plugin.on_compile_complete)
            )

    def unregister(self, plugin_name: str) -> None:
        """Unregister a plugin."""
        if plugin_name not in self._plugins:
            raise ValueError(f"Plugin '{plugin_name}' not found")
        del self._plugins[plugin_name]

        # Remove hooks
        for hook_list in self._hooks.values():
            hook_list[:] = [h for h in hook_list if h.plugin_name != plugin_name]

    def get_plugin(self, name: str) -> Optional[PluginProtocol]:
        """Get a registered plugin by name."""
        return self._plugins.get(name)

    def list_plugins(self) -> List[str]:
        """List all registered plugin names."""
        return list(self._plugins.keys())

    def run_hook(self, hook_name: str, data: Any) -> Any:
        """Run all callbacks for a hook, passing data through chain."""
        if hook_name not in self._hooks:
            raise ValueError(f"Unknown hook '{hook_name}'")

        # Sort by priority (higher first)
        hooks = sorted(self._hooks[hook_name], key=lambda h: -h.priority)

        result = data
        for hook in hooks:
            result = hook.callback(result)
        return result


class BasePlugin(ABC):
    """Base class for plugins with default no-op implementations."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Plugin name - must be overridden."""
        pass

    def on_config_loaded(self, config: Config) -> Config:
        """Default: pass through unchanged."""
        return config

    def on_scan_complete(self, pages: List[Any]) -> List[Any]:
        """Default: pass through unchanged."""
        return pages

    def on_nav_built(self, nav: Dict[str, Any]) -> Dict[str, Any]:
        """Default: pass through unchanged."""
        return nav

    def on_compile_complete(self, result: Any) -> Any:
        """Default: pass through unchanged."""
        return result


# Global plugin manager instance
_plugin_manager: Optional[PluginManager] = None


def get_plugin_manager() -> PluginManager:
    """Get or create the global plugin manager."""
    global _plugin_manager
    if _plugin_manager is None:
        _plugin_manager = PluginManager()
    return _plugin_manager


def register_plugin(plugin: PluginProtocol) -> None:
    """Register a plugin with the global manager."""
    get_plugin_manager().register(plugin)


def unregister_plugin(plugin_name: str) -> None:
    """Unregister a plugin from the global manager."""
    get_plugin_manager().unregister(plugin_name)
