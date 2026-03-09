"""PraisonAIUI — Three-Column Feature Explorer (with Gateway).

Three-column layout that exercises ALL 31 features in one view:
  Left   → Clickable feature & endpoint list (grouped by category)
  Center → Live request/response activity log (what the gateway is doing)
  Right  → Formatted JSON output from the selected endpoint

Modes:
  1. Gateway mode (recommended) — starts real agent execution + WebSocket
     Requires: pip install praisonai praisonaiagents
               export OPENAI_API_KEY=sk-...
  2. Standalone mode (fallback) — REST APIs only, no agent execution

Usage:
    cd examples/python/17-three-column-demo
    pip install -e ../../..
    pip install praisonai praisonaiagents   # optional, for gateway mode
    export OPENAI_API_KEY=sk-...            # optional, for gateway mode
    python app.py
    # Open http://localhost:8082 → click "Feature Explorer" in sidebar
"""

import asyncio
import os
import sys

import praisonaiui as aiui

# ── Check gateway availability ──────────────────────────────
try:
    from praisonaiui.integration import AIUIGateway
    from praisonaiagents import Agent
    GATEWAY_OK = True
except ImportError as e:
    print(f"⚠️  Gateway dependencies not found: {e}")
    print("   Install with: pip install praisonai praisonaiagents")
    print("   Falling back to standalone mode (REST APIs only).\n")
    GATEWAY_OK = False

aiui.set_style("dashboard")


# ── Agent definitions ───────────────────────────────────────
AGENTS = [
    {
        "agent_id": "researcher",
        "name": "Researcher",
        "description": "Research assistant — finds and summarizes information",
        "instructions": (
            "You are a research assistant. Provide well-structured answers "
            "with key facts. Keep responses concise but informative."
        ),
        "model": os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        "icon": "🔬",
    },
    {
        "agent_id": "writer",
        "name": "Writer",
        "description": "Creative writer — generates content on any topic",
        "instructions": (
            "You are a creative writer. Write engaging content in a clear, "
            "professional style. Keep responses focused and well-organized."
        ),
        "model": os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        "icon": "✍️",
    },
    {
        "agent_id": "coder",
        "name": "Coder",
        "description": "Coding assistant — Python, JavaScript, and more",
        "instructions": (
            "You are a coding assistant. Write clean, well-commented "
            "code with explanations. Support Python, JavaScript, and "
            "other popular languages."
        ),
        "model": os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        "icon": "💻",
    },
]


# ── Register the Three-Column Explorer page ──────────────────

@aiui.page(
    "explorer",
    title="Feature Explorer",
    icon="🔬",
    group="Tools",
    order=0,
)
async def explorer_page():
    """Three-column feature explorer — custom view renders in JS."""
    return aiui.layout([
        aiui.text("Feature Explorer loads via custom view module."),
    ])


# ── Register agents in dashboard CRUD ───────────────────────

def _register_agents_in_dashboard():
    """Bridge gateway agents into the dashboard agents_crud feature."""
    from praisonaiui.features.agents import get_agent_registry

    registry = get_agent_registry()
    existing = registry.list_all()
    existing_names = {a.get("name") for a in existing}

    for agent_def in AGENTS:
        if agent_def["name"] in existing_names:
            continue
        registry.create({
            "name": agent_def["name"],
            "description": agent_def["description"],
            "instructions": agent_def["instructions"],
            "model": agent_def["model"],
            "icon": agent_def["icon"],
        })
        print(f"   ✓ Agent: {agent_def['icon']} {agent_def['name']}")


# ── Main ────────────────────────────────────────────────────

async def main():
    port = int(os.getenv("PORT", "8082"))

    if GATEWAY_OK:
        print("🚀 Starting with Gateway mode (full execution + streaming)")
        print()

        gateway = AIUIGateway(host="0.0.0.0", port=port)

        # Register agents with gateway for real execution
        for agent_def in AGENTS:
            agent = Agent(
                name=agent_def["name"],
                instructions=agent_def["instructions"],
                llm=agent_def["model"],
                self_reflect=False,
            )
            gateway.register_agent(agent, agent_id=agent_def["agent_id"])
            print(f"   ✓ Gateway:  {agent_def['icon']} {agent_def['name']} ({agent_def['model']})")

        # Also register in dashboard CRUD
        _register_agents_in_dashboard()

        print()
        print(f"   Dashboard:  http://localhost:{port}")
        print(f"   Explorer:   http://localhost:{port} → 🔬 Feature Explorer")
        print(f"   WebSocket:  ws://localhost:{port}/ws")
        print()

        await gateway.start()
    else:
        # Standalone: REST APIs only, no agent execution
        print("📦 Starting in standalone mode (REST APIs only, no agent execution)")
        from praisonaiui.server import create_app
        import uvicorn

        _register_agents_in_dashboard()

        app = create_app()
        print()
        print(f"   Dashboard:  http://localhost:{port}")
        print(f"   Explorer:   http://localhost:{port} → 🔬 Feature Explorer")
        print(f"   Note:       POST endpoints may fail without gateway")
        print()

        config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="info")
        server = uvicorn.Server(config)
        await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
