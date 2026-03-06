"""Feature protocol registry — protocol-driven extensibility layer.

Every feature module (approvals, schedules, memory …) registers itself
here via ``register_feature()``.  The server discovers all features at
startup via ``get_features()`` and mounts their routes automatically.
"""

from __future__ import annotations

from typing import Dict

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
    from .agents import PraisonAIAgentsFeature
    from .approvals import PraisonAIApprovals
    from .auth import PraisonAIAuth
    from .channels import PraisonAIChannels
    from .openai_api import PraisonAIOpenAIAPI
    from .config_runtime import PraisonAIConfigRuntime
    from .hooks import PraisonAIHooks
    from .jobs import PraisonAIJobs
    from .logs import PraisonAILogs
    from .memory import PraisonAIMemory
    from .usage import PraisonAIUsage
    from .nodes import PraisonAINodes
    from .schedules import PraisonAISchedules
    from .sessions_ext import PraisonAISessions
    from .skills import PraisonAISkills
    from .workflows import PraisonAIWorkflows

    for cls in (
        PraisonAIAgentsFeature,
        PraisonAIApprovals,
        PraisonAIAuth,
        PraisonAIChannels,
        PraisonAIJobs,
        PraisonAILogs,
        PraisonAIOpenAIAPI,
        PraisonAISchedules,
        PraisonAIMemory,
        PraisonAINodes,
        PraisonAISessions,
        PraisonAISkills,
        PraisonAIHooks,
        PraisonAIWorkflows,
        PraisonAIConfigRuntime,
        PraisonAIUsage,
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
