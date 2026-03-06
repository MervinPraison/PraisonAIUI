"""Gateway reference singleton — thread-safe accessor for the live gateway.

Provides a module-level reference to the running WebSocketGateway instance
so that feature modules (channels, nodes, etc.) can query live state.

Usage:
    # Set by AIUIGateway.start() or integration code:
    from praisonaiui.features._gateway_ref import set_gateway
    set_gateway(ws_gateway_instance)

    # Read by feature modules:
    from praisonaiui.features._gateway_ref import get_gateway
    gw = get_gateway()
    if gw:
        health = gw.health()
"""

from __future__ import annotations

import threading
from typing import Any, Optional

_lock = threading.Lock()
_gateway_instance: Optional[Any] = None


def set_gateway(gw: Optional[Any]) -> None:
    """Set the live gateway reference (or None to clear)."""
    global _gateway_instance
    with _lock:
        _gateway_instance = gw


def get_gateway() -> Optional[Any]:
    """Get the current gateway reference, or None if not set."""
    with _lock:
        return _gateway_instance
