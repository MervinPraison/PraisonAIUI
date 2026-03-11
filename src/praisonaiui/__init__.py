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
        "settings", "profiles", "starters", "on", "resume", "page",
        "say", "stream", "stream_token", "think", "ask", "tool", "image", "audio",
        "video", "file", "action_buttons",
    }
    _message_attrs = {"Message", "AskUserMessage", "Step"}
    _server_attrs = {"register_agent", "register_page", "set_datastore", "get_datastore",
                      "set_provider", "get_provider", "set_style", "set_pages", "remove_page",
                      "set_branding"}
    _datastore_attrs = {"BaseDataStore", "MemoryDataStore", "JSONFileDataStore"}
    _provider_attrs = {"BaseProvider", "RunEvent", "RunEventType"}
    _providers_attrs = {"PraisonAIProvider"}
    _config_attrs = {"configure"}
    _features_attrs = {"BaseFeatureProtocol", "register_feature", "get_features",
                       "get_feature", "auto_register_defaults"}
    _ui_attrs = {"layout", "card", "columns", "chart", "table", "text"}
    if name in _callback_attrs:
        from praisonaiui import callbacks
        return getattr(callbacks, name)
    if name in _message_attrs:
        from praisonaiui import message
        return getattr(message, name)
    if name in _server_attrs:
        from praisonaiui import server
        return getattr(server, name)
    if name in _datastore_attrs:
        from praisonaiui import datastore
        return getattr(datastore, name)
    if name in _provider_attrs:
        from praisonaiui import provider
        return getattr(provider, name)
    if name in _providers_attrs:
        from praisonaiui import providers
        return getattr(providers, name)
    if name in _config_attrs:
        from praisonaiui import _config
        return getattr(_config, name)
    if name in _features_attrs:
        from praisonaiui import features
        return getattr(features, name)
    if name in _ui_attrs:
        from praisonaiui import ui
        return getattr(ui, name)
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
    "page",
    # Message functions
    "say",
    "stream",
    "stream_token",
    "think",
    "ask",
    "tool",
    "image",
    "audio",
    "video",
    "file",
    "action_buttons",
    # Server functions
    "register_agent",
    "register_page",
    "set_datastore",
    "get_datastore",
    "set_provider",
    "get_provider",
    "set_style",
    "set_branding",
    "set_pages",
    "remove_page",
    # DataStore classes
    "BaseDataStore",
    "MemoryDataStore",
    "JSONFileDataStore",
    # Provider protocol
    "BaseProvider",
    "RunEvent",
    "RunEventType",
    "PraisonAIProvider",
    # Configuration
    "configure",
    # Message classes (Chainlit pattern)
    "Message",
    "AskUserMessage",
    "Step",
    # Feature protocol
    "BaseFeatureProtocol",
    "register_feature",
    "get_features",
    "get_feature",
    "auto_register_defaults",
    # UI component API
    "layout",
    "card",
    "columns",
    "chart",
    "table",
    "text",
]
