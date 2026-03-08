"""Channels feature — multi-platform messaging channel management.

Provides API endpoints and CLI commands for managing communication
channels (Discord, Slack, Telegram, WhatsApp, etc.) and wiring them
to the gateway's bot runtime for actual message handling.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

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
            Route("/api/channels/{channel_id}/test", self._test, methods=["POST"]),
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
        self._sync_running_status()
        running = sum(1 for c in _channels.values() if c.get("running", False))
        from ._gateway_helpers import gateway_health
        gw = gateway_health()
        return {
            "status": "ok",
            "feature": self.name,
            "total_channels": len(_channels),
            "running_channels": running,
            "supported_platforms": SUPPORTED_PLATFORMS,
            **gw,
        }

    # ── Gateway integration ──────────────────────────────────────────

    def _get_gateway(self) -> Any:
        """Get the gateway instance, or None."""
        try:
            from ._gateway_ref import get_gateway
            return get_gateway()
        except Exception:
            return None

    def _sync_running_status(self) -> None:
        """Sync running status from gateway's live _channel_bots dict."""
        gw = self._get_gateway()
        if gw is None:
            return
        channel_bots = getattr(gw, "_channel_bots", {})
        for ch_id, ch in _channels.items():
            bot = channel_bots.get(ch_id)
            if bot is not None and hasattr(bot, "is_running"):
                ch["running"] = bot.is_running
            elif bot is not None:
                ch["running"] = True
            else:
                ch["running"] = False

    async def _start_channel_bot(self, channel_id: str, entry: Dict[str, Any]) -> Optional[str]:
        """Start a bot for the given channel via the gateway.

        Returns None on success, or an error string on failure.
        """
        gw = self._get_gateway()
        if gw is None:
            return "No gateway connected"

        platform = entry["platform"]
        config = entry.get("config", {})
        token = config.get("bot_token", "")
        if not token:
            return "No bot_token in channel config"

        # Get default agent from gateway
        agents = getattr(gw, "_agents", {})
        if not agents:
            return "No agents registered in gateway"
        agent = list(agents.values())[0]

        # Build ch_cfg dict matching gateway's _create_bot expectations
        ch_cfg: Dict[str, Any] = {"token": token}
        # Slack needs app_token
        if platform == "slack":
            ch_cfg["app_token"] = config.get("app_token", os.environ.get("SLACK_APP_TOKEN", ""))
        # WhatsApp needs extra fields
        if platform == "whatsapp":
            ch_cfg["phone_number_id"] = config.get("phone_number_id", "")
            ch_cfg["verify_token"] = config.get("verify_token", "")
            ch_cfg["mode"] = config.get("mode", "cloud")
            ch_cfg["webhook_port"] = config.get("webhook_port", 8080)

        try:
            from praisonaiagents.bots import BotConfig
            bot_config = BotConfig(token=token)
        except ImportError:
            return "praisonaiagents.bots not available"

        # Use gateway's _create_bot factory if available
        if hasattr(gw, "_create_bot"):
            try:
                bot = gw._create_bot(platform, token, agent, bot_config, ch_cfg)
            except Exception as e:
                return f"Failed to create bot: {e}"
            if bot is None:
                return f"Unsupported platform for bot creation: {platform}"
        else:
            return "Gateway does not support _create_bot"

        # Register and start the bot as an async task
        channel_bots = getattr(gw, "_channel_bots", None)
        channel_tasks = getattr(gw, "_channel_tasks", None)
        if channel_bots is None or channel_tasks is None:
            return "Gateway missing _channel_bots/_channel_tasks"

        channel_bots[channel_id] = bot
        if hasattr(gw, "_run_bot_safe"):
            task = asyncio.create_task(gw._run_bot_safe(channel_id, bot))
        else:
            task = asyncio.create_task(bot.start())
        channel_tasks.append(task)

        entry["running"] = True
        logger.info(f"Started {platform} bot for channel '{channel_id}'")
        return None  # success

    async def _stop_channel_bot(self, channel_id: str) -> Optional[str]:
        """Stop a running bot for the given channel.

        Returns None on success, or an error string on failure.
        """
        gw = self._get_gateway()
        if gw is None:
            return "No gateway connected"

        channel_bots = getattr(gw, "_channel_bots", {})
        bot = channel_bots.get(channel_id)
        if bot is None:
            return None  # no bot to stop, not an error

        try:
            if hasattr(bot, "stop"):
                await bot.stop()
            logger.info(f"Stopped bot for channel '{channel_id}'")
        except Exception as e:
            logger.error(f"Error stopping bot for '{channel_id}': {e}")
            return str(e)

        channel_bots.pop(channel_id, None)

        # Update local state
        ch = _channels.get(channel_id)
        if ch:
            ch["running"] = False

        return None

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all configured channels with live status."""
        self._sync_running_status()
        channels = list(_channels.values())
        return JSONResponse({"channels": channels, "count": len(channels)})

    async def _add(self, request: Request) -> JSONResponse:
        """Add a new channel and start its bot via gateway."""
        body = await request.json()
        channel_id = body.get("id", uuid.uuid4().hex[:12])
        platform = body.get("platform", "").lower()
        if platform and platform not in SUPPORTED_PLATFORMS:
            return JSONResponse(
                {"error": f"Unsupported platform: {platform}. Supported: {SUPPORTED_PLATFORMS}"},
                status_code=400,
            )
        config = body.get("config", {})
        entry = {
            "id": channel_id,
            "name": body.get("name", channel_id),
            "platform": platform,
            "enabled": body.get("enabled", True),
            "running": False,
            "config": config,
            "created_at": time.time(),
            "last_activity": None,
        }
        _channels[channel_id] = entry

        # Start the bot via gateway
        error = await self._start_channel_bot(channel_id, entry)
        if error:
            entry["start_error"] = error
            logger.warning(f"Channel '{channel_id}' saved but bot not started: {error}")

        return JSONResponse(entry, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        self._sync_running_status()
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
        """Delete a channel and stop its bot."""
        channel_id = request.path_params["channel_id"]
        if channel_id not in _channels:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        # Stop the bot first
        await self._stop_channel_bot(channel_id)
        del _channels[channel_id]
        return JSONResponse({"deleted": channel_id})

    async def _toggle(self, request: Request) -> JSONResponse:
        """Toggle channel enabled state, starting or stopping the bot."""
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        channel["enabled"] = not channel["enabled"]
        if channel["enabled"]:
            error = await self._start_channel_bot(channel_id, channel)
            if error:
                channel["start_error"] = error
        else:
            await self._stop_channel_bot(channel_id)
        return JSONResponse(channel)

    async def _status(self, request: Request) -> JSONResponse:
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        self._sync_running_status()
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
        """Restart a channel bot (stop then start)."""
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)

        # Stop
        stop_err = await self._stop_channel_bot(channel_id)
        if stop_err:
            logger.warning(f"Stop error for '{channel_id}': {stop_err}")

        # Start
        start_err = await self._start_channel_bot(channel_id, channel)
        if start_err:
            return JSONResponse({
                "id": channel_id,
                "status": "error",
                "error": start_err,
                "message": f"Bot stopped but failed to restart: {start_err}",
            }, status_code=500)

        return JSONResponse({
            "id": channel_id,
            "status": "restarted",
            "running": True,
            "message": f"Channel '{channel_id}' restarted successfully",
        })

    async def _test(self, request: Request) -> JSONResponse:
        """Test connectivity for a channel bot."""
        channel_id = request.path_params["channel_id"]
        channel = _channels.get(channel_id)
        if not channel:
            return JSONResponse({"error": "Channel not found"}, status_code=404)

        gw = self._get_gateway()
        if gw is None:
            return JSONResponse({"success": False, "error": "No gateway connected"})

        channel_bots = getattr(gw, "_channel_bots", {})
        bot = channel_bots.get(channel_id)
        if bot is None:
            return JSONResponse({"success": False, "error": "Bot not running"})

        # Use probe() if available (tests API connectivity)
        if hasattr(bot, "probe"):
            try:
                result = await bot.probe()
                return JSONResponse({"success": True, "probe": result})
            except Exception as e:
                return JSONResponse({"success": False, "error": str(e)})

        # Fallback: check is_running
        running = bot.is_running if hasattr(bot, "is_running") else False
        return JSONResponse({"success": running, "running": running})

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
