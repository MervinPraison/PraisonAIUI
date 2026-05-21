"""Default SDK hooks lister — used when no backend injected."""

from __future__ import annotations

from typing import Any, Dict, List


def list_sdk_hooks() -> List[Dict[str, Any]]:
    """Flat hook list from praisonaiagents HookRegistry."""
    try:
        from praisonaiagents.hooks import get_default_registry

        registry = get_default_registry()
        flat: List[Dict[str, Any]] = []
        for event, hooks in registry.list_hooks().items():
            for h in hooks:
                flat.append({"event": event, "source": "sdk", **h})
        return flat
    except ImportError:
        return []
