"""Shared gateway health helpers — eliminates DRY violations.

Every feature that checks gateway connectivity was inlining the same
~10-line try/except block.  This module provides a single helper that
all features can import instead.

Usage:
    from ._gateway_helpers import gateway_health

    async def health(self):
        return {"status": "ok", **gateway_health()}
"""

from __future__ import annotations

from typing import Any, Dict, List


def gateway_health() -> Dict[str, Any]:
    """Return gateway connectivity info for health responses.

    Returns:
        {"gateway_connected": bool, "gateway_agent_count": int}
    """
    try:
        from ._gateway_ref import get_gateway

        gw = get_gateway()
        if gw is not None:
            agents = list(gw.list_agents())
            return {
                "gateway_connected": True,
                "gateway_agent_count": len(agents),
            }
    except (ImportError, Exception):
        pass
    return {"gateway_connected": False, "gateway_agent_count": 0}


def gateway_agents() -> List[Any]:
    """Return list of gateway-registered agent objects (or [])."""
    try:
        from ._gateway_ref import get_gateway

        gw = get_gateway()
        if gw is not None:
            return [gw.get_agent(aid) for aid in gw.list_agents() if gw.get_agent(aid) is not None]
    except (ImportError, Exception):
        pass
    return []
