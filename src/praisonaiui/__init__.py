"""PraisonAIUI - YAML-driven website generator with AI chat support."""

from praisonaiui.__version__ import __version__
from praisonaiui.schema.models import (
    AuthConfig,
    ChatConfig,
    ComponentConfig,
    Config,
    ContentConfig,
    DashboardConfig,
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
                      "set_branding", "set_theme", "set_custom_css", "register_theme",
                      "set_chat_features", "set_dashboard", "set_chat_mode", "set_brand_color",
                      "set_sidebar_config", "set_feedback_enabled"}
    _datastore_attrs = {"BaseDataStore", "MemoryDataStore", "JSONFileDataStore", "SQLAlchemyDataStore"}
    _provider_attrs = {"BaseProvider", "RunEvent", "RunEventType"}
    _providers_attrs = {"PraisonAIProvider"}
    _config_attrs = {"configure"}
    _features_attrs = {"BaseFeatureProtocol", "register_feature", "get_features",
                       "get_feature", "auto_register_defaults"}
    _ui_attrs = {
        "layout", "card", "columns", "chart", "table", "text",
        # Tier 1
        "metric", "progress_bar", "alert", "badge", "separator",
        "tabs", "accordion", "image_display", "code_block", "json_view",
        # Tier 2 — form inputs
        "text_input", "number_input", "select_input", "slider_input",
        "checkbox_input", "switch_input", "radio_input", "textarea_input",
        # Tier 3 — layout & advanced
        "container", "expander", "divider", "link", "button_group",
        "stat_group", "header", "markdown_text", "empty", "spinner",
        "avatar", "callout",
        # Tier A — must-have parity
        "multiselect_input", "date_input", "color_picker_input",
        "audio_player", "video_player", "file_download",
        # Tier B — high-value dashboard
        "toast", "dialog", "caption", "html_embed", "skeleton", "tooltip_wrap",
        # Tier C — completeness
        "time_input", "gallery", "breadcrumb", "pagination",
        "key_value_list", "popover",
    }
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
    "DashboardConfig",
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
    "set_theme",
    "set_custom_css",
    "set_chat_features",
    "set_dashboard",
    "set_chat_mode",
    "set_brand_color",
    "set_sidebar_config",
    "set_feedback_enabled",
    "register_theme",
    "set_pages",
    "remove_page",
    # DataStore classes
    "BaseDataStore",
    "MemoryDataStore",
    "JSONFileDataStore",
    "SQLAlchemyDataStore",
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
    # Tier 1
    "metric",
    "progress_bar",
    "alert",
    "badge",
    "separator",
    "tabs",
    "accordion",
    "image_display",
    "code_block",
    "json_view",
    # Tier 2 — form inputs
    "text_input",
    "number_input",
    "select_input",
    "slider_input",
    "checkbox_input",
    "switch_input",
    "radio_input",
    "textarea_input",
    # Tier 3 — layout & advanced
    "container",
    "expander",
    "divider",
    "link",
    "button_group",
    "stat_group",
    "header",
    "markdown_text",
    "empty",
    "spinner",
    "avatar",
    "callout",
    # Tier A — must-have parity
    "multiselect_input",
    "date_input",
    "color_picker_input",
    "audio_player",
    "video_player",
    "file_download",
    # Tier B — high-value dashboard
    "toast",
    "dialog",
    "caption",
    "html_embed",
    "skeleton",
    "tooltip_wrap",
    # Tier C — completeness
    "time_input",
    "gallery",
    "breadcrumb",
    "pagination",
    "key_value_list",
    "popover",
]