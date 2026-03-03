"""PraisonAIUI - YAML-driven website generator with AI chat support."""

from praisonaiui.__version__ import __version__
from praisonaiui.schema.models import (
    AuthConfig,
    ChatConfig,
    ComponentConfig,
    Config,
    ContentConfig,
    LayoutConfig,
    RouteConfig,
    SiteConfig,
    TemplateConfig,
)


# Lazy import callbacks to avoid circular imports
def __getattr__(name: str):
    """Lazy import for callback decorators and functions."""
    _callback_attrs = {
        "welcome", "reply", "goodbye", "cancel", "button", "login",
        "settings", "profiles", "starters", "on", "resume",
        "say", "stream", "think", "ask", "tool", "image", "audio",
        "video", "file", "action_buttons",
    }
    _message_attrs = {"Message", "AskUserMessage", "Step"}
    if name in _callback_attrs:
        from praisonaiui import callbacks
        return getattr(callbacks, name)
    if name in _message_attrs:
        from praisonaiui import message
        return getattr(message, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "__version__",
    "Config",
    "SiteConfig",
    "ContentConfig",
    "ComponentConfig",
    "TemplateConfig",
    "RouteConfig",
    "ChatConfig",
    "AuthConfig",
    "LayoutConfig",
    # Callback decorators
    "welcome",
    "reply",
    "goodbye",
    "cancel",
    "button",
    "login",
    "settings",
    "profiles",
    "starters",
    "on",
    "resume",
    # Message functions
    "say",
    "stream",
    "think",
    "ask",
    "tool",
    "image",
    "audio",
    "video",
    "file",
    "action_buttons",
    # Message classes (Chainlit pattern)
    "Message",
    "AskUserMessage",
    "Step",
]
