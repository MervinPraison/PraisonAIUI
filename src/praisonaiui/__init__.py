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
        "surface_page",
        "surface_action",
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
        # PraisonAIUI-native aliases
        "on_startup",
        "on_shutdown",
    }
    _window_message_attrs = {
        "on_window_message",
        "send_window_message",
        # PraisonAIUI-native aliases
        "on_parent_message",
        "send_to_parent",
    }
    _audio_attrs = {
        "on_audio_start",
        "on_audio_chunk",
        "on_audio_end",
        # PraisonAIUI-native aliases
        "on_mic_start",
        "on_mic_data",
        "on_mic_stop",
    }
    _message_attrs = {
        "Message",
        "AskUserMessage",
        "Step",
        "step",
        "prompt",
        "error",
        "PromptResult",
        "AskFileMessage",
        "AskActionMessage",
        "AskElementMessage",
        "ErrorMessage",
        # PraisonAIUI-native aliases (noun-first, API-direction compliant)
        "TextPrompt",
        "FilePrompt",
        "ChoicePrompt",
        "LocationPrompt",
    }
    _sync_attrs = {"make_async", "run_sync", "AsyncContext"}
    _utils_attrs = {"sleep", "format_duration", "truncate_text", "safe_filename"}
    _elements_attrs = {
        "Plotly",
        "Pyplot",
        "Dataframe",
        "PlotlyElement",
        "PyplotElement",
        "DataframeElement",
    }
    _custom_element_attrs = {
        "CustomElement",
        "register_custom_component",
        "get_registered_components",
        "CustomElementProtocol",
    }
    _copilot_attrs = {
        "CopilotFunction",
        "copilot_function",
        "on_copilot_function_call",
        "get_copilot_functions",
        "get_copilot_function",
        "call_copilot_function",
        # PraisonAIUI-native aliases
        "UIFunction",
        "UIFunctionParameter",
        "ui_function",
        "on_ui_function",
        "call_ui_function",
        "get_ui_function",
        "get_ui_functions",
    }
    _chat_settings_attrs = {
        "ChatSettings",
        "TextInput",
        "NumberInput",
        "Slider",
        "Select",
        "Switch",
        "ColorPicker",
        "on_settings_update",
        "trigger_settings_update",
        "create_model_settings",
        "create_ui_settings",
        # PraisonAIUI-native aliases
        "Settings",
        "on_settings_change",
    }
    _mcp_attrs = {
        "MCPServer",
        "on_mcp_connect",
        "on_mcp_disconnect",
    }
    _channel_attrs = {
        "current_channel",
        "current_user",
        "on_slack_reaction_added",
        # PraisonAIUI-native alias
        "on_slack_reaction",
    }
    _auth_attrs = {
        "oauth_callback",
        "header_auth_callback",
        "password_auth_callback",
        "on_logout",
        "User",
        "Session",
        "on_shared_thread_view",
        # PraisonAIUI-native aliases
        "on_oauth_login",
        "on_header_login",
        "on_password_login",
        "on_shared_view",
    }
    _usage_attrs = {"get_token_usage"}
    _instrumentation_attrs = {
        "instrument_openai",
        "instrument_anthropic",
        "instrument_mistral",
        "instrument_google",
        "no_instrument",
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
        "set_settings",
        "set_dashboard",
        "set_chat_mode",
        "set_chat_preview",
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
    _provider_attrs = {
        "BaseProvider",
        "RunEvent",
        "RunEventType",
        # Discovery cards (Issue #48) — PraisonAI-native names
        "ModelCard",
        "AgentCard",
        "TeamCard",
        # RAG source chunks (Issue #49) — PraisonAI-native names
        "SourceChunk",
        "SourceBundle",
        # Rich reasoning (Issue #50) — PraisonAI-native name
        "ThoughtStep",
    }
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
    if name in _channel_attrs:
        from praisonaiui.features import platform_adapters

        return getattr(platform_adapters, name)
    if name in _auth_attrs:
        if name in ("on_shared_thread_view", "on_shared_view"):
            from praisonaiui.features import sharing

            return getattr(sharing, name)
        from praisonaiui import auth

        return getattr(auth, name)
    if name in _usage_attrs:
        from praisonaiui.features import usage

        return getattr(usage, name)
    if name in _instrumentation_attrs:
        from praisonaiui import instrumentation

        return getattr(instrumentation, name)
    if name in _sync_attrs:
        from praisonaiui import sync

        return getattr(sync, name)
    if name in _utils_attrs:
        from praisonaiui import utils

        return getattr(utils, name)
    if name in _elements_attrs:
        from praisonaiui import elements

        return getattr(elements, name)
    if name in _custom_element_attrs:
        from praisonaiui import custom_element

        return getattr(custom_element, name)
    if name in _copilot_attrs:
        from praisonaiui import copilot

        return getattr(copilot, name)
    if name in _chat_settings_attrs:
        from praisonaiui import chat_settings

        return getattr(chat_settings, name)
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
    "surface_page",
    "surface_action",
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
    "set_settings",
    "set_dashboard",
    "set_chat_mode",
    "set_chat_preview",
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
    # Discovery, citations, reasoning schema (Issues #48, #49, #50)
    # PraisonAI-native, noun-first names (not lifted from any external framework)
    "ModelCard",
    "AgentCard",
    "TeamCard",
    "SourceChunk",
    "SourceBundle",
    "ThoughtStep",
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
    # Ask* message family (file upload, action selection, element interaction)
    "AskFileMessage",
    "AskActionMessage",
    "AskElementMessage",
    "ErrorMessage",
    # Sync/async utilities
    "make_async",
    "run_sync",
    "AsyncContext",
    # Utility functions
    "sleep",
    "format_duration",
    "truncate_text",
    "safe_filename",
    # Element constructors
    "Plotly",
    "Pyplot",
    "Dataframe",
    "PlotlyElement",
    "PyplotElement",
    "DataframeElement",
    # Custom elements
    "CustomElement",
    "register_custom_component",
    "get_registered_components",
    "CustomElementProtocol",
    # Copilot functions
    "CopilotFunction",
    "copilot_function",
    "on_copilot_function_call",
    "get_copilot_functions",
    "get_copilot_function",
    "call_copilot_function",
    # Chat settings (widgets + callbacks)
    "ChatSettings",
    "TextInput",
    "NumberInput",
    "Slider",
    "Select",
    "Switch",
    "ColorPicker",
    "on_settings_update",
    "trigger_settings_update",
    "create_model_settings",
    "create_ui_settings",
    # MCP (Model Context Protocol)
    "MCPServer",
    "on_mcp_connect",
    "on_mcp_disconnect",
    # Channel platform adapters (Slack / Discord / Teams)
    "current_channel",
    "current_user",
    "on_slack_reaction_added",
    # Auth decorators & classes (OAuth, header, password, logout, sharing)
    "oauth_callback",
    "header_auth_callback",
    "password_auth_callback",
    "on_logout",
    "on_shared_thread_view",
    "User",
    "Session",
    # LLM instrumentation
    "instrument_openai",
    "instrument_anthropic",
    "instrument_mistral",
    "instrument_google",
    "no_instrument",
    # Usage tracking
    "get_token_usage",
    # ── PraisonAIUI-native, non-developer-friendly names ────────────
    # Shorter, plain-English aliases for the symbols above.  Use these
    # in new code; the original names remain importable for backward
    # compatibility.
    "TextPrompt",
    "FilePrompt",
    "ChoicePrompt",
    "LocationPrompt",
    "UIFunction",
    "UIFunctionParameter",
    "ui_function",
    "on_ui_function",
    "call_ui_function",
    "get_ui_function",
    "get_ui_functions",
    "Settings",
    "on_settings_change",
    "on_oauth_login",
    "on_header_login",
    "on_password_login",
    "on_shared_view",
    "on_slack_reaction",
    "on_startup",
    "on_shutdown",
    "on_parent_message",
    "send_to_parent",
    "on_mic_start",
    "on_mic_data",
    "on_mic_stop",
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
