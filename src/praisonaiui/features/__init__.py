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
    from .agents import AgentsCrudFeature
    from .approvals import ApprovalsFeature
    from .attachments import AttachmentsFeature
    from .auth import AuthFeature
    from .browser_automation import BrowserAutomationFeature
    from .channels import ChannelsFeature
    from .chat import ChatFeature
    from .code_execution import CodeExecutionFeature
    from .config_hot_reload import ConfigHotReloadFeature
    from .config_runtime import ConfigRuntimeFeature
    from .device_pairing import DevicePairingFeature
    from .hooks import HooksFeature
    from .i18n import I18nFeature
    from .jobs import JobsFeature
    from .logs import LogsFeature
    from .marketplace import MarketplaceFeature
    from .media_analysis import MediaAnalysisFeature
    from .memory import MemoryFeature
    from .knowledge import KnowledgeFeature
    from .model_fallback import ModelFallbackFeature
    from .nodes import NodesFeature
    from .openai_api import OpenAIAPIFeature
    from .protocol_version import ProtocolFeature
    from .pwa import PWAFeature
    from .schedules import SchedulesFeature
    from .sessions_ext import SessionsFeature
    from .skills import SkillsFeature
    from .subagents import SubagentsFeature
    from .theme import ThemeFeature
    from .tts import TTSFeature
    from .usage import UsageFeature
    from .workflows import WorkflowsFeature
    from .guardrails import GuardrailsFeature
    from .eval import EvalFeature
    from .telemetry import TelemetryFeature
    from .tracing import TracingFeature
    from .security import SecurityFeature

    for cls in (
        AgentsCrudFeature,
        ApprovalsFeature,
        AttachmentsFeature,
        AuthFeature,
        BrowserAutomationFeature,
        ChannelsFeature,
        ChatFeature,
        CodeExecutionFeature,
        ConfigHotReloadFeature,
        ConfigRuntimeFeature,
        DevicePairingFeature,
        HooksFeature,
        I18nFeature,
        JobsFeature,
        LogsFeature,
        MarketplaceFeature,
        MediaAnalysisFeature,
        MemoryFeature,
        KnowledgeFeature,
        ModelFallbackFeature,
        NodesFeature,
        OpenAIAPIFeature,
        ProtocolFeature,
        PWAFeature,
        SchedulesFeature,
        SessionsFeature,
        SkillsFeature,
        SubagentsFeature,
        ThemeFeature,
        TTSFeature,
        UsageFeature,
        WorkflowsFeature,
        GuardrailsFeature,
        EvalFeature,
        TelemetryFeature,
        TracingFeature,
        SecurityFeature,
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
