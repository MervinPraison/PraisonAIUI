"""Microsoft Teams channel adapter using Bot Framework.

Provides messaging via Bot Framework Activity Handler with channel and personal scopes.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict

from ._base import BaseChannelAdapter, channel_context

logger = logging.getLogger(__name__)

# Optional Bot Framework imports. Exposed at module scope so tests can patch
# them and so adapter code can reference them via the module namespace.
try:
    from aiohttp.web import Response  # noqa: F401
    from botbuilder.core import (  # noqa: F401
        BotFrameworkAdapter,
        BotFrameworkAdapterSettings,
        TurnContext,
    )
    from botbuilder.schema import Activity, ChannelAccount  # noqa: F401
    MessageFactory = None  # type: ignore[assignment]
    try:
        from botbuilder.core import MessageFactory  # type: ignore[no-redef]  # noqa: F401
    except Exception:
        pass
    HAS_TEAMS = True
except Exception:  # pragma: no cover
    Response = None  # type: ignore[assignment]
    BotFrameworkAdapter = None  # type: ignore[assignment]
    BotFrameworkAdapterSettings = None  # type: ignore[assignment]
    TurnContext = None  # type: ignore[assignment]
    Activity = None  # type: ignore[assignment]
    ChannelAccount = None  # type: ignore[assignment]
    MessageFactory = None  # type: ignore[assignment]
    HAS_TEAMS = False


class TeamsChannelAdapter(BaseChannelAdapter):
    """Microsoft Teams channel adapter using Bot Framework."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__("teams", config)
        self.app_id = config.get("app_id") or os.environ.get("TEAMS_APP_ID", "")
        self.app_password = config.get("app_password") or os.environ.get("TEAMS_APP_PASSWORD", "")

        self._app = None
        self._adapter = None
        self._bot = None
        self._server_task = None

        if not self.app_id or not self.app_password:
            raise ValueError("Both app_id and app_password are required for Teams adapter")

    async def send_message(self, channel_id: str, content: str, **kwargs) -> None:
        """Send a message to a Teams channel or chat."""
        if not self._adapter:
            return

        try:
            # Teams uses different reference formats for channels vs chats
            from botbuilder.core import MessageFactory

            # Create a proactive message
            activity = MessageFactory.text(content)
            activity.channel_id = "msteams"

            # Store the activity reference for streaming updates
            conversation_ref = kwargs.get("conversation_reference")
            if conversation_ref:
                await self._adapter.continue_conversation(
                    conversation_ref,
                    lambda turn_context: turn_context.send_activity(activity),
                    self.app_id,
                )

        except Exception as e:
            logger.error(f"Failed to send Teams message: {e}")

    async def stream_token(self, channel_id: str, message_id: str, token: str) -> None:
        """Update an existing Teams message with streaming content."""
        if not self._adapter:
            return

        try:
            # Teams supports message updates via the activity ID

            # For Teams, we need to use updateActivity
            # This requires the conversation reference and activity ID
            # Implementation would depend on having stored these during send_message
            logger.debug(f"Streaming token to Teams message {message_id}: {token}")

        except Exception as e:
            logger.error(f"Failed to stream token to Teams: {e}")

    async def start(self) -> None:
        """Start the Teams adapter and Bot Framework server."""
        if self._running:
            return

        try:
            # Lazy import Bot Framework components
            from aiohttp import web
            from botbuilder.core import BotFrameworkAdapter, BotFrameworkAdapterSettings
            from botbuilder.schema import (  # noqa: F401  (availability probe)
                Activity,
                ChannelAccount,
            )

            # Configure Bot Framework adapter
            settings = BotFrameworkAdapterSettings(self.app_id, self.app_password)
            self._adapter = BotFrameworkAdapter(settings)

            # Create bot instance
            self._bot = TeamsBot(self)

            # Create web app for receiving webhooks
            self._app = web.Application()
            self._app.router.add_post("/api/messages", self._handle_messages)

            # Start the server on a random available port
            self._runner = web.AppRunner(self._app)
            await self._runner.setup()

            self._site = web.TCPSite(self._runner, "0.0.0.0", 0)  # Use port 0 for random port
            await self._site.start()

            # Get the actual port assigned
            port = self._site._server.sockets[0].getsockname()[1]
            logger.info(f"Teams Bot Framework server started on port {port}")

            self._running = True

        except ImportError:
            raise ImportError(
                "botbuilder-core and botbuilder-schema are required for Teams adapter. "
                "Install with: pip install botbuilder-core botbuilder-schema"
            )
        except Exception as e:
            logger.error(f"Failed to start Teams adapter: {e}")
            raise

    async def stop(self) -> None:
        """Stop the Teams adapter and Bot Framework server."""
        self._running = False

        if self._server_task:
            self._server_task.cancel()

        if hasattr(self, "_site") and self._site:
            await self._site.stop()

        if hasattr(self, "_runner") and self._runner:
            await self._runner.cleanup()

        self._app = None
        self._adapter = None
        self._bot = None

        logger.info("Stopped Teams adapter")

    async def _handle_messages(self, request):
        """Handle incoming Bot Framework messages."""
        try:
            from aiohttp.web import Response

            if "application/json" in request.headers.get("content-type", ""):
                body = await request.json()
            else:
                return Response(status=415)

            auth_header = request.headers.get("Authorization", "")

            # Process the activity with Bot Framework adapter
            await self._adapter.process_activity(body, auth_header, self._bot.on_message_activity)

            return Response(status=200)

        except Exception as e:
            logger.error(f"Error handling Teams message: {e}")
            return Response(status=500)


