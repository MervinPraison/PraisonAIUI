"""Discord channel adapter with Gateway WebSocket support.

Provides real-time messaging via Discord Gateway with slash commands and DM support.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict

from ._base import BaseChannelAdapter, channel_context

logger = logging.getLogger(__name__)


class DiscordChannelAdapter(BaseChannelAdapter):
    """Discord channel adapter using discord.py Gateway connection."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__("discord", config)
        self.token = config.get("token") or os.environ.get("DISCORD_BOT_TOKEN", "")
        self.command_prefix = config.get("command_prefix", "/")

        self._client = None
        self._message_cache = {}  # For tracking messages for streaming

        if not self.token:
            raise ValueError("Discord bot token is required")

    async def send_message(self, channel_id: str, content: str, **kwargs) -> None:
        """Send a message to a Discord channel."""
        if not self._client:
            return

        try:
            channel = self._client.get_channel(int(channel_id))
            if not channel:
                try:
                    channel = await self._client.fetch_channel(int(channel_id))
                except Exception:
                    return

            message = await channel.send(content)

            # Store message for potential streaming updates
            if message:
                self._message_cache[str(message.id)] = message
                kwargs.get("on_sent", lambda msg_id: None)(str(message.id))

        except Exception as e:
            logger.error(f"Failed to send Discord message: {e}")

    async def stream_token(self, channel_id: str, message_id: str, token: str) -> None:
        """Update an existing Discord message with streaming content."""
        if not self._client:
            return

        try:
            # Get message from cache or fetch it
            message = self._message_cache.get(message_id)
            if not message:
                channel = self._client.get_channel(int(channel_id))
                if channel:
                    message = await channel.fetch_message(int(message_id))

            if message:
                await message.edit(content=token)

        except Exception as e:
            logger.error(f"Failed to stream token to Discord: {e}")

    async def start(self) -> None:
        """Start the Discord adapter and connect to Gateway."""
        if self._running:
            return

        try:
            # Lazy import discord.py
            import discord
            from discord.ext import commands

            # Set up intents
            intents = discord.Intents.default()
            intents.message_content = True
            intents.dm_messages = True

            self._client = commands.Bot(command_prefix=self.command_prefix, intents=intents)

            # Register event handlers
            self._client.event(self._on_ready)
            self._client.event(self._on_message)

            # Start the bot (non-blocking)
            self._bot_task = asyncio.create_task(self._client.start(self.token))

            # Wait for client to be ready
            await self._client.wait_until_ready()

            self._running = True
            logger.info(f"Connected to Discord as {self._client.user}")

        except ImportError:
            raise ImportError(
                "discord.py is required for Discord adapter. Install with: pip install discord.py"
            )
        except Exception as e:
            logger.error(f"Failed to start Discord adapter: {e}")
            raise

    async def stop(self) -> None:
        """Stop the Discord adapter and disconnect."""
        self._running = False

        if self._client:
            try:
                await self._client.close()
                logger.info("Disconnected from Discord")
            except Exception as e:
                logger.error(f"Error disconnecting from Discord: {e}")

        if hasattr(self, "_bot_task") and self._bot_task:
            self._bot_task.cancel()

        self._client = None
        self._message_cache.clear()

    async def _on_ready(self):
        """Called when the Discord bot is ready."""
        logger.info(f"Discord bot {self._client.user} is ready")

        # Register slash commands
        await self._register_slash_commands()

    async def _on_message(self, message):
        """Handle incoming Discord messages."""
        # Skip messages from the bot itself
        if message.author == self._client.user:
            return

        # Handle both DMs and guild messages
        channel_id = str(message.channel.id)
        user_id = str(message.author.id)
        content = message.content

        # Skip messages that are just command invocations
        if content.startswith(self.command_prefix) and len(content.split()) == 1:
            return

        # Create normalized message
        normalized_message = {
            "platform": "discord",
            "channel_id": channel_id,
            "user_id": user_id,
            "content": content,
            "is_dm": isinstance(message.channel, (type(None).__class__, object))
            and hasattr(message.channel, "recipient"),
            "timestamp": time.time(),
            "raw_message": message,
        }

        # Set context and dispatch
        channel_context_data = {"id": channel_id, "platform": "discord", "kind": "discord"}

        user_context_data = {
            "id": user_id,
            "display_name": message.author.display_name,
            "username": message.author.name,
            "discriminator": getattr(message.author, "discriminator", None),
            "platform": "discord",
        }

        async with channel_context(channel_context_data, user_context_data):
            await self._dispatch_message(normalized_message)

    async def _register_slash_commands(self):
        """Register slash commands with Discord."""
        try:
            # Register a simple /chat command
            @self._client.tree.command(name="chat", description="Chat with the AI assistant")
            async def chat_command(interaction, message: str):
                await self._handle_slash_command(interaction, message)

            # Sync commands with Discord
            await self._client.tree.sync()
            logger.info("Discord slash commands registered")

        except Exception as e:
            logger.error(f"Failed to register Discord slash commands: {e}")

    async def _handle_slash_command(self, interaction, message: str):
        """Handle slash command interactions."""
        # Defer the response to give us time to process
        await interaction.response.defer()

        channel_id = str(interaction.channel.id)
        user_id = str(interaction.user.id)

        # Create normalized message for slash command
        normalized_message = {
            "platform": "discord",
            "channel_id": channel_id,
            "user_id": user_id,
            "content": message,
            "is_slash_command": True,
            "interaction": interaction,
            "timestamp": time.time(),
        }

        # Set context and dispatch
        channel_context_data = {"id": channel_id, "platform": "discord", "kind": "discord"}

        user_context_data = {
            "id": user_id,
            "display_name": interaction.user.display_name,
            "username": interaction.user.name,
            "discriminator": getattr(interaction.user, "discriminator", None),
            "platform": "discord",
        }

        # Store interaction for response handling
        self._message_cache[f"interaction_{interaction.id}"] = interaction

        async with channel_context(channel_context_data, user_context_data):
            await self._dispatch_message(normalized_message)

    async def respond_to_interaction(self, interaction_id: str, content: str) -> None:
        """Respond to a Discord slash command interaction."""
        interaction = self._message_cache.get(f"interaction_{interaction_id}")
        if interaction:
            try:
                await interaction.followup.send(content)
            except Exception as e:
                logger.error(f"Failed to respond to Discord interaction: {e}")


# Helper function for registering Discord-specific handlers
async def setup_discord_handlers(adapter: DiscordChannelAdapter):
    """Set up Discord-specific event handlers."""
    # This could be expanded with additional Discord-specific functionality
    pass
