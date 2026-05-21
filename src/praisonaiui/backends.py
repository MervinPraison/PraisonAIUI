"""Optional L1 backend injection for PraisonAIUI features.

Standalone aiui uses built-in defaults. When integrated with PraisonAI,
the wrapper calls ``set_backend()`` to supply SDK bridges without coupling
aiui to praisonai imports.
"""

from __future__ import annotations

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
