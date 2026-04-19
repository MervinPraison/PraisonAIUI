"""Slack channel adapter with Socket Mode support.

Provides real-time message handling via Slack's Socket Mode WebSocket API.
Converts Slack reactions into feedback events and supports threaded replies.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict

from ._base import BaseChannelAdapter, channel_context

logger = logging.getLogger(__name__)


class SlackChannelAdapter(BaseChannelAdapter):
    """Slack channel adapter using Socket Mode for real-time messaging."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__("slack", config)
        self.app_token = config.get("app_token") or os.environ.get("SLACK_APP_TOKEN", "")
        self.bot_token = config.get("bot_token") or os.environ.get("SLACK_BOT_TOKEN", "")
        self.socket_mode = config.get("socket_mode", True)

        self._client = None
        self._socket_client = None
        self._reaction_handlers = []

        if not self.app_token or not self.bot_token:
            raise ValueError("Both app_token and bot_token are required for Slack adapter")

    async def send_message(self, channel_id: str, content: str, **kwargs) -> None:
        """Send a message to a Slack channel."""
        if not self._client:
            return

        try:
            thread_ts = kwargs.get("thread_ts")
            response = await self._client.chat_postMessage(
                channel=channel_id, text=content, thread_ts=thread_ts
            )

            # Store message timestamp for streaming updates
            if response.get("ok"):
                message_ts = response.get("ts")
                if message_ts:
                    kwargs.get("on_sent", lambda ts: None)(message_ts)

        except Exception as e:
            logger.error(f"Failed to send Slack message: {e}")

    async def stream_token(self, channel_id: str, message_id: str, token: str) -> None:
        """Update an existing Slack message with streaming content."""
        if not self._client:
            return

        try:
            # For Slack, we update the message in-place using chat.update
            await self._client.chat_update(
                channel=channel_id,
                ts=message_id,  # message_id is the message timestamp
                text=token,
            )
        except Exception as e:
            logger.error(f"Failed to stream token to Slack: {e}")

    async def start(self) -> None:
        """Start the Slack adapter and connect to Socket Mode."""
        if self._running:
            return

        try:
            # Lazy import Slack SDK
            from slack_sdk.socket_mode.async_client import AsyncSocketModeClient
            from slack_sdk.web.async_client import AsyncWebClient

            self._client = AsyncWebClient(token=self.bot_token)

            if self.socket_mode:
                self._socket_client = AsyncSocketModeClient(
                    app_token=self.app_token, web_client=self._client
                )

                # Register event handlers
                self._socket_client.socket_mode_request_listeners.append(
                    self._handle_socket_request
                )

                await self._socket_client.connect()
                logger.info("Connected to Slack Socket Mode")

            self._running = True

        except ImportError:
            raise ImportError(
                "slack_sdk is required for Slack adapter. Install with: pip install slack_sdk"
            )
        except Exception as e:
            logger.error(f"Failed to start Slack adapter: {e}")
            raise

    async def stop(self) -> None:
        """Stop the Slack adapter and disconnect."""
        self._running = False

        if self._socket_client:
            try:
                await self._socket_client.disconnect()
                logger.info("Disconnected from Slack Socket Mode")
            except Exception as e:
                logger.error(f"Error disconnecting from Slack: {e}")

        self._socket_client = None
        self._client = None

    def add_reaction_handler(self, handler) -> None:
        """Add a handler for Slack reaction events."""
        self._reaction_handlers.append(handler)

    def remove_reaction_handler(self, handler) -> None:
        """Remove a reaction handler."""
        if handler in self._reaction_handlers:
            self._reaction_handlers.remove(handler)

    async def _handle_socket_request(self, client, req):
        """Handle incoming Socket Mode requests."""
        try:
            if req.type == "events_api":
                await self._handle_event(req.payload)

            # Acknowledge the request
            response = {"envelope_id": req.envelope_id}
            await client.send_socket_mode_response(response)

        except Exception as e:
            logger.error(f"Error handling Slack socket request: {e}")

    async def _handle_event(self, payload: Dict[str, Any]) -> None:
        """Handle Slack events from Socket Mode."""
        event = payload.get("event", {})
        event_type = event.get("type")

        if event_type == "message":
            await self._handle_message(event)
        elif event_type == "reaction_added":
            await self._handle_reaction_added(event)
        elif event_type == "reaction_removed":
            await self._handle_reaction_removed(event)

    async def _handle_message(self, event: Dict[str, Any]) -> None:
        """Handle incoming Slack messages."""
        # Skip bot messages and messages without text
        if event.get("bot_id") or not event.get("text"):
            return

        user_id = event.get("user")
        channel_id = event.get("channel")
        text = event.get("text", "")
        thread_ts = event.get("thread_ts")

        # Get user info
        user_info = await self._get_user_info(user_id)

        # Create normalized message
        message = {
            "platform": "slack",
            "channel_id": channel_id,
            "user_id": user_id,
            "content": text,
            "thread_ts": thread_ts,
            "timestamp": time.time(),
            "raw_event": event,
        }

        # Set context and dispatch
        channel_context_data = {"id": channel_id, "platform": "slack", "kind": "slack"}

        user_context_data = {
            "id": user_id,
            "display_name": user_info.get("display_name", ""),
            "username": user_info.get("username", ""),
            "platform": "slack",
        }

        async with channel_context(channel_context_data, user_context_data):
            await self._dispatch_message(message)

    async def _handle_reaction_added(self, event: Dict[str, Any]) -> None:
        """Handle Slack reaction_added events."""
        reaction_event = {
            "platform": "slack",
            "user_id": event.get("user"),
            "message_id": f"{event.get('item', {}).get('channel')}:{event.get('item', {}).get('ts')}",
            "reaction": event.get("reaction"),
            "timestamp": time.time(),
            "raw_event": event,
        }

        # Dispatch to reaction handlers
        for handler in self._reaction_handlers:
            try:
                await handler(reaction_event)
            except Exception as e:
                logger.error(f"Error in Slack reaction handler: {e}")

    async def _handle_reaction_removed(self, event: Dict[str, Any]) -> None:
        """Handle Slack reaction_removed events."""
        reaction_event = {
            "platform": "slack",
            "user_id": event.get("user"),
            "message_id": f"{event.get('item', {}).get('channel')}:{event.get('item', {}).get('ts')}",
            "reaction": event.get("reaction"),
            "removed": True,
            "timestamp": time.time(),
            "raw_event": event,
        }

        # Dispatch to reaction handlers
        for handler in self._reaction_handlers:
            try:
                await handler(reaction_event)
            except Exception as e:
                logger.error(f"Error in Slack reaction handler: {e}")

    async def _get_user_info(self, user_id: str) -> Dict[str, Any]:
        """Get user information from Slack API."""
        if not self._client or not user_id:
            return {}

        try:
            result = await self._client.users_info(user=user_id)
            if result.get("ok"):
                user = result.get("user", {})
                profile = user.get("profile", {})
                return {
                    "id": user_id,
                    "username": user.get("name", ""),
                    "display_name": profile.get("display_name")
                    or profile.get("real_name")
                    or user.get("name", ""),
                    "email": profile.get("email", ""),
                    "avatar_url": profile.get("image_192", ""),
                }
        except Exception as e:
            logger.error(f"Failed to get Slack user info for {user_id}: {e}")

        return {"id": user_id, "username": "", "display_name": ""}


