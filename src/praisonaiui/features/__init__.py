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

    Each feature is imported independently so a single broken module
    cannot prevent the rest from registering.
    """
    import importlib
    import logging

    _log = logging.getLogger(__name__)

    # (module_path_relative_to_features_package, class_name)
    _BUILTIN_FEATURES = [
        (".agents", "AgentsCrudFeature"),
        (".approvals", "ApprovalsFeature"),
        (".attachments", "AttachmentsFeature"),
        (".auth", "AuthFeature"),
        (".browser_automation", "BrowserAutomationFeature"),
        (".channels", "ChannelsFeature"),
        (".chat", "ChatFeature"),
        (".code_execution", "CodeExecutionFeature"),
        (".config_hot_reload", "ConfigHotReloadFeature"),
        (".config_runtime", "ConfigRuntimeFeature"),
        (".device_pairing", "DevicePairingFeature"),
        (".hooks", "HooksFeature"),
        (".i18n", "I18nFeature"),
        (".jobs", "JobsFeature"),
        (".logs", "LogsFeature"),
        (".marketplace", "MarketplaceFeature"),
        (".media_analysis", "MediaAnalysisFeature"),
        (".memory", "MemoryFeature"),
        (".knowledge", "KnowledgeFeature"),
        (".model_fallback", "ModelFallbackFeature"),
        (".nodes", "NodesFeature"),
        (".openai_api", "OpenAIAPIFeature"),
        (".protocol_version", "ProtocolFeature"),
        (".pwa", "PWAFeature"),
        (".schedules", "SchedulesFeature"),
        (".sessions_ext", "SessionsFeature"),
        (".skills", "SkillsFeature"),
        (".subagents", "SubagentsFeature"),
        (".theme", "ThemeFeature"),
        (".tts", "TTSFeature"),
        (".usage", "UsageFeature"),
        (".workflows", "WorkflowsFeature"),
        (".guardrails", "GuardrailsFeature"),
        (".eval", "EvalFeature"),
        (".telemetry", "TelemetryFeature"),
        (".tracing", "TracingFeature"),
        (".security", "SecurityFeature"),
    ]

    for mod_path, cls_name in _BUILTIN_FEATURES:
        try:
            mod = importlib.import_module(mod_path, package=__package__)
            cls = getattr(mod, cls_name)
            if cls.feature_name not in _features:
                register_feature(cls())
        except Exception as exc:
            _log.warning(
                "Failed to register feature %s from %s: %s",
                cls_name, mod_path, exc,
            )


__all__ = [
    "BaseFeatureProtocol",
    "register_feature",
    "get_features",
    "get_feature",
    "auto_register_defaults",
]
