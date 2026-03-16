"""Channels feature — protocol-driven multi-platform messaging management.

Architecture:
    ChannelProtocol (ABC)           <- any backend implements this
      └── SimpleChannelManager     <- default in-memory (no deps)

    SDK gap: no channel management API in praisonaiagents.

    PraisonAIChannels (BaseFeatureProtocol)
      └── delegates to active ChannelProtocol implementation
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Channel Protocol ─────────────────────────────────────────────────


class ChannelProtocol(ABC):
    """Protocol interface for channel backends."""

    @abstractmethod
    def list_channels(self) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def add_channel(self, entry: Dict[str, Any]) -> Dict[str, Any]: ...

    @abstractmethod
    def get_channel(self, channel_id: str) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def update_channel(self, channel_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def delete_channel(self, channel_id: str) -> bool: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# Supported channel platforms
SUPPORTED_PLATFORMS = [
    "discord", "slack", "telegram", "whatsapp",
    "imessage", "signal", "googlechat", "nostr",
]

# In-memory channel registry — loaded from unified config.yaml
from ._persistence import load_section, save_section

_CHANNELS_SECTION = "channels"
_channels: Dict[str, Dict[str, Any]] = load_section(_CHANNELS_SECTION)
# Local bot lifecycle tracking (bot instance + asyncio.Task)
_live_bots: Dict[str, Dict[str, Any]] = {}

# Runtime-only fields that should NOT be persisted
_RUNTIME_FIELDS = {"running", "start_error"}


def _persist_channels() -> None:
    """Save channel configs (without runtime state) to unified config.yaml."""
    data = {}
    for cid, ch in _channels.items():
        data[cid] = {k: v for k, v in ch.items() if k not in _RUNTIME_FIELDS}
    save_section(_CHANNELS_SECTION, data)


class ChannelsFeature(BaseFeatureProtocol):
    """Channel management wired to praisonai gateway bots."""

    feature_name = "channels"
    feature_description = "Multi-platform messaging channel management"
    _auto_started = False

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

    async def _auto_start_enabled_channels(self) -> None:
        """Auto-start all enabled channels on server startup (runs once)."""
        if ChannelsFeature._auto_started:
            return
        ChannelsFeature._auto_started = True

        enabled = [(cid, ch) for cid, ch in _channels.items() if ch.get("enabled", False)]
        if not enabled:
            return

        logger.info("Auto-starting %d enabled channel(s)...", len(enabled))
        for channel_id, entry in enabled:
            try:
                error = await self._start_channel_bot(channel_id, entry)
                if error:
                    entry["start_error"] = error
                    logger.warning("Auto-start '%s' failed: %s", channel_id, error)
                else:
                    logger.info("Auto-started channel '%s' (%s)", channel_id, entry.get("platform"))
            except Exception as e:
                entry["start_error"] = str(e)
                logger.warning("Auto-start '%s' exception: %s", channel_id, e)
        self._sync_running_status()

    # ── Gateway integration ──────────────────────────────────────────

    def _get_gateway(self) -> Any:
        """Get the gateway instance, or None."""
        try:
            from ._gateway_ref import get_gateway
            return get_gateway()
        except Exception:
            return None

    def _sync_running_status(self) -> None:
        """Sync running status from local _live_bots + gateway _channel_bots."""
        # Merge gateway bots and local bots
        all_bots: Dict[str, Any] = {}
        gw = self._get_gateway()
        if gw is not None:
            all_bots.update(getattr(gw, "_channel_bots", {}))
        for ch_id, info in _live_bots.items():
            all_bots.setdefault(ch_id, info.get("bot"))

        for ch_id, ch in _channels.items():
            bot = all_bots.get(ch_id)
            info = _live_bots.get(ch_id, {})
            task = info.get("task")
            task_alive = task is not None and not task.done()

            if bot is not None and hasattr(bot, "is_running"):
                # Use bot.is_running, but also treat the channel as running
                # if the asyncio task is still alive (e.g. during startup
                # handshake before is_running flips to True).
                ch["running"] = bot.is_running or task_alive
            elif bot is not None:
                ch["running"] = task_alive
            else:
                ch["running"] = False

    @staticmethod
    def _resolve_slack_app_token(config: Dict[str, Any]) -> str:
        """Resolve Slack app_token from channel config or SLACK_APP_TOKEN env var.

        Returns the token string, or empty string if absent.
        """
        return config.get("app_token") or os.environ.get("SLACK_APP_TOKEN", "")

    async def _start_channel_bot(self, channel_id: str, entry: Dict[str, Any]) -> Optional[str]:
        """Start a bot for the given channel.

        Tries, in order:
        1. Gateway's _create_bot() if gateway + praisonai installed
        2. Direct import from praisonai.bots.<platform>
        3. Direct import from praisonaiagents.bots.<platform>  (future)

        Returns None on success, or an error string on failure.
        """
        platform = entry["platform"]
        config = entry.get("config", {})
        token = config.get("bot_token", "")
        if not token:
            return "No bot_token in channel config"
        # Slack Socket Mode requires an app_token (xapp-...)
        if platform == "slack":
            if not self._resolve_slack_app_token(config):
                return (
                    "Slack Socket Mode requires an app_token (xapp-...). "
                    "Set it in channel config or SLACK_APP_TOKEN env var."
                )

        # Create or find the agent
        agent = None
        try:
            from praisonaiagents import Agent
            
            # G3: Resolve tools via praisonai wrapper
            agent_tools = []
            try:
                from praisonai.tool_resolver import ToolResolver
                resolver = ToolResolver()
                agent_tools = resolver.resolve_many(["internet_search"])
            except ImportError:
                pass  # praisonai not installed — no tools
            
            agent = Agent(
                name="assistant",
                instructions="You are a helpful assistant with tool capabilities.",
                llm=os.environ.get("PRAISONAI_MODEL", "gpt-4o-mini"),
                tools=agent_tools if agent_tools else None,
                reflection=False,
            )
        except ImportError:
            pass  # agent may be None — some bots can work without one

        bot = None
        # ── Strategy 1: via gateway _create_bot ─────────────────────────
        gw = self._get_gateway()
        if gw is not None and hasattr(gw, "_create_bot"):
            try:
                from praisonaiagents.bots import BotConfig
                bot_config = BotConfig(token=token)
                ch_cfg: Dict[str, Any] = {"token": token}
                if platform == "slack":
                    ch_cfg["app_token"] = self._resolve_slack_app_token(config)
                if platform == "whatsapp":
                    for k in ("phone_number_id", "verify_token", "mode", "webhook_port"):
                        ch_cfg[k] = config.get(k, "")
                # Use first agent registered in gateway, or our fresh one
                gw_agents = getattr(gw, "_agents", {})
                gw_agent = list(gw_agents.values())[0] if gw_agents else agent
                if gw_agent is None:
                    pass  # fall through to strategy 2
                else:
                    bot = gw._create_bot(platform, token, gw_agent, bot_config, ch_cfg)
            except Exception as e:
                logger.debug(f"Gateway _create_bot failed: {e}")

        # ── Strategy 2: direct import from praisonai.bots ───────────────
        if bot is None:
            bot = self._create_bot_direct(platform, token, agent, config)

        if bot is None:
            return f"Could not create {platform} bot — required packages may not be installed"

        # ── Start the bot as an asyncio task ─────────────────────────────
        async def _run_safe(name: str, b: Any) -> None:
            try:
                await b.start()
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.error(f"Bot '{name}' crashed: {e}")
                entry["running"] = False
                entry["start_error"] = str(e)

        # ── Attach chat bridge BEFORE starting ──────────────────────────
        # Hooks into the bot's message lifecycle to broadcast messages
        # to the Chat UI in real-time (fire-and-forget, zero perf impact).
        self._attach_chat_bridge(channel_id, bot, platform)

        task = asyncio.create_task(_run_safe(channel_id, bot))
        _live_bots[channel_id] = {"bot": bot, "task": task}

        # Also register in gateway if available
        if gw is not None:
            channel_bots = getattr(gw, "_channel_bots", None)
            channel_tasks = getattr(gw, "_channel_tasks", None)
            if channel_bots is not None:
                channel_bots[channel_id] = bot
            if channel_tasks is not None:
                channel_tasks.append(task)

        entry["running"] = True
        entry.pop("start_error", None)
        logger.info(f"Started {platform} bot for channel '{channel_id}'")
        return None  # success

    @staticmethod
    def _create_bot_direct(platform: str, token: str, agent: Any,
                           config: Dict[str, Any]) -> Any:
        """Try to directly instantiate a bot class by platform name."""
        bot_classes: Dict[str, List[str]] = {
            "discord": [
                "praisonai.bots.discord.DiscordBot",
                "praisonaiagents.bots.discord.DiscordBot",
            ],
            "telegram": [
                "praisonai.bots.telegram.TelegramBot",
                "praisonaiagents.bots.telegram.TelegramBot",
            ],
            "slack": [
                "praisonai.bots.slack.SlackBot",
                "praisonaiagents.bots.slack.SlackBot",
            ],
            "whatsapp": [
                "praisonai.bots.whatsapp.WhatsAppBot",
                "praisonaiagents.bots.whatsapp.WhatsAppBot",
            ],
        }
        paths = bot_classes.get(platform, [])
        for fqn in paths:
            try:
                module_path, class_name = fqn.rsplit(".", 1)
                import importlib
                mod = importlib.import_module(module_path)
                cls = getattr(mod, class_name)
                # All bot constructors accept (token=, agent=, config=)
                kwargs: Dict[str, Any] = {"token": token}
                if agent is not None:
                    kwargs["agent"] = agent
                if platform == "slack":
                    kwargs["app_token"] = ChannelsFeature._resolve_slack_app_token(config)
                bot = cls(**kwargs)
                logger.info(f"Created {platform} bot via {fqn}")
                return bot
            except ImportError:
                continue
            except Exception as e:
                logger.debug(f"Failed to create {platform} bot via {fqn}: {e}")
                continue
        return None

    def _attach_chat_bridge(
        self,
        channel_id: str,
        bot: Any,
        platform: str,
    ) -> None:
        """Attach a message bridge so channel bot conversations appear in the Chat UI.

        Architecture (fire-and-forget, zero performance impact):
        ┌──────────┐   on_message    ┌───────────┐  broadcast   ┌──────────┐
        │ Slack /  │ ──────────────► │ channels  │ ──────────► │ Chat WS  │
        │ Discord/ │                 │   .py     │  (create_   │ clients  │
        │ Telegram │                 │  bridge   │   task)     │  (UI)    │
        └──────────┘                 └───────────┘             └──────────┘
               │                          ▲
               │   _session.chat()        │ wrapped to also
               └──────────────────────────┘ broadcast response

        Every broadcast is dispatched via ``asyncio.create_task`` so the
        bot's original message handling is **never** blocked or slowed.
        Errors in broadcasting are logged and swallowed — the bot keeps
        running normally even if no Chat UI clients are connected.

        Each channel gets a dedicated session ID: ``channel-{channel_id}``.
        Messages are persisted to the datastore for history on page reload.
        """
        session_id = f"channel-{channel_id}"

        # ── Platform icons for the Chat UI ───────────────────────────
        _PLATFORM_ICONS = {
            "slack": "💬", "discord": "🎮", "telegram": "✈️",
            "whatsapp": "📱", "imessage": "🍎", "signal": "🔒",
            "googlechat": "💚", "nostr": "🟣",
        }
        icon = _PLATFORM_ICONS.get(platform, "📨")

        # ── 1. Hook into on_message to capture incoming user messages ─
        if hasattr(bot, "on_message"):
            @bot.on_message
            async def _bridge_incoming(msg: Any) -> None:
                """Forward incoming channel message to Chat UI (fire-and-forget)."""
                try:
                    content = getattr(msg, "content", "") or str(msg)
                    sender_name = ""
                    if hasattr(msg, "sender") and msg.sender:
                        sender_name = (
                            getattr(msg.sender, "display_name", "")
                            or getattr(msg.sender, "username", "")
                            or getattr(msg.sender, "user_id", "")
                        )

                    async def _do_broadcast() -> None:
                        try:
                            from .chat import get_chat_manager
                            mgr = get_chat_manager()
                            await mgr.broadcast(session_id, {
                                "type": "channel_message",
                                "session_id": session_id,
                                "channel_id": channel_id,
                                "platform": platform,
                                "icon": icon,
                                "content": content,
                                "sender": sender_name,
                                "timestamp": time.time(),
                            })

                            # Persist to datastore for history
                            from praisonaiui.server import _datastore
                            existing = await _datastore.get_session(session_id)
                            if existing is None:
                                await _datastore.create_session(session_id)
                                # Store platform metadata for sidebar display
                                await _datastore.update_session(
                                    session_id,
                                    platform=platform,
                                    icon=icon,
                                    title=f"{icon} {platform.capitalize()}",
                                )
                            await _datastore.add_message(session_id, {
                                "role": "user",
                                "content": f"[{sender_name}] {content}" if sender_name else content,
                                "platform": platform,
                                "icon": icon,
                                "sender": sender_name,
                                "channel_id": channel_id,
                            })
                        except Exception as e:
                            logger.debug(f"Chat bridge broadcast error: {e}")

                    asyncio.create_task(_do_broadcast())
                except Exception as e:
                    logger.debug(f"Chat bridge incoming error: {e}")

        # ── 2. Wrap _session.chat() to capture agent responses + steps ─
        if hasattr(bot, "_session") and hasattr(bot._session, "chat"):
            _original_chat = bot._session.chat

            async def _wrapped_chat(agent: Any, user_id: str, text: str) -> str:
                """Wrap agent chat to broadcast responses AND intermediate
                tool/step events to the Chat UI.

                Hooks into the agent's StreamEventEmitter (same pattern as
                PraisonAIProvider._run_direct_mode) to capture tool_call,
                reasoning, and content events during execution.
                """
                from .chat import get_chat_manager, _enrich_tool_payload
                mgr = get_chat_manager()
                _loop = asyncio.get_running_loop()

                # ── Streaming bridge: capture events during agent.chat() ──
                _stream_callback = None
                _event_queue: asyncio.Queue = asyncio.Queue()
                _tool_step = 0
                _seen_started: set = set()
                _seen_completed: set = set()
                _collected_tool_calls: dict = {}

                try:
                    from praisonaiagents.streaming import StreamEventType as SET

                    def _on_stream_event(stream_event):
                        """Sync callback → queue (thread-safe)."""
                        try:
                            _loop.call_soon_threadsafe(
                                _event_queue.put_nowait, stream_event
                            )
                        except Exception:
                            pass

                    if hasattr(agent, "stream_emitter"):
                        agent.stream_emitter.add_callback(_on_stream_event)
                        _stream_callback = _on_stream_event
                except (ImportError, AttributeError):
                    pass

                # ── Drain task: process events while agent.chat() runs ────
                async def _drain_events():
                    nonlocal _tool_step
                    try:
                        from praisonaiagents.streaming import StreamEventType as SET  # noqa: F811
                    except ImportError:
                        return

                    while True:
                        try:
                            evt = await asyncio.wait_for(
                                _event_queue.get(), timeout=0.1
                            )
                        except asyncio.TimeoutError:
                            continue
                        except Exception:
                            break
                        if evt is None:  # Sentinel
                            break

                        payload = None
                        evt_type = getattr(evt, "type", None)

                        if evt_type == SET.DELTA_TOOL_CALL:
                            tc = getattr(evt, "tool_call", None) or {}
                            name = tc.get("name")
                            if not name:
                                continue
                            tc_id = tc.get("id") or name
                            if tc_id in _seen_started:
                                continue
                            _seen_started.add(tc_id)
                            if name:
                                _seen_started.add(name)
                            _tool_step += 1
                            payload = {
                                "type": "tool_call_started",
                                "name": name,
                                "args": tc.get("arguments"),
                                "tool_call_id": tc_id,
                            }
                            _enrich_tool_payload(payload, _tool_step, is_completed=False)
                            _collected_tool_calls[tc_id] = dict(payload)

                        elif evt_type == SET.TOOL_CALL_END:
                            tc = getattr(evt, "tool_call", None) or {}
                            name = tc.get("name")
                            tc_id = tc.get("id") or name or ""
                            if tc_id in _seen_completed:
                                continue
                            if tc_id:
                                _seen_completed.add(tc_id)
                            if name:
                                _seen_completed.add(name)
                            payload = {
                                "type": "tool_call_completed",
                                "name": name,
                                "result": tc.get("result"),
                                "tool_call_id": tc_id,
                            }
                            _enrich_tool_payload(payload, _tool_step, is_completed=True)
                            if tc_id in _collected_tool_calls:
                                entry = _collected_tool_calls[tc_id]
                                entry["result"] = payload.get("result")
                                entry["formatted_result"] = payload.get("formatted_result", "✓ Done")
                                entry["status"] = "done"

                        elif evt_type == SET.DELTA_TEXT:
                            is_reasoning = getattr(evt, "is_reasoning", False)
                            content = getattr(evt, "content", "")
                            if is_reasoning and content:
                                payload = {
                                    "type": "reasoning_step",
                                    "step": content,
                                }

                        # Also handle TOOL_CALL_START / TOOL_CALL_RESULT (SDK >= 1.6)
                        elif hasattr(SET, "TOOL_CALL_START") and evt_type == SET.TOOL_CALL_START:
                            tc = getattr(evt, "tool_call", None) or {}
                            name = tc.get("name")
                            if not name:
                                continue
                            tc_id = tc.get("id") or name
                            if tc_id in _seen_started:
                                continue
                            _seen_started.add(tc_id)
                            if name:
                                _seen_started.add(name)
                            _tool_step += 1
                            payload = {
                                "type": "tool_call_started",
                                "name": name,
                                "args": tc.get("arguments"),
                                "tool_call_id": tc_id,
                            }
                            _enrich_tool_payload(payload, _tool_step, is_completed=False)
                            _collected_tool_calls[tc_id] = dict(payload)

                        elif hasattr(SET, "TOOL_CALL_RESULT") and evt_type == SET.TOOL_CALL_RESULT:
                            tc = getattr(evt, "tool_call", None) or {}
                            name = tc.get("name")
                            tc_id = tc.get("id") or name or ""
                            if tc_id in _seen_completed:
                                continue
                            if tc_id:
                                _seen_completed.add(tc_id)
                            if name:
                                _seen_completed.add(name)
                            payload = {
                                "type": "tool_call_completed",
                                "name": name,
                                "args": tc.get("arguments"),
                                "result": tc.get("result"),
                                "tool_call_id": tc_id,
                            }
                            _enrich_tool_payload(payload, _tool_step, is_completed=True)
                            if tc_id in _collected_tool_calls:
                                entry = _collected_tool_calls[tc_id]
                                entry["result"] = payload.get("result")
                                entry["formatted_result"] = payload.get("formatted_result", "✓ Done")
                                entry["status"] = "done"

                        if payload:
                            payload.update({
                                "session_id": session_id,
                                "channel_id": channel_id,
                                "platform": platform,
                                "icon": icon,
                            })
                            try:
                                await mgr.broadcast(session_id, payload)
                            except Exception:
                                pass

                # Start drain task, then run the actual chat
                drain_task = asyncio.create_task(_drain_events())

                try:
                    response = await _original_chat(agent, user_id, text)
                finally:
                    # Signal drain to stop and clean up callback
                    try:
                        _event_queue.put_nowait(None)
                    except Exception:
                        pass
                    try:
                        await asyncio.wait_for(drain_task, timeout=2.0)
                    except (asyncio.TimeoutError, Exception):
                        drain_task.cancel()
                    if _stream_callback and hasattr(agent, "stream_emitter"):
                        try:
                            agent.stream_emitter.remove_callback(_stream_callback)
                        except Exception:
                            pass

                # Broadcast the final response
                async def _broadcast_response() -> None:
                    try:
                        await mgr.broadcast(session_id, {
                            "type": "channel_response",
                            "session_id": session_id,
                            "channel_id": channel_id,
                            "platform": platform,
                            "icon": icon,
                            "content": response,
                            "agent_name": getattr(agent, "name", "assistant"),
                            "timestamp": time.time(),
                        })

                        # Persist response to datastore (with tool calls)
                        from praisonaiui.server import _datastore
                        msg_data = {
                            "role": "assistant",
                            "content": response,
                            "agent_name": getattr(agent, "name", "assistant"),
                            "platform": platform,
                            "icon": icon,
                            "channel_id": channel_id,
                        }
                        if _collected_tool_calls:
                            msg_data["toolCalls"] = list(_collected_tool_calls.values())
                        await _datastore.add_message(session_id, msg_data)
                    except Exception as e:
                        logger.debug(f"Chat bridge response broadcast error: {e}")

                asyncio.create_task(_broadcast_response())
                return response  # return original response untouched

            bot._session.chat = _wrapped_chat

        logger.info(f"Chat bridge attached for {platform} channel '{channel_id}' → session '{session_id}'")

    async def _stop_channel_bot(self, channel_id: str) -> Optional[str]:
        """Stop a running bot for the given channel.

        Returns None on success, or an error string on failure.
        """
        # Find the bot in local registry or gateway
        info = _live_bots.get(channel_id)
        bot = info.get("bot") if info else None

        if bot is None:
            gw = self._get_gateway()
            if gw is not None:
                channel_bots = getattr(gw, "_channel_bots", {})
                bot = channel_bots.get(channel_id)

        if bot is None:
            return None  # no bot to stop, not an error

        try:
            if hasattr(bot, "stop"):
                await bot.stop()
            # Cancel the task if still running
            if info and info.get("task") and not info["task"].done():
                info["task"].cancel()
            logger.info(f"Stopped bot for channel '{channel_id}'")
        except Exception as e:
            logger.error(f"Error stopping bot for '{channel_id}': {e}")
            return str(e)

        # Clean up from both registries
        _live_bots.pop(channel_id, None)
        gw = self._get_gateway()
        if gw is not None:
            getattr(gw, "_channel_bots", {}).pop(channel_id, None)

        # Update local state
        ch = _channels.get(channel_id)
        if ch:
            ch["running"] = False

        return None

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all configured channels with live status."""
        # Auto-start enabled channels on first request (lazy startup)
        await self._auto_start_enabled_channels()
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

        # Sync live status before responding so the frontend sees the real state
        self._sync_running_status()
        _persist_channels()
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
        _persist_channels()
        return JSONResponse(channel)

    async def _delete(self, request: Request) -> JSONResponse:
        """Delete a channel and stop its bot."""
        channel_id = request.path_params["channel_id"]
        if channel_id not in _channels:
            return JSONResponse({"error": "Channel not found"}, status_code=404)
        # Stop the bot first
        await self._stop_channel_bot(channel_id)
        del _channels[channel_id]
        _persist_channels()
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

        def _mark_healthy():
            """Clear start_error so UI badge updates from Error → Stopped."""
            channel.pop("start_error", None)
            _persist_channels()

        # Find the bot in local registry or gateway
        info = _live_bots.get(channel_id)
        bot = info.get("bot") if info else None
        if bot is None:
            gw = self._get_gateway()
            if gw is not None:
                bot = getattr(gw, "_channel_bots", {}).get(channel_id)

        # ── If bot is running, use its probe/status ──────────────────
        if bot is not None:
            if hasattr(bot, "probe"):
                try:
                    result = await bot.probe()
                    # Convert dataclass/namedtuple to dict for JSON serialization
                    if hasattr(result, "__dict__") and not isinstance(result, dict):
                        try:
                            import dataclasses
                            probe_data = dataclasses.asdict(result)
                        except (TypeError, Exception):
                            probe_data = result.__dict__
                    elif hasattr(result, "_asdict"):
                        probe_data = result._asdict()
                    elif isinstance(result, dict):
                        probe_data = result
                    else:
                        probe_data = str(result)
                    _mark_healthy()
                    return JSONResponse({"success": True, "probe": probe_data})
                except Exception as e:
                    return JSONResponse({"success": False, "error": str(e)})
            running = bot.is_running if hasattr(bot, "is_running") else False
            return JSONResponse({"success": running, "running": running})

        # ── Fallback: direct API token validation ────────────────────
        # Bot not running (import paths may be unavailable), but we can
        # still test the token against the platform API directly.
        platform = channel.get("platform", "")
        config = channel.get("config", {})
        token = config.get("token", config.get("bot_token", ""))

        if not token:
            return JSONResponse({"success": False,
                                 "error": "No token configured for this channel"})

        try:
            if platform == "telegram":
                from telegram import Bot as TGBot
                tg = TGBot(token=token)
                me = await tg.get_me()
                _mark_healthy()
                return JSONResponse({
                    "success": True,
                    "probe": {"bot_name": me.first_name,
                              "username": me.username,
                              "id": me.id},
                })
            elif platform == "discord":
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        "https://discord.com/api/v10/users/@me",
                        headers={"Authorization": f"Bot {token}"},
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            _mark_healthy()
                            return JSONResponse({
                                "success": True,
                                "probe": {"bot_name": data.get("username"),
                                          "id": data.get("id")},
                            })
                        return JSONResponse({
                            "success": False,
                            "error": f"Discord API returned {resp.status}",
                        })
            elif platform == "slack":
                from slack_sdk.web.async_client import AsyncWebClient
                client = AsyncWebClient(token=token)
                result = await client.auth_test()
                if result.get("ok", False):
                    _mark_healthy()
                return JSONResponse({
                    "success": result.get("ok", False),
                    "probe": {"team": result.get("team"),
                              "user": result.get("user"),
                              "bot_id": result.get("bot_id")},
                })
            else:
                return JSONResponse({
                    "success": False,
                    "error": f"Direct test not supported for '{platform}'",
                })
        except ImportError:
            return JSONResponse({
                "success": False,
                "error": (f"Could not test {platform} — required packages "
                          f"may not be installed"),
            })
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)})

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


# Backward-compat alias
PraisonAIChannels = ChannelsFeature
