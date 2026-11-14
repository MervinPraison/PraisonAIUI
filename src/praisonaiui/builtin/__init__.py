"""First-party plugins: the pages that ship with PraisonAIUI.

The host has no page list of its own. Everything in the nav by default comes
from the records in :mod:`praisonaiui.builtin.catalog`, registered with
:meth:`PluginRegistry.register_builtin` and read back through the registry,
the same way a third-party plugin's pages are. That makes them addressable by
the extension policy::

    extensions:
      disabled: [builtin.training, builtin.logs]

    aiui.set_extensions(disabled=["builtin.training"])

A disabled built-in contributes no pages: they leave ``GET /api/pages`` and
the shell manifest. ``set_pages`` / ``pages.enabled`` / ``pages.disabled`` /
``remove_page`` keep working on top (they filter single pages by id).
"""

from __future__ import annotations

from typing import Any, Optional

from ._plugin import BuiltinPlugin, page
from .catalog import BUILTIN_PLUGINS


def register_builtin_plugins(registry: Optional[Any] = None) -> None:
    """Register every first-party plugin (idempotent).

    Called by ``create_app()``. A built-in already registered under the same
    name is left alone, so a host may register its own replacement first.
    """
    if registry is None:
        from praisonaiui.plugin_registry import get_plugin_registry

        registry = get_plugin_registry()
    known = {rec.name for rec in registry.builtin_records()}
    for plugin in BUILTIN_PLUGINS:
        if f"builtin.{plugin.name}" not in known:
            registry.register_builtin(plugin)


__all__ = ["BUILTIN_PLUGINS", "BuiltinPlugin", "page", "register_builtin_plugins"]
