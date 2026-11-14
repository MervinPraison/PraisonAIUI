"""Feature protocol registry — protocol-driven extensibility layer.

Feature protocols (approvals, schedules, memory …) are registered here via
``register_feature()``. The built-in ones are owned by the first-party plugin
records in :mod:`praisonaiui.builtin` and registered by
``auto_register_defaults()``. The server mounts the routes of everything in
``get_features()`` at startup.
"""

from __future__ import annotations

from typing import Dict

from ._base import BaseFeatureProtocol

_features: Dict[str, BaseFeatureProtocol] = {}
# Features auto_register_defaults() added (name -> the instance it registered)
_builtin_registered: Dict[str, BaseFeatureProtocol] = {}


def register_feature(feature: BaseFeatureProtocol) -> None:
    """Register a feature protocol implementation."""
    _features[feature.name] = feature


def get_features() -> Dict[str, BaseFeatureProtocol]:
    """Return all registered features."""
    return dict(_features)


def get_feature(name: str) -> BaseFeatureProtocol | None:
    """Get a feature by name."""
    return _features.get(name)


def auto_register_defaults() -> None:
    """Register the features of every enabled built-in plugin.

    The built-in features are declared by the first-party plugin records in
    :mod:`praisonaiui.builtin` and read through the plugin registry, so the
    extension policy governs them like any plugin::

        extensions:
          disabled: [builtin.training]   # no /api/training routes

    A feature the host itself depends on is marked ``required``: it stays
    registered when its plugin is disabled, and a warning says so.

    Called by ``create_app()``; safe to call more than once (a name that is
    already registered keeps its feature, so ``register_feature()`` before
    this call replaces a built-in). A built-in feature this function added
    earlier is unregistered again once its plugin is disabled.

    Each feature module is imported independently, and only when its plugin
    is on, so a single broken module cannot prevent the rest from registering.
    """
    import logging

    from praisonaiui.builtin import register_builtin_plugins
    from praisonaiui.plugin_registry import get_plugin_registry

    _log = logging.getLogger(__name__)
    registry = get_plugin_registry()
    register_builtin_plugins(registry)

    wanted: set[str] = set()
    for rec in registry.builtin_records():
        enabled = rec.status == "ok"
        hook = getattr(rec.plugin, "features" if enabled else "required_features", None)
        if not callable(hook):
            continue
        try:
            feats = list(hook() or ())
        except Exception as exc:  # noqa: BLE001 - one plugin never blocks the rest
            _log.warning("Failed to load the features of %s: %s", rec.name, exc)
            continue
        if not enabled and feats:
            _log.warning(
                "%s is disabled, but the server needs its %s feature(s); they stay on",
                rec.name,
                ", ".join(f.name for f in feats),
            )
        for feat in feats:
            wanted.add(feat.name)
            if feat.name not in _features:
                register_feature(feat)
                _builtin_registered[feat.name] = feat

    # A built-in feature registered by an earlier call (an earlier create_app()
    # in this process) must not outlive the policy that now disables it.
    for name, feat in list(_builtin_registered.items()):
        if name in wanted:
            continue
        if _features.get(name) is feat:
            del _features[name]
        del _builtin_registered[name]


__all__ = [
    "BaseFeatureProtocol",
    "register_feature",
    "get_features",
    "get_feature",
    "auto_register_defaults",
]
