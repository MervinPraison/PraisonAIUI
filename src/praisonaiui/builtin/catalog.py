"""The first-party plugins that ship with PraisonAIUI.

One record per domain: its pages and the feature protocols that serve them.
A record is named after its first page, or after its domain when it has no
page. The order of this tuple is the order the pages are added to the page
table and the features are registered, so keep new records in a sensible
nav position. Mount order between built-in features is not load-bearing: no
built-in route shadows another (a test checks this).

A page's API defaults to ``/api/<id>``; ``api_endpoint`` is set only where
the page reads something else. ``required=True`` marks a feature the host
itself depends on; it stays on when its record is disabled.
"""

from __future__ import annotations

from praisonaiui.plugin_registry import PageSpec

from ._plugin import BuiltinPlugin, feature, page

#: App shell sidebar groups: display order (other groups follow in
#: first-appearance order, then ``last``) and the groups that start folded.
#: ``set_dashboard(groups={...})`` overrides any key.
NAV_GROUPS: dict[str, object] = {
    "order": ["Agent", "Work", "Control"],
    "last": "Settings",
    "folded": ["Work", "Examples", "Create"],
}


def _replay_pages() -> tuple[PageSpec, ...]:
    # The brand mark lives with the feature; import it only when the page is on.
    from praisonaiui.features.replay import REPLAY_MARK_SVG

    return (
        page(
            "replay",
            "Replay",
            "⏮️",
            "Control",
            "Recorded agent runs, step by step: who did what, when, and at what cost",
            21,
            icon_svg=REPLAY_MARK_SVG,
            api_endpoint="/api/replay/runs",
            nav_icon="rotate-ccw",
        ),
    )


# Routes whose handlers live in praisonaiui.server. Imported at call time
# (inside create_app), so no handler moves and ``from praisonaiui.server
# import api_mcp_connect`` keeps working.


def _mcp_routes() -> list:
    from starlette.routing import Route

    from praisonaiui.server import api_mcp_connect, api_mcp_disconnect, api_mcp_servers

    return [
        Route("/api/mcp/servers", api_mcp_servers, methods=["GET"]),
        Route("/api/mcp/connect", api_mcp_connect, methods=["POST"]),
        Route("/api/mcp/disconnect/{server_id}", api_mcp_disconnect, methods=["POST"]),
    ]


def _debug_routes() -> list:
    from starlette.routing import Route

    from praisonaiui.server import api_debug

    return [Route("/api/debug", api_debug, methods=["GET"])]


def _logs_routes() -> list:
    from starlette.routing import Route

    from praisonaiui.server import api_logs

    return [Route("/api/logs", api_logs, methods=["GET"])]