class TeamsBot:
    """Teams bot implementation with activity handling."""

    def __init__(self, adapter: TeamsChannelAdapter):
        self.adapter = adapter

    async def on_message_activity(self, turn_context):
        """Handle incoming message activities from Teams."""
        try:
            from botbuilder.core import TurnContext

            activity = turn_context.activity

            # Skip messages from the bot itself
            if activity.from_property.id == activity.recipient.id:
                return

            channel_id = activity.channel_id or "msteams"
            user_id = activity.from_property.id
            content = activity.text or ""

            # Extract Teams-specific information
            teams_data = getattr(activity, "channel_data", {}) or {}
            tenant_id = teams_data.get("tenant", {}).get("id", "")
            team_id = teams_data.get("team", {}).get("id", "")

            # Create normalized message
            normalized_message = {
                "platform": "teams",
                "channel_id": channel_id,
                "user_id": user_id,
                "content": content,
                "tenant_id": tenant_id,
                "team_id": team_id,
                "conversation_reference": TurnContext.get_conversation_reference(activity),
                "timestamp": time.time(),
                "raw_activity": activity,
            }

            # Set context and dispatch
            channel_context_data = {"id": channel_id, "platform": "teams", "kind": "teams"}

            user_context_data = {
                "id": user_id,
                "display_name": activity.from_property.name or "",
                "username": activity.from_property.name or "",
                "platform": "teams",
            }

            async with channel_context(channel_context_data, user_context_data):
                await self.adapter._dispatch_message(normalized_message)

        except Exception as e:
            logger.error(f"Error processing Teams message activity: {e}")

    async def on_typing_activity(self, turn_context):
        """Handle typing indicators (could be used for presence)."""
        pass

    async def on_members_added_activity(self, members_added, turn_context):
        """Handle when new members are added to a conversation."""
        welcome_text = "Hello! I'm your AI assistant. How can I help you today?"

        for member in members_added:
            if member.id != turn_context.activity.recipient.id:
                await turn_context.send_activity(welcome_text)


# Helper function for Teams-specific setup
async def setup_teams_handlers(adapter: TeamsChannelAdapter):
    """Set up Teams-specific functionality."""
    # This could be expanded with Teams-specific features like:
    # - Adaptive Cards
    # - Task modules
    # - Meeting bots
    # - etc.
    pass