# Event handler registration
_slack_reaction_handlers = []


def on_slack_reaction_added(handler):
    """Decorator for handling Slack reaction events."""
    _slack_reaction_handlers.append(handler)

    # If there's an active Slack adapter, register with it
    from ._base import ChannelAdapterFactory

    async def register_with_adapter():
        adapter = await ChannelAdapterFactory.get_adapter("slack")
        if adapter and isinstance(adapter, SlackChannelAdapter):
            adapter.add_reaction_handler(_create_reaction_wrapper(handler))

    # Defer registration until adapter starts to avoid event loop issues
    try:
        import asyncio

        if asyncio.get_running_loop():
            asyncio.create_task(register_with_adapter())
    except RuntimeError:
        # No event loop running, defer until adapter starts
        pass

    return handler


def _create_reaction_wrapper(handler):
    """Create a wrapper that calls the handler with proper event format."""

    async def wrapper(event):
        # Convert to the format expected by user handlers
        formatted_event = {
            "user": {"id": event["user_id"]},
            "message_id": event["message_id"],
            "reaction": "+1"
            if event["reaction"] in ("thumbsup", "+1")
            else ("-1" if event["reaction"] in ("thumbsdown", "-1") else event["reaction"]),
            "removed": event.get("removed", False),
        }

        await handler(formatted_event)

    return wrapper


async def register_slack_handlers(adapter: SlackChannelAdapter):
    """Register all pending reaction handlers with a Slack adapter."""
    for handler in _slack_reaction_handlers:
        adapter.add_reaction_handler(_create_reaction_wrapper(handler))
