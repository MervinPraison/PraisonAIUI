"""PraisonAIUI Gateway Integration — Full Execution + Streaming.

This example uses AIUIGateway instead of create_app(), enabling:
  - Real agent execution via praisonai
  - WebSocket streaming at /ws
  - Full dashboard with all features
  - Live agent interaction from the browser

Architecture:
    ┌──────────────────────────────────────────────────────────┐
    │               AIUIGateway (port 8083)                    │
    │                                                          │
    │  ┌────────────┐  ┌──────────────────┐  ┌─────────────┐  │
    │  │  Frontend   │  │  Dashboard APIs  │  │  WebSocket   │  │
    │  │  HTML/JS    │  │  /api/*          │  │  /ws         │  │
    │  │  Inspector  │  │  16 features     │  │  streaming   │  │
    │  └──────┬─────┘  └───────┬──────────┘  └──────┬──────┘  │
    │         │                │                     │          │
    │         └────────────────┴─────────────────────┘          │
    │                          │                                │
    │              ┌───────────┴──────────────┐                 │
    │              │  praisonai Gateway       │                 │
    │              │  WebSocketGateway        │                 │
    │              │  • Agent execution       │                 │
    │              │  • LLM routing           │                 │
    │              │  • Session management    │                 │
    │              └──────────────────────────┘                 │
    └──────────────────────────────────────────────────────────┘

Usage:
    conda activate test
    pip install -e /path/to/PraisonAIUI
    pip install praisonai praisonaiagents
    export OPENAI_API_KEY=sk-...   # or any supported LLM key
    python app.py
    # Open http://localhost:8083
    # Dashboard + Feature Inspector + live agent chat via WebSocket
"""

import asyncio
import os
import sys

# ── Import praisonaiui ──────────────────────────────────────
import praisonaiui as aiui

# ── Check gateway availability ──────────────────────────────
try:
    from praisonaiui.integration import AIUIGateway
    from praisonaiagents import Agent
    GATEWAY_OK = True
except ImportError as e:
    print(f"⚠️  Gateway dependencies missing: {e}")
    print("   Install with: pip install praisonai praisonaiagents")
    print("   Falling back to standalone mode.")
    GATEWAY_OK = False

# ── Set dashboard style ─────────────────────────────────────
aiui.set_style("dashboard")


# ── Agent definitions ───────────────────────────────────────
# These define the agents that will be registered with both
# the gateway (for execution) and the dashboard (for display)

AGENTS = [
    {
        "agent_id": "researcher",
        "name": "Researcher",
        "description": "Research assistant for finding and summarizing information",
        "instructions": (
            "You are a research assistant. When asked a question, "
            "provide a well-structured answer with key facts. "
            "Keep responses concise but informative."
        ),
        "model": "gpt-4o-mini",
        "icon": "🔬",
    },
    {
        "agent_id": "writer",
        "name": "Writer",
        "description": "Creative writer for content generation",
        "instructions": (
            "You are a creative writer. When given a topic, "
            "write engaging content in a clear, professional style. "
            "Keep responses focused and well-organized."
        ),
        "model": "gpt-4o-mini",
        "icon": "✍️",
    },
    {
        "agent_id": "coder",
        "name": "Coder",
        "description": "Coding assistant for Python, JavaScript, and more",
        "instructions": (
            "You are a coding assistant. Write clean, well-commented "
            "code with explanations. Support Python, JavaScript, "
            "and other popular languages."
        ),
        "model": "gpt-4o-mini",
        "icon": "💻",
    },
]


# ── Register custom pages ───────────────────────────────────
@aiui.page("analytics", title="Analytics", icon="📊", group="Custom")
async def analytics_page():
    """Custom analytics page — same protocol as standalone mode."""
    return aiui.layout([
        aiui.columns([
            aiui.card("Total Users", value=142, footer="+12% this week"),
            aiui.card("API Calls", value="3,847", footer="Last 24h"),
            aiui.card("Avg Latency", value="47ms", footer="-5ms from yesterday"),
            aiui.card("Success Rate", value="99.2%", footer="✓ Healthy"),
        ]),
        aiui.table(
            headers=["Agent", "Tasks Completed", "Status"],
            rows=[
                ["Researcher", 15, "Active"],
                ["Code Writer", 8, "Idle"],
                ["Reviewer", 12, "Active"],
            ],
        ),
    ])


def _register_agents_in_dashboard():
    """Register gateway agents in the agents_crud feature storage.

    This bridges the gateway's internal agent registry with the
    dashboard CRUD feature, so agents appear in the Agents page.
    """
    from praisonaiui.features.agents import get_agent_registry

    registry = get_agent_registry()
    existing = registry.list_all()
    existing_names = {a.get("name") for a in existing}

    for agent_def in AGENTS:
        # Skip if already registered
        if agent_def["name"] in existing_names:
            continue

        registry.create({
            "name": agent_def["name"],
            "description": agent_def["description"],
            "instructions": agent_def["instructions"],
            "model": agent_def["model"],
            "icon": agent_def["icon"],
        })
        print(f"   ✓ Dashboard: {agent_def['icon']} {agent_def['name']}")


# ── Main ────────────────────────────────────────────────────
async def main():
    if GATEWAY_OK:
        print("🚀 Starting with Gateway mode (full execution + streaming)")
        print()

        # Create the gateway
        gateway = AIUIGateway(
            host="0.0.0.0",
            port=8083,
        )

        # ── Register agents with gateway (for execution) ────
        for agent_def in AGENTS:
            agent = Agent(
                name=agent_def["name"],
                instructions=agent_def["instructions"],
                llm=agent_def["model"],
                self_reflect=False,
            )
            gateway.register_agent(agent, agent_id=agent_def["agent_id"])
            print(f"   ✓ Gateway:   {agent_def['icon']} {agent_def['name']} ({agent_def['model']})")

        # ── Register agents in dashboard CRUD storage ───────
        _register_agents_in_dashboard()

        print()
        print(f"   Dashboard:  http://localhost:8083")
        print(f"   WebSocket:  ws://localhost:8083/ws")
        print(f"   Inspector:  http://localhost:8083 → 🔍 Feature Inspector")
        print()

        # Start the gateway — this runs the full server
        await gateway.start()
    else:
        # Fallback to standalone mode (same as example 15)
        print("📦 Starting in standalone mode (CRUD only, no agent execution)")
        from praisonaiui.server import create_app
        import uvicorn

        _register_agents_in_dashboard()

        app = create_app()
        config = uvicorn.Config(app, host="0.0.0.0", port=8083, log_level="info")
        server = uvicorn.Server(config)
        await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
