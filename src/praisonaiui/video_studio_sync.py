"""Signals for Video Studio UI to reload after agent tool updates."""

from __future__ import annotations

_pending_refresh: set[str] = set()


def mark_project_refresh(project_id: str) -> None:
    _pending_refresh.add(project_id)


def consume_project_refresh(project_id: str) -> bool:
    if project_id in _pending_refresh:
        _pending_refresh.discard(project_id)
        return True
    return False
