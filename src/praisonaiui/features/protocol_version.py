"""Protocol versioning feature — WebSocket protocol negotiation (Gap 25).

Protocol-driven: adds version headers to WS handshake.
Config-driven: server advertises version, clients negotiate.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

# Protocol version — increment when wire format changes
PROTOCOL_VERSION = "1.0.0"

# Supported event types (Gap 25 — typed protocol like OpenClaw)
EVENT_TYPES = [
    "chat",
    "chat_abort",
    "chat_delta",
    "chat_complete",
    "run_started",
    "run_content",
    "run_completed",
    "run_error",
    "run_cancelled",
    "tool_call_started",
    "tool_call_completed",
    "reasoning_started",
    "reasoning_step",
    "reasoning_completed",
    "memory_update",
    "session_created",
    "session_closed",
    "config_changed",
    "health",
    "ping",
    "pong",
    "connect",
    "disconnect",
]


# ── Protocol ─────────────────────────────────────────────────────

class ProtocolInfo:
    """Protocol version information."""

    def __init__(self) -> None:
        self.version = PROTOCOL_VERSION
        self.event_types = EVENT_TYPES

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "event_types": self.event_types,
            "features": [
                "chat",
                "streaming",
                "tool_display",
                "abort",
                "session_persistence",
                "theme",
                "config_hot_reload",
                "attachments",
                "markdown_rendering",
            ],
        }

    def is_compatible(self, client_version: str) -> bool:
        """Check if client version is compatible with server."""
        try:
            server_major = int(self.version.split(".")[0])
            client_major = int(client_version.split(".")[0])
            return server_major == client_major
        except (ValueError, IndexError):
            return False


_protocol_info = ProtocolInfo()


def get_protocol_info() -> ProtocolInfo:
    return _protocol_info


# ── HTTP Handlers ────────────────────────────────────────────────

async def _protocol_handler(request: Request) -> JSONResponse:
    """Return protocol version and supported features."""
    return JSONResponse(get_protocol_info().to_dict())


async def _negotiate_handler(request: Request) -> JSONResponse:
    """Negotiate protocol version with client."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    client_version = body.get("version", "")
    info = get_protocol_info()

    return JSONResponse({
        "server_version": info.version,
        "client_version": client_version,
        "compatible": info.is_compatible(client_version),
        "event_types": info.event_types,
    })


# ── Feature ──────────────────────────────────────────────────────

class PraisonAIProtocol(BaseFeatureProtocol):
    """Protocol versioning feature — version negotiation and typed events."""

    feature_name = "protocol"
    feature_description = "WebSocket protocol versioning and negotiation"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/protocol", _protocol_handler, methods=["GET"]),
            Route("/api/protocol/negotiate", _negotiate_handler, methods=["POST"]),
        ]
