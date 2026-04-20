"""Base channel adapter protocol for platform connectors.

Architecture:
    ChannelAdapterProtocol — protocol for platform adapters
    ChannelAdapterFactory — lazy-loads enabled channels from config
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class ChannelAdapterProtocol(Protocol):
    """Protocol interface for platform channel adapters."""

    platform: str

    async def send_message(self, channel_id: str, content: str, **kwargs) -> None:
        """Send a message to the specified channel."""
        ...

    async def stream_token(self, channel_id: str, message_id: str, token: str) -> None:
        """Stream a token to an existing message (for real-time updates)."""
        ...

    async def start(self) -> None:
        """Start the channel adapter (connect to platform)."""
        ...

    async def stop(self) -> None:
        """Stop the channel adapter (disconnect from platform)."""
        ...

    def is_running(self) -> bool:
        """Check if the adapter is currently running."""
        ...


class BaseChannelAdapter:
    """Base implementation for channel adapters with common functionality."""

    def __init__(self, platform: str, config: Dict[str, Any]):
        self.platform = platform
        self.config = config
        self._running = False
        self._message_handlers: list = []

    def add_message_handler(self, handler) -> None:
        """Add a message handler callback."""
        self._message_handlers.append(handler)

    def remove_message_handler(self, handler) -> None:
        """Remove a message handler callback."""
        if handler in self._message_handlers:
            self._message_handlers.remove(handler)

    async def _dispatch_message(self, message: Dict[str, Any]) -> None:
        """Dispatch incoming message to all registered handlers."""
        for handler in self._message_handlers:
            try:
                await handler(message)
            except Exception as e:
                logger.error(f"Error in message handler: {e}")

    def is_running(self) -> bool:
        """Check if the adapter is currently running."""
        return self._running


class ChannelAdapterFactory:
    """Factory for loading and managing channel adapters based on config."""

    _adapters: Dict[str, ChannelAdapterProtocol] = {}
    _adapter_configs: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def register_adapter_config(cls, platform: str, config: Dict[str, Any]) -> None:
        """Register configuration for a platform adapter."""
        cls._adapter_configs[platform] = config

    @classmethod
    async def get_adapter(cls, platform: str) -> Optional[ChannelAdapterProtocol]:
        """Get or create an adapter for the specified platform."""
        if platform in cls._adapters:
            return cls._adapters[platform]

        config = cls._adapter_configs.get(platform)
        if not config or not config.get("enabled", False):
            return None

        adapter = await cls._create_adapter(platform, config)
        if adapter:
            cls._adapters[platform] = adapter

        return adapter

    @classmethod
    async def _create_adapter(
        cls, platform: str, config: Dict[str, Any]
    ) -> Optional[ChannelAdapterProtocol]:
        """Create a platform-specific adapter (lazy import)."""
        try:
            if platform == "slack":
                from .slack import SlackChannelAdapter

                return SlackChannelAdapter(config)
            elif platform == "discord":
                from .discord import DiscordChannelAdapter

                return DiscordChannelAdapter(config)
            elif platform == "teams":
                from .teams import TeamsChannelAdapter

                return TeamsChannelAdapter(config)
            else:
                logger.warning(f"Unknown platform: {platform}")
                return None
        except ImportError as e:
            logger.warning(f"Failed to import {platform} adapter: {e}")
            return None
        except Exception as e:
            logger.error(f"Failed to create {platform} adapter: {e}")
            return None

    @classmethod
    async def start_all_enabled(cls) -> Dict[str, str]:
        """Start all enabled adapters. Returns dict of platform -> error (if any)."""
        errors = {}

        for platform, config in cls._adapter_configs.items():
            if not config.get("enabled", False):
                continue

            try:
                adapter = await cls.get_adapter(platform)
                if adapter:
                    await adapter.start()
                    logger.info(f"Started {platform} channel adapter")
                else:
                    errors[platform] = f"Failed to create {platform} adapter"
            except Exception as e:
                error_msg = str(e)
                errors[platform] = error_msg
                logger.error(f"Failed to start {platform} adapter: {error_msg}")

        return errors

    @classmethod
    async def stop_all(cls) -> None:
        """Stop all running adapters."""
        for platform, adapter in cls._adapters.items():
            try:
                if adapter.is_running():
                    await adapter.stop()
                    logger.info(f"Stopped {platform} channel adapter")
            except Exception as e:
                logger.error(f"Error stopping {platform} adapter: {e}")

        cls._adapters.clear()


# Context variables for tracking current channel/user
from contextvars import ContextVar

_current_channel: ContextVar[Optional[Dict[str, Any]]] = ContextVar("current_channel", default=None)
_current_user: ContextVar[Optional[Dict[str, Any]]] = ContextVar("current_user", default=None)


def current_channel() -> Optional[Dict[str, Any]]:
    """Get the current channel context."""
    return _current_channel.get()


def current_user() -> Optional[Dict[str, Any]]:
    """Get the current user context."""
    return _current_user.get()


@asynccontextmanager
async def channel_context(channel: Dict[str, Any], user: Optional[Dict[str, Any]] = None):
    """Context manager for setting current channel and user."""
    channel_token = _current_channel.set(channel)
    user_token = _current_user.set(user) if user else None

    try:
        yield
    finally:
        _current_channel.reset(channel_token)
        if user_token:
            _current_user.reset(user_token)
