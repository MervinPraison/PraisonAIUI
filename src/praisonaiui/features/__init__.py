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
    from .attachments import PraisonAIAttachments
    from .auth import PraisonAIAuth
    from .browser_automation import PraisonAIBrowserAutomation
    from .channels import PraisonAIChannels
    from .chat import PraisonAIChat
    from .config_hot_reload import PraisonAIConfigHotReload
    from .config_runtime import PraisonAIConfigRuntime
    from .hooks import PraisonAIHooks
    from .jobs import PraisonAIJobs
    from .logs import PraisonAILogs
    from .memory import PraisonAIMemory
    from .model_fallback import PraisonAIModelFallback
    from .nodes import PraisonAINodes
    from .openai_api import PraisonAIOpenAIAPI
    from .protocol_version import PraisonAIProtocol
    from .schedules import PraisonAISchedules
    from .sessions_ext import PraisonAISessions
    from .skills import PraisonAISkills
    from .subagents import PraisonAISubagents
    from .theme import PraisonAITheme
    from .usage import PraisonAIUsage
    from .workflows import PraisonAIWorkflows

    for cls in (
        PraisonAIAgentsFeature,
        PraisonAIApprovals,
        PraisonAIAttachments,
        PraisonAIAuth,
        PraisonAIBrowserAutomation,
        PraisonAIChannels,
        PraisonAIChat,
        PraisonAIConfigHotReload,
        PraisonAIConfigRuntime,
        PraisonAIHooks,
        PraisonAIJobs,
        PraisonAILogs,
        PraisonAIMemory,
        PraisonAIModelFallback,
        PraisonAINodes,
        PraisonAIOpenAIAPI,
        PraisonAIProtocol,
        PraisonAISchedules,
        PraisonAISessions,
        PraisonAISkills,
        PraisonAISubagents,
        PraisonAITheme,
        PraisonAIUsage,
        PraisonAIWorkflows,
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
