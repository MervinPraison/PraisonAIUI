"""Optional L1 backend injection for PraisonAIUI features.

Standalone aiui uses built-in defaults. When integrated with PraisonAI,
the wrapper calls ``set_backend()`` to supply SDK bridges without coupling
aiui to praisonai imports.
"""

from __future__ import annotations

import os
from typing import Any, Callable, Dict, List, Optional

_backends: Dict[str, Any] = {}


def set_backend(name: str, impl: Any) -> None:
    """Register a backend implementation for a feature area."""
    _backends[name] = impl


def get_backend(name: str, default: Any = None) -> Any:
    """Return a registered backend or *default*."""
    return _backends.get(name, default)


def clear_backends() -> None:
    """Clear all injected backends (tests)."""
    _backends.clear()


def list_backends() -> List[str]:
    """Return names of registered backends."""
    return list(_backends.keys())


def is_integrated_mode() -> bool:
    """True when PraisonAI host has injected SDK bridges."""
    if os.environ.get("PRAISONAI_INTEGRATED", "").strip().lower() in ("1", "true", "yes"):
        return True
    return any(k in _backends for k in ("hooks", "workflows", "usage_query", "usage_sink"))


def get_workflow_runner() -> Optional[Callable[..., Dict[str, Any]]]:
    """Return workflow runner if injected."""
    runner = get_backend("workflows")
    return runner if callable(runner) else None


def get_hooks_lister() -> Optional[Callable[[], list]]:
    """Return SDK hooks lister if injected."""
    lister = get_backend("hooks")
    return lister if callable(lister) else None


def get_usage_sink() -> Any:
    """Return TokenUsageSinkProtocol implementation if injected."""
    return get_backend("usage_sink")


def get_usage_query() -> Optional[Callable[..., Any]]:
    """Return SDK usage query callable if injected."""
    query = get_backend("usage_query")
    return query if callable(query) else None


def get_approvals_lister() -> Optional[Callable[..., List[Dict[str, Any]]]]:
    """Return SDK approvals lister callable if injected."""
    lister = get_backend("approvals")
    return lister if callable(lister) else None


def get_jobs_store_factory() -> Optional[Callable[[], Any]]:
    """Return jobs store factory if injected by praisonai host."""
    factory = get_backend("jobs_store")
    return factory if callable(factory) else None


def get_jobs_executor_factory() -> Optional[Callable[[], Any]]:
    """Return jobs executor factory if injected by praisonai host."""
    factory = get_backend("jobs_executor")
    return factory if callable(factory) else None


def get_channel_bot_factory() -> Optional[Callable[..., Any]]:
    """Return channel bot factory(platform, token, agent, config) if injected."""
    factory = get_backend("channel_bot")
    return factory if callable(factory) else None


def get_tool_resolver() -> Any:
    """Return ToolResolver-like object from backend or praisonai wrapper."""
    resolver = get_backend("tool_resolver")
    if resolver is not None:
        return resolver() if callable(resolver) and not hasattr(resolver, "resolve") else resolver
    try:
        from praisonai.tool_resolver import ToolResolver

        return ToolResolver()
    except ImportError:
        return None


def get_kanban_store_factory() -> Optional[Callable[[], Any]]:
    """Return kanban store factory if injected by praisonai host."""
    factory = get_backend("kanban_store")
    return factory if callable(factory) else None


def get_kanban_api_base() -> Optional[str]:
    """Optional external kanban API base (wrapper mounts its own router)."""
    base = get_backend("kanban_api_base")
    return str(base).rstrip("/") if base else None


def resolve_tools(tool_names: List[Any]) -> List[Any]:
    """Resolve tool name strings via injected or default ToolResolver."""
    resolver = get_tool_resolver()
    if resolver is None:
        return []
    resolved: List[Any] = []
    for name in tool_names:
        if isinstance(name, str) and name.strip():
            tool = resolver.resolve(name.strip())
            if tool is not None:
                resolved.append(tool)
    return resolved
