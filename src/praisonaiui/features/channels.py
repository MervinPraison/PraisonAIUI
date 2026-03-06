"""Channels feature — multi-platform messaging channel management.

Provides API endpoints and CLI commands for managing communication
channels (Discord, Slack, Telegram, WhatsApp, etc.) and querying
live status from the gateway when available.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# Supported channel platforms
SUPPORTED_PLATFORMS = [
    "discord", "slack", "telegram", "whatsapp",
    "imessage", "signal", "googlechat", "nostr",
]

# In-memory channel registry
_channels: Dict[str, Dict[str, Any]] = {}


class PraisonAIChannels(BaseFeatureProtocol):
    """Channel management wired to praisonai gateway bots."""

    feature_name = "channels"
    feature_description = "Multi-platform messaging channel management"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/channels", self._list, methods=["GET"]),
            Route("/api/channels", self._add, methods=["POST"]),
            Route("/api/channels/platforms", self._platforms, methods=["GET"]),
            Route("/api/channels/{channel_id}", self._get, methods=["GET"]),
            Route("/api/channels/{channel_id}", self._update, methods=["PUT"]),
            Route("/api/channels/{channel_id}", self._delete, methods=["DELETE"]),
            Route("/api/channels/{channel_id}/toggle", self._toggle, methods=["POST"]),
            Route("/api/channels/{channel_id}/status", self._status, methods=["GET"]),
            Route("/api/channels/{channel_id}/restart", self._restart, methods=["POST"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "channel",
            "help": "Manage messaging channels",
            "commands": {
                "list": {"help": "List configured channels", "handler": self._cli_list},
                "status": {"help": "Show channel status", "handler": self._cli_status_cli},
                "platforms": {"help": "List supported platforms", "handler": self._cli_platforms},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        running = sum(1 for c in _channels.values() if c.get("running", False))
        gw = self._get_gateway_health()
        return {
            "status": "ok",
            "feature": self.name,
            "total_channels": len(_channels),
            "running_channels": running,
            "supported_platforms": SUPPORTED_PLATFORMS,
            "gateway_connected": gw is not None,
        }

    # ── Gateway integration ──────────────────────────────────────────

    def _get_gateway_health(self) -> Dict[str, Any] | None:
        """Get live channel status from the gateway via _gateway_ref.

        Returns the 'channels' dict from the gateway's health() response,
        or None if no gateway is connected.
        """
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None and hasattr(gw, 'health'):
                health = gw.health()
                return health.get("channels", {})
        except Exception:
            pass
        return None

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all configured channels with live status."""
        channels = list(_channels.values())
        # Enrich with live gateway status if available
        gw_status = self._get_gateway_health()
        if gw_status:
            for ch in channels:
                gw_ch = gw_status.get(ch["id"], {})
                ch["running"] = gw_ch.get("running", ch.get("running", False))
                ch["platform"] = gw_ch.get("platform", ch.get("platform", "unknown"))
        return JSONResponse({"channels": channels, "count": len(channels)})

    async def _add(self, request: Request) -> JSONResponse:
        """Add a new channel configuration."""
        body = await request.json()
        channel_id = body.get("id", uuid.uuid4().hex[:12])
        platform = body.get("platform", "").lower()
        if platform and platform not in SUPPORTED_PLATFORMS:
            return JSONResponse(
                {"error": f"Unsupported platform: {platform}. Supported: {SUPPORTED_PLATFORMS}"},
                status_code=400,
            )
        entry = {
            "id": channel_id,
            "name": body.get("name", channel_id),
            "platform": platform,
            "enabled": body.get("enabled", True),
            "running": False,
            "config": body.get("config", {}),
            "created_at": time.time(),
            "last_activity": None,
        }
        _channels[channel_id] = entry
        return JSONResponse(entry, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        return JSONResponse(channel)

    async def _update(self, request: Request) -> JSONResponse:
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        body = await request.json()
        for key in ("name", "platform", "enabled", "config"):
            if key in body:
                channel[key] = body[key]
        return JSONResponse(channel)

    async def _delete(self, request: Request) -> JSONResponse:
        channel_id = request.path_params["channel_id"]
        if channel_id not in _channels:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        del _channels[channel_id]
        return JSONResponse({"deleted": channel_id})

    async def _toggle(self, request: Request) -> JSONResponse:
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        channel["enabled"] = not channel["enabled"]
        return JSONResponse(channel)

    async def _status(self, request: Request) -> JSONResponse:
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        # Try live status from gateway
        gw_status = self._get_gateway_health()
        if gw_status and channel_id in gw_status:
            gw_ch = gw_status[channel_id]
            channel["running"] = gw_ch.get("running", False)
        return JSONResponse({
            "id": channel_id,
            "name": channel["name"],
            "platform": channel["platform"],
            "enabled": channel["enabled"],
            "running": channel.get("running", False),
            "last_activity": channel.get("last_activity"),
        })

    async def _platforms(self, request: Request) -> JSONResponse:
        """List supported platforms."""
        return JSONResponse({"platforms": SUPPORTED_PLATFORMS})

    async def _restart(self, request: Request) -> JSONResponse:
        """Restart a channel bot via the gateway.
        
        Attempts to stop and restart the bot for the specified channel.
        Requires a gateway connection to actually restart the bot.
        """
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        
        # Try to restart via gateway
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                # Check if gateway has restart capability
                if hasattr(gw, 'restart_channel'):
                    await gw.restart_channel(channel_id)
                    channel["running"] = True
                    return JSONResponse({
                        "id": channel_id,
                        "status": "restarted",
                        "running": True,
                        "message": f"Channel '{channel_id}' restart initiated",
                    })
                elif hasattr(gw, '_channel_bots'):
                    # Direct bot access - stop and restart
                    bot = gw._channel_bots.get(channel_id)
                    if bot:
                        if hasattr(bot, 'stop'):
                            await bot.stop()
                        if hasattr(bot, 'start'):
                            await bot.start()
                        channel["running"] = True
                        return JSONResponse({
                            "id": channel_id,
                            "status": "restarted",
                            "running": True,
                            "message": f"Channel '{channel_id}' restarted successfully",
                        })
        except Exception as e:
            return JSONResponse({
                "id": channel_id,
                "status": "error",
                "error": str(e),
                "message": f"Failed to restart channel: {e}",
            }, status_code=500)
        
        # No gateway or bot not found - just toggle enabled state
        channel["enabled"] = True
        channel["running"] = False
        return JSONResponse({
            "id": channel_id,
            "status": "pending",
            "running": False,
            "message": "Channel marked for restart (no gateway connected)",
        })

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        if not _channels:
            return "No channels configured"
        lines = []
        for c in _channels.values():
            status = "▶" if c.get("running") else ("✓" if c.get("enabled") else "✗")
            lines.append(f"  [{status}] {c['id']} — {c['name']} ({c['platform']})")
        return "\n".join(lines)

    def _cli_status_cli(self) -> str:
        running = sum(1 for c in _channels.values() if c.get("running", False))
        return f"Channels: {len(_channels)} configured, {running} running"

    def _cli_platforms(self) -> str:
        return "Supported: " + ", ".join(SUPPORTED_PLATFORMS)
