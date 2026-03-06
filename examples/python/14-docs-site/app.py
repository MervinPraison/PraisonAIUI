"""Docs Site — Python documentation site with @page decorator.

What's New (vs dashboard/):
    • Multiple @page decorators for documentation sections
    • Markdown-style content served as structured data
    • Navigation hierarchy with groups
    • API-driven docs pages — zero frontend code

Run:
    aiui run app.py
    # Browse http://localhost:8000
    # API: curl http://localhost:8000/api/pages
"""

import praisonaiui as aiui


# ── Documentation Pages ──────────────────────────────────────────────

@aiui.page("getting-started", title="Getting Started", icon="🚀",
           group="Guide", description="Quick start guide", order=1)
async def getting_started():
    return {
        "title": "Getting Started with PraisonAIUI",
        "sections": [
            {
                "heading": "Installation",
                "content": "```bash\npip install praisonaiui\n```",
            },
            {
                "heading": "Your First App",
                "content": (
                    "Create a file `app.py`:\n\n"
                    "```python\n"
                    "import praisonaiui as aiui\n\n"
                    "@aiui.reply\n"
                    "async def on_message(message: str):\n"
                    "    await aiui.say(f'You said: {message}')\n"
                    "```\n\n"
                    "Then run it:\n\n"
                    "```bash\naiui run app.py\n```"
                ),
            },
            {
                "heading": "Next Steps",
                "content": "See the Architecture and API Reference pages.",
            },
        ],
    }


@aiui.page("architecture", title="Architecture", icon="🏗️",
           group="Guide", description="System architecture overview", order=2)
async def architecture():
    return {
        "title": "Architecture",
        "sections": [
            {
                "heading": "Three-Layer Design",
                "content": (
                    "PraisonAIUI follows a protocol-driven architecture:\n\n"
                    "1. **Callback Layer** — `@reply`, `@welcome`, `@page` decorators\n"
                    "2. **Server Layer** — Starlette ASGI with auto-registered routes\n"
                    "3. **Feature Layer** — Protocol modules (Channels, Nodes, Schedules...)\n"
                ),
            },
            {
                "heading": "Protocol Pattern",
                "content": (
                    "Every feature implements `BaseFeatureProtocol`:\n\n"
                    "```python\n"
                    "class MyFeature(BaseFeatureProtocol):\n"
                    "    def routes(self): ...\n"
                    "    def cli_commands(self): ...\n"
                    "    async def health(self): ...\n"
                    "```"
                ),
            },
        ],
    }


@aiui.page("api-reference", title="API Reference", icon="📖",
           group="Reference", description="Complete API documentation", order=10)
async def api_reference():
    return {
        "title": "API Reference",
        "endpoints": [
            {"method": "GET", "path": "/api/features", "description": "List all features"},
            {"method": "GET", "path": "/api/pages", "description": "List all pages"},
            {"method": "GET", "path": "/health", "description": "Health check"},
            {"method": "GET", "path": "/api/channels", "description": "List channels"},
            {"method": "GET", "path": "/api/nodes", "description": "List nodes"},
            {"method": "GET", "path": "/api/schedules", "description": "List schedules"},
            {"method": "GET", "path": "/api/skills", "description": "List skills"},
            {"method": "GET", "path": "/api/memory", "description": "List memories"},
        ],
    }


@aiui.page("changelog", title="Changelog", icon="📝",
           group="Reference", description="Version history", order=11)
async def changelog():
    return {
        "title": "Changelog",
        "versions": [
            {
                "version": "0.1.0",
                "date": "2026-03-06",
                "changes": [
                    "Initial release with 10 protocol features",
                    "Chat, Dashboard, and Docs styles",
                    "Gateway integration for channels and nodes",
                    "@page decorator for custom pages",
                ],
            },
        ],
    }


# ── Chat callback (so the docs site also supports AI chat) ───────────

@aiui.reply
async def on_message(message: str):
    """Simple echo — swap with a real LLM for production."""
    await aiui.say(f"📖 You asked: **{message}**\n\nCheck the docs pages for more info!")
