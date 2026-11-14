"""The first-party plugins that ship with PraisonAIUI.

One record per domain. A record is named after its first page, or after its
domain when it has no page. The order of this tuple is the order the pages
are added to the page table, so keep new records in a sensible nav position.

A page's API defaults to ``/api/<id>``; ``api_endpoint`` is set only where
the page reads something else.
"""

from __future__ import annotations

from praisonaiui.plugin_registry import PageSpec

from ._plugin import BuiltinPlugin, page


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
        ),
    )


BUILTIN_PLUGINS: tuple[BuiltinPlugin, ...] = (
    BuiltinPlugin(
        "overview",
        "System health and statistics",
        (page("overview", "Overview", "📊", "Control", "System health and statistics", 10),),
    ),
    BuiltinPlugin(
        "chat",
        "Agent chat, with and without the canvas panel",
        (
            page("chat", "Chat", "💬", "Agent", "AI agent chat", 1, layout="full-bleed"),
            page(
                "chat-canvas",
                "Chat + Canvas",
                "💬🖼️",
                "Agent",
                "Chat with live A2UI preview panel",
                2,
                layout="full-bleed",
            ),
        ),
    ),
    BuiltinPlugin(
        "canvas",
        "Live A2UI surface workspace",
        (page("canvas", "Canvas", "🖼️", "Agent", "Live A2UI surface workspace", 6),),
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
            ),
            page(
                "inbox",
                "Channel Inbox",
                "📥",
                "Agent",
                "Unified multi-channel conversation triage",
                6,
            ),
        ),
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
            ),
            page(
                "runs",
                "Runs",
                "⏱️",
                "Control",
                "Run flight recorder — timeline debugger",
                22,
                api_endpoint="/api/sessions",
            ),
        ),
    ),
    BuiltinPlugin("replay", "Recorded agent runs, step by step", _replay_pages),
    BuiltinPlugin(
        "usage",
        "Token usage and metrics",
        (page("usage", "Usage", "📈", "Control", "Token usage and metrics", 30),),
    ),
    BuiltinPlugin(
        "feedback",
        "Message feedback analytics",
        (page("feedback", "Feedback", "👍", "Control", "Message feedback analytics", 25),),
    ),
    BuiltinPlugin(
        "cron",
        "Scheduled jobs",
        (page("cron", "Cron", "⏰", "Agent", "Scheduled jobs", 35, api_endpoint="/api/schedules"),),
    ),
    BuiltinPlugin(
        "jobs",
        "Async agent jobs",
        (page("jobs", "Jobs", "📋", "Control", "Async agent jobs", 40),),
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
            ),
            page("jobs-board", "Jobs Board", "📊", "Work", "Jobs kanban by status", 11),
            page("kanban", "Kanban", "📌", "Work", "Multi-agent task board", 10),
        ),
        # The bundled folder registers the same kanban view for the dashboard.
        dashboard_plugins=("kanban",),
    ),
    BuiltinPlugin(
        "approvals",
        "Execution approval queue",
        (page("approvals", "Approvals", "✅", "Control", "Execution approval queue", 45),),
    ),
    BuiltinPlugin(
        "api",
        "OpenAI-compatible API endpoints",
        (page("api", "API", "🔌", "Control", "OpenAI-compatible API endpoints", 50),),
    ),
    BuiltinPlugin(
        "agents",
        "Configured AI agents",
        (page("agents", "Agents", "🤖", "Agent", "Configured AI agents", 10),),
    ),
    BuiltinPlugin(
        "skills",
        "Agent skills & plugins",
        (page("skills", "Skills", "⚡", "Agent", "Agent skills & plugins", 20),),
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
            ),
        ),
    ),
    BuiltinPlugin(
        "memory",
        "Agent memory & knowledge store",
        (page("memory", "Memory", "🧠", "Agent", "Agent memory & knowledge store", 25),),
    ),
    BuiltinPlugin(
        "knowledge",
        "Knowledge base & RAG",
        (page("knowledge", "Knowledge", "📚", "Agent", "Knowledge base & RAG", 27),),
    ),
    BuiltinPlugin(
        "nodes",
        "Execution nodes & presence",
        (page("nodes", "Nodes", "🖥️", "Control", "Execution nodes & presence", 15),),
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
            ),
        ),
    ),
    BuiltinPlugin(
        "config",
        "Server configuration",
        (page("config", "Config", "⚙️", "Settings", "Server configuration", 10),),
    ),
    BuiltinPlugin(
        "auth",
        "Authentication settings",
        (page("auth", "Auth", "🔐", "Settings", "Authentication settings", 15),),
    ),
    BuiltinPlugin(
        "logs",
        "Server logs and events",
        (page("logs", "Logs", "📜", "Settings", "Server logs and events", 20),),
    ),
    BuiltinPlugin(
        "debug",
        "Debug information",
        (page("debug", "Debug", "🐛", "Settings", "Debug information", 30),),
    ),
    BuiltinPlugin(
        "guardrails",
        "Input/output safety guardrails",
        (page("guardrails", "Guardrails", "🛡️", "Agent", "Input/output safety guardrails", 35),),
    ),
    BuiltinPlugin(
        "eval",
        "Agent evaluation & accuracy",
        (page("eval", "Eval", "📊", "Control", "Agent evaluation & accuracy", 40),),
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
            ),
        ),
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
            ),
        ),
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
            ),
        ),
    ),
    BuiltinPlugin(
        "traces",
        "Distributed tracing & observability",
        (page("traces", "Traces", "🔍", "Settings", "Distributed tracing & observability", 27),),
    ),
    BuiltinPlugin(
        "security",
        "Security monitoring & audit log",
        (page("security", "Security", "🔒", "Settings", "Security monitoring & audit log", 12),),
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
            ),
        ),
    ),
    BuiltinPlugin(
        "theme-picker",
        "Live color scheme picker",
        (page("theme-picker", "Theme", "🎨", "Settings", "Live color scheme picker", 35),),
    ),
)
