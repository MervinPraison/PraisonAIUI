"""Shared pytest hooks for PraisonAIUI unit tests."""

from __future__ import annotations

import sys
from pathlib import Path

_MEETING_AGENT_ROOT = (
    Path(__file__).resolve().parents[2] / "examples" / "python" / "meeting-agent"
)


def _ensure_meeting_agent_integrations() -> None:
    """Prefer meeting-agent ``integrations/`` over ``tests/unit/integrations/``."""
    root = str(_MEETING_AGENT_ROOT)
    if sys.path[:1] != [root]:
        if root in sys.path:
            sys.path.remove(root)
        sys.path.insert(0, root)
    for name in list(sys.modules):
        if name == "integrations" or name.startswith("integrations."):
            del sys.modules[name]


def pytest_runtest_setup(item) -> None:
    if "meeting_agent" in item.nodeid.replace("\\", "/"):
        _ensure_meeting_agent_integrations()
