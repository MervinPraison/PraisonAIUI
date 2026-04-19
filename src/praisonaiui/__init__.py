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
    }
    _lifecycle_attrs = {
        "on_app_startup",
        "on_app_shutdown",
    }
    _window_message_attrs = {
        "on_window_message",
        "send_window_message",
    }
    _audio_attrs = {
        "on_audio_start",
        "on_audio_chunk",
        "on_audio_end",
    }
    _message_attrs = {
        "Message",
        "AskUserMessage",
        "Step",
        "step",
        "prompt",
        "error",
        "PromptResult",
    }
    _mcp_attrs = {
        "MCPServer",
        "on_mcp_connect",
        "on_mcp_disconnect",
    }
    _server_attrs = {
        "register_agent",
        "register_page",
        "set_datastore",
        "get_datastore",
        "set_provider",
        "get_provider",
        "set_style",
        "set_pages",
        "remove_page",
        "set_branding",
        "set_theme",
        "set_custom_css",
        "set_custom_js",
        "register_theme",
        "set_chat_features",
        "set_dashboard",
        "set_chat_mode",
        "set_brand_color",
        "set_sidebar_config",
        "set_feedback_enabled",
        "register_page_action",
        "register_component_schema",
        "get_component_schemas",
    }
    _datastore_attrs = {
        "BaseDataStore",
        "MemoryDataStore",
        "JSONFileDataStore",
        "SQLAlchemyDataStore",
    }
    _provider_attrs = {"BaseProvider", "RunEvent", "RunEventType"}
    _providers_attrs = {"PraisonAIProvider"}
    _config_attrs = {"configure"}
    _action_attrs = {"Action", "action_callback"}
    _features_attrs = {
        "BaseFeatureProtocol",
        "register_feature",
        "get_features",
        "get_feature",
        "auto_register_defaults",
    }
    _realtime_attrs = {
        "RealtimeProtocol",
        "OpenAIRealtimeManager",
        "set_realtime",
        "get_realtime_manager",
        "set_realtime_manager",
    }
    _task_attrs = {"Task", "TaskList", "TaskStatus"}
    _ui_attrs = {
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
        "tooltip",
        "tooltip_wrap",
        # Tier C — completeness
        "time_input",
        "gallery",
        "breadcrumb",
        "pagination",
        "definition_list",
        "key_value_list",
        "popover",
        "form",
        "form_action",
    }
    if name in _callback_attrs:
        from praisonaiui import callbacks

        return getattr(callbacks, name)
    if name in _lifecycle_attrs:
        from praisonaiui.features import lifecycle

        return getattr(lifecycle, name)
    if name in _window_message_attrs:
        from praisonaiui.features import window_message

        return getattr(window_message, name)
    if name in _audio_attrs:
        from praisonaiui.features import audio

        return getattr(audio, name)
    if name in _message_attrs:
        from praisonaiui import message

        return getattr(message, name)
    if name in _mcp_attrs:
        from praisonaiui.features import mcp

        return getattr(mcp, name)
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
    if name in _action_attrs:
        from praisonaiui import actions

        return getattr(actions, name)
    if name in _features_attrs:
        from praisonaiui import features

        return getattr(features, name)
    if name in _realtime_attrs:
        from praisonaiui.features import realtime

        # Handle alias for set_realtime
        if name == "set_realtime":
            return realtime.set_realtime_manager
        return getattr(realtime, name)
    if name in _task_attrs:
        from praisonaiui import tasks

        return getattr(tasks, name)
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
    # Lifecycle hooks
    "on_app_startup",
    "on_app_shutdown",
    # Window message hooks
    "on_window_message",
    "send_window_message",
    # Audio hooks
    "on_audio_start",
    "on_audio_chunk",
    "on_audio_end",
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
    "register_page_action",
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
    # Action classes and decorators
    "Action",
    "action_callback",
    # Message classes + verb-first helpers
    "Message",
    "AskUserMessage",
    "Step",
    "step",
    "prompt",
    "error",
    "PromptResult",
    # MCP (Model Context Protocol)
    "MCPServer",
    "on_mcp_connect",
    "on_mcp_disconnect",
    # Feature protocol
    "BaseFeatureProtocol",
    "register_feature",
    "get_features",
    "get_feature",
    "auto_register_defaults",
    # Realtime voice protocol
    "RealtimeProtocol",
    "OpenAIRealtimeManager",
    "set_realtime",
    "get_realtime_manager",
    "set_realtime_manager",
    # Task management API
    "Task",
    "TaskList",
    "TaskStatus",
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
    "tooltip",
    "tooltip_wrap",
    # Tier C — completeness
    "time_input",
    "gallery",
    "breadcrumb",
    "pagination",
    "definition_list",
    "key_value_list",
    "popover",
    "form",
    "form_action",
]
