"""Platform channel adapters for Slack, Discord, and Teams.

This package provides protocol-driven channel adapters that integrate with
the existing PraisonAIUI message pipeline, allowing handlers to work across
all supported platforms seamlessly.
"""

from ._base import (
    BaseChannelAdapter,
    ChannelAdapterFactory,
    ChannelAdapterProtocol,
    channel_context,
    current_channel,
    current_user,
)

# Lazy imports for platform adapters to avoid heavy dependencies
__all__ = [
    "ChannelAdapterProtocol",
    "BaseChannelAdapter",
    "ChannelAdapterFactory",
    "current_channel",
    "current_user",
    "channel_context",
    "on_slack_reaction_added",
]


def __getattr__(name: str):
    """Lazy import platform-specific functionality."""
    if name == "on_slack_reaction_added":
        from .slack import on_slack_reaction_added

        return on_slack_reaction_added
    elif name == "SlackChannelAdapter":
        from .slack import SlackChannelAdapter

        return SlackChannelAdapter
    elif name == "DiscordChannelAdapter":
        from .discord import DiscordChannelAdapter

        return DiscordChannelAdapter
    elif name == "TeamsChannelAdapter":
        from .teams import TeamsChannelAdapter

        return TeamsChannelAdapter

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
