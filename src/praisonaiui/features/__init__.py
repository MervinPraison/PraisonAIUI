"""Feature protocol registry — protocol-driven extensibility layer.

Every feature module (approvals, schedules, memory …) registers itself
here via ``register_feature()``.  The server discovers all features at
startup via ``get_features()`` and mounts their routes automatically.
"""

from __future__ import annotations

from typing import Dict, List

from ._base import BaseFeatureProtocol

_features: Dict[str, BaseFeatureProtocol] = {}


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
    """Register all built-in feature modules.

    Called once by ``create_app()`` — safe to call multiple times
    (idempotent: skips already-registered features).
    """
    from .approvals import PraisonAIApprovals
    from .schedules import PraisonAISchedules
    from .memory import PraisonAIMemory
    from .sessions_ext import PraisonAISessions
    from .skills import PraisonAISkills
    from .hooks import PraisonAIHooks
    from .workflows import PraisonAIWorkflows
    from .config_runtime import PraisonAIConfigRuntime

    for cls in (
        PraisonAIApprovals,
        PraisonAISchedules,
        PraisonAIMemory,
        PraisonAISessions,
        PraisonAISkills,
        PraisonAIHooks,
        PraisonAIWorkflows,
        PraisonAIConfigRuntime,
    ):
        if cls.feature_name not in _features:
            register_feature(cls())


__all__ = [
    "BaseFeatureProtocol",
    "register_feature",
    "get_features",
    "get_feature",
    "auto_register_defaults",
]
