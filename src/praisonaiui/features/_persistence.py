"""Shared persistence helpers for PraisonAIUI features.

Delegates to the unified ``YAMLConfigStore`` in ``config_store.py`` so that
ALL feature state lives in a single ``~/.praisonaiui/config.yaml`` file,
compatible with the ``gateway.yaml`` schema.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


def _store():
    """Lazy import to avoid circular imports at module load time."""
    from praisonaiui.config_store import get_config_store
    return get_config_store()


def load_section(section: str) -> Dict[str, Any]:
    """Load a top-level section from the unified config.yaml."""
    return _store().get_section(section) or {}


def save_section(section: str, data: Dict[str, Any]) -> None:
    """Save a top-level section to the unified config.yaml."""
    _store().set_section(section, data)


def update_item(section: str, item_id: str, data: Dict[str, Any]) -> None:
    """Upsert a single item in a section and write to disk."""
    _store().update_item(section, item_id, data)


def delete_item(section: str, item_id: str) -> bool:
    """Delete a single item from a section. Returns True if found."""
    return _store().delete_item(section, item_id)