BUILTIN_PLUGINS: tuple[BuiltinPlugin, ...] = (
    BuiltinPlugin(
        "overview",
        "System health and statistics",
        (
            page(
                "overview",
                "Overview",
                "📊",
                "Control",
                "System health and statistics",
                10,
                nav_icon="gauge",
            ),
        ),
    ),
    BuiltinPlugin(
        "chat",
        "Agent chat, with and without the canvas panel",
        (
            # React chat in the app shell (builtin.chat in src/frontend/src/builtin).
            page(
                "chat",
                "Chat",
                "💬",
                "Agent",
                "AI agent chat",
                1,
                kind="native",
                layout="full-bleed",
                nav_icon="message-square",
            ),
            page(
                "chat-canvas",
                "Chat + Canvas",
                "💬🖼️",
                "Agent",
                "Chat with live A2UI preview panel",
                2,
                layout="full-bleed",
                nav_icon="columns-2",
            ),
        ),
        feature_refs=(
            feature(".chat", "ChatFeature", required=True),
            feature(".attachments", "AttachmentsFeature"),
        ),
    ),
    BuiltinPlugin(
        "canvas",
        "Live A2UI surface workspace",
        (
            page(
                "canvas",
                "Canvas",
                "🖼️",
                "Agent",
                "Live A2UI surface workspace",
                6,
                nav_icon="panels-top-left",
            ),
        ),
        feature_refs=(feature(".surfaces", "SurfacesFeature"),),
    ),
    BuiltinPlugin(
        "channels",
        "Messaging platform connections and their inbox",
        (
            page(
                "channels",
                "Channels",
                "📡",
                "Agent",
                "Messaging platform connections",
                5,
                nav_icon="radio",
            ),
            page(
                "inbox",
                "Channel Inbox",
                "📥",
                "Agent",
                "Unified multi-channel conversation triage",
                6,
                nav_icon="inbox",
            ),
        ),
        feature_refs=(feature(".channels", "ChannelsFeature"),),
    ),
    BuiltinPlugin(
        "sessions",
        "Conversation sessions and the run timeline",
        (
            page(
                "sessions",
                "Sessions",
                "📋",
                "Control",
                "Manage conversation sessions",
                20,
                api_endpoint="/sessions",
                nav_icon="messages-square",
            ),
            page(
                "runs",
                "Runs",
                "⏱️",
                "Control",
                "Run flight recorder — timeline debugger",
                22,
                api_endpoint="/api/sessions",
                nav_icon="activity",
            ),
        ),
        feature_refs=(feature(".sessions_ext", "SessionsFeature", required=True),),
    ),
    BuiltinPlugin(
        "replay",
        "Recorded agent runs, step by step",
        _replay_pages,
        feature_refs=(feature(".replay", "ReplayFeature"),),
    ),
    BuiltinPlugin(
        "usage",
        "Token usage and metrics",
        (
            page(
                "usage",
                "Usage",
                "📈",
                "Control",
                "Token usage and metrics",
                30,
                nav_icon="chart-column",
            ),
        ),
        feature_refs=(feature(".usage", "UsageFeature", required=True),),
    ),
    BuiltinPlugin(
        "feedback",
        "Message feedback analytics",
        (
            page(
                "feedback",
                "Feedback",
                "👍",
                "Control",
                "Message feedback analytics",
                25,
                nav_icon="message-square",
            ),
        ),
    ),
    BuiltinPlugin(
        "cron",
        "Scheduled jobs",
        (
            page(
                "cron",
                "Cron",
                "⏰",
                "Agent",
                "Scheduled jobs",
                35,
                api_endpoint="/api/schedules",
                nav_icon="clock",
            ),
        ),
        feature_refs=(feature(".schedules", "SchedulesFeature"),),
    ),
    BuiltinPlugin(
        "jobs",
        "Async agent jobs",
        (page("jobs", "Jobs", "📋", "Control", "Async agent jobs", 40, nav_icon="list-checks"),),
        feature_refs=(feature(".jobs", "JobsFeature"),),
    ),
    BuiltinPlugin(
        "work",
        "Work hub and the kanban boards",
        (
            page(
                "work",
                "Work Hub",
                "🗂️",
                "Work",
                "Unified kanban, card detail, chat and job log",
                9,
                nav_icon="layout-dashboard",
            ),
            page(
                "jobs-board",
                "Jobs Board",
                "📊",
                "Work",
                "Jobs kanban by status",
                11,
                nav_icon="columns-3",
            ),
            page(
                "kanban",
                "Kanban",
                "📌",
                "Work",
                "Multi-agent task board",
                10,
                nav_icon="square-kanban",
            ),
        ),
        # The bundled folder registers the same kanban view for the dashboard.
        dashboard_plugins=("kanban",),
        feature_refs=(feature(".kanban", "KanbanFeature"),),
    ),
    BuiltinPlugin(
        "approvals",
        "Execution approval queue",
        (
            page(
                "approvals",
                "Approvals",
                "✅",
                "Control",
                "Execution approval queue",
                45,
                nav_icon="shield-check",
            ),
        ),
        feature_refs=(feature(".approvals", "ApprovalsFeature"),),
    ),
    BuiltinPlugin(
        "api",
        "OpenAI-compatible API endpoints",
        (
            page(
                "api",
                "API",
                "🔌",
                "Control",
                "OpenAI-compatible API endpoints",
                50,
                nav_icon="braces",
            ),
        ),
        feature_refs=(feature(".openai_api", "OpenAIAPIFeature"),),
    ),
    BuiltinPlugin(
        "agents",
        "Configured AI agents",
        (page("agents", "Agents", "🤖", "Agent", "Configured AI agents", 10, nav_icon="bot"),),
        feature_refs=(
            feature(".agents", "AgentsCrudFeature"),
            feature(".subagents", "SubagentsFeature"),
        ),
    ),
    BuiltinPlugin(
        "skills",
        "Agent skills & plugins",
        (page("skills", "Skills", "⚡", "Agent", "Agent skills & plugins", 20, nav_icon="zap"),),
        feature_refs=(feature(".skills", "SkillsFeature"),),
    ),
    BuiltinPlugin(
        "marketplace",
        "Browse, install & manage plugins",
        (
            page(
                "marketplace",
                "Marketplace",
                "🧩",
                "Agent",
                "Browse, install & manage plugins",
                22,
                api_endpoint="/api/marketplace/plugins",
                nav_icon="store",
            ),
        ),
        feature_refs=(feature(".marketplace", "MarketplaceFeature"),),
    ),
    BuiltinPlugin(
        "memory",
        "Agent memory & knowledge store",
        (
            page(
                "memory",
                "Memory",
                "🧠",
                "Agent",
                "Agent memory & knowledge store",
                25,
                nav_icon="brain",
            ),
        ),
        feature_refs=(feature(".memory", "MemoryFeature"),),
    ),
    BuiltinPlugin(
        "knowledge",
        "Knowledge base & RAG",
        (
            page(
                "knowledge",
                "Knowledge",
                "📚",
                "Agent",
                "Knowledge base & RAG",
                27,
                nav_icon="book-open",
            ),
        ),
        feature_refs=(feature(".knowledge", "KnowledgeFeature"),),
    ),
    BuiltinPlugin(
        "nodes",
        "Execution nodes & presence",
        (
            page(
                "nodes",
                "Nodes",
                "🖥️",
                "Control",
                "Execution nodes & presence",
                15,
                nav_icon="server",
            ),
        ),
        feature_refs=(feature(".nodes", "NodesFeature"),),
    ),
    BuiltinPlugin(
        "mcp",
        "Model Context Protocol servers",
        (
            page(
                "mcp",
                "MCP",
                "🔌",
                "Agent",
                "Model Context Protocol servers",
                30,
                api_endpoint="/api/mcp/servers",
                nav_icon="plug",
            ),
        ),
        host_routes=_mcp_routes,
    ),
    BuiltinPlugin(
        "config",
        "Server configuration",
        (
            page(
                "config", "Config", "⚙️", "Settings", "Server configuration", 10, nav_icon="settings"
            ),
        ),
        feature_refs=(
            feature(".config_runtime", "ConfigRuntimeFeature", required=True),
            feature(".config_hot_reload", "ConfigHotReloadFeature"),
        ),
    ),
    BuiltinPlugin(
        "auth",
        "Authentication settings",
        (
            page(
                "auth",
                "Auth",
                "🔐",
                "Settings",
                "Authentication settings",
                15,
                nav_icon="key-round",
            ),
        ),
        feature_refs=(feature(".auth", "AuthFeature", required=True),),
    ),
    BuiltinPlugin(
        "logs",
        "Server logs and events",
        (
            page(
                "logs",
                "Logs",
                "📜",
                "Settings",
                "Server logs and events",
                20,
                nav_icon="scroll-text",
            ),
        ),
        feature_refs=(feature(".logs", "LogsFeature"),),
        host_routes=_logs_routes,
    ),
    BuiltinPlugin(
        "debug",
        "Debug information",
        (page("debug", "Debug", "🐛", "Settings", "Debug information", 30, nav_icon="bug"),),
        host_routes=_debug_routes,
    ),
    BuiltinPlugin(
        "guardrails",
        "Input/output safety guardrails",
        (
            page(
                "guardrails",
                "Guardrails",
                "🛡️",
                "Agent",
                "Input/output safety guardrails",
                35,
                nav_icon="shield-check",
            ),
        ),
        feature_refs=(feature(".guardrails", "GuardrailsFeature"),),
    ),
    BuiltinPlugin(
        "eval",
        "Agent evaluation & accuracy",
        (
            page(
                "eval",
                "Eval",
                "📊",
                "Control",
                "Agent evaluation & accuracy",
                40,
                nav_icon="clipboard-check",
            ),
        ),
        feature_refs=(feature(".eval", "EvalFeature"),),
    ),
    BuiltinPlugin(
        "training",
        "praisonai-train sessions and profiles",
        (
            page(
                "training",
                "Training",
                "🧪",
                "Control",
                "Inspect praisonai-train sessions & apply profiles",
                42,
                nav_icon="flask-conical",
            ),
        ),
        feature_refs=(feature(".training", "TrainingFeature"),),
    ),
    BuiltinPlugin(
        "code-studio",
        "Write, run, and share code in a sandbox",
        (
            page(
                "code-studio",
                "Code Studio",
                "💻",
                "Control",
                "Write, run, and share code in a sandbox",
                45,
                api_endpoint="/api/code/languages",
                nav_icon="code",
                shell_layout="full-bleed",
            ),
        ),
        feature_refs=(feature(".code_execution", "CodeExecutionFeature"),),
    ),
    BuiltinPlugin(
        "telemetry",
        "Performance monitoring & profiling",
        (
            page(
                "telemetry",
                "Telemetry",
                "📈",
                "Settings",
                "Performance monitoring & profiling",
                25,
                nav_icon="activity",
            ),
        ),
        feature_refs=(feature(".telemetry", "TelemetryFeature"),),
    ),
    BuiltinPlugin(
        "traces",
        "Distributed tracing & observability",
        (
            page(
                "traces",
                "Traces",
                "🔍",
                "Settings",
                "Distributed tracing & observability",
                27,
                nav_icon="activity",
            ),
        ),
        feature_refs=(feature(".tracing", "TracingFeature"),),
    ),
    BuiltinPlugin(
        "security",
        "Security monitoring & audit log",
        (
            page(
                "security",
                "Security",
                "🔒",
                "Settings",
                "Security monitoring & audit log",
                12,
                nav_icon="lock",
            ),
        ),
        feature_refs=(feature(".security", "SecurityFeature"),),
    ),
    BuiltinPlugin(
        "inspector",
        "Interactive API inspector",
        (
            page(
                "inspector",
                "Inspector",
                "🔍",
                "Control",
                "Interactive API inspector",
                99,
                position="footer",
                nav_icon="bug",
            ),
        ),
    ),
    BuiltinPlugin(
        "theme-picker",
        "Live color scheme picker",
        (
            page(
                "theme-picker",
                "Theme",
                "🎨",
                "Settings",
                "Live color scheme picker",
                35,
                nav_icon="settings",
            ),
        ),
        feature_refs=(feature(".theme", "ThemeFeature", required=True),),
    ),
    # Records below have no page: the features behind them serve other pages,
    # external clients or the browser (and can be switched off on their own).
    BuiltinPlugin(
        "agui",
        "AG-UI protocol endpoint (CopilotKit-compatible SSE)",
        feature_refs=(feature(".agui", "AguiFeature"),),
    ),
    BuiltinPlugin(
        "browser-automation",
        "Browser automation via CDP/Playwright",
        feature_refs=(feature(".browser_automation", "BrowserAutomationFeature"),),
    ),
    BuiltinPlugin(
        "device-pairing",
        "Device pairing via short codes",
        feature_refs=(feature(".device_pairing", "DevicePairingFeature"),),
    ),
    BuiltinPlugin(
        "hooks",
        "Pre/post operation hooks",
        feature_refs=(feature(".hooks", "HooksFeature"),),
    ),
    BuiltinPlugin(
        "i18n",
        "Translations for the UI",
        feature_refs=(feature(".i18n", "I18nFeature"),),
    ),
    BuiltinPlugin(
        "media-analysis",
        "Image and media analysis",
        feature_refs=(feature(".media_analysis", "MediaAnalysisFeature"),),
    ),
    BuiltinPlugin(
        "model-fallback",
        "Model fallback chain configuration",
        feature_refs=(feature(".model_fallback", "ModelFallbackFeature"),),
    ),
    BuiltinPlugin(
        "protocol",
        "WebSocket protocol versioning and negotiation",
        feature_refs=(feature(".protocol_version", "ProtocolFeature"),),
    ),
    BuiltinPlugin(
        "pwa",
        "Progressive Web App manifest and service worker",
        feature_refs=(feature(".pwa", "PWAFeature"),),
    ),
    BuiltinPlugin(
        "realtime",
        "Realtime voice",
        feature_refs=(feature(".realtime", "RealtimeFeature"),),
    ),
    BuiltinPlugin(
        "tts",
        "Text-to-speech",
        feature_refs=(feature(".tts", "TTSFeature"),),
    ),
    BuiltinPlugin(
        "workflows",
        "Multi-step agent workflows",
        feature_refs=(feature(".workflows", "WorkflowsFeature"),),
    ),
    BuiltinPlugin(
        "video",
        "Video Studio render jobs",
        feature_refs=(feature(".video", "VideoFeature"),),
        # The bundled folder is the Video Studio page; it only calls /api/video.
        dashboard_plugins=("video-studio",),
    ),
)
