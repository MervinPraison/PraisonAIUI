"""Multi-Agent Playground — PraisonAI Agents with profile switching.

What's New (vs chat-with-praisonai/):
    • Multiple PraisonAI Agents with different specializations
    • Profile-based agent switching via @profiles
    • Context-aware starter messages per agent
    • Lazy per-agent creation pattern
    • --style agents activates tabbed AgentUILayout (sidebar with Agents/History tabs)

Requires: pip install praisonai
Set OPENAI_API_KEY (or your preferred LLM key) before running.

Run:
    aiui run app.py --style agents
    aiui run app.py --style agents --datastore json
"""

import asyncio
import praisonaiui as aiui

# ------------------------------------------------------------------
# Lazy agent creation (one per profile)
# ------------------------------------------------------------------
_agents: dict = {}

AGENT_CONFIGS = {
    "coder": {
        "name": "Coder",
        "instructions": (
            "You are an expert programmer. Write clean, well-commented code. "
            "Always include example usage. Use markdown code blocks."
        ),
    },
    "writer": {
        "name": "Writer",
        "instructions": (
            "You are a creative writer. Produce engaging, well-structured prose. "
            "Use headers, bullet points, and emphasis for clarity."
        ),
    },
    "analyst": {
        "name": "Data Analyst",
        "instructions": (
            "You are a data analyst. Provide clear data-driven insights. "
            "Use tables, lists, and structured formats. Include methodology notes."
        ),
    },
}


def _get_agent(agent_id: str):
    if agent_id not in _agents:
        try:
            from praisonaiagents import Agent
        except ImportError:
            raise ImportError(
                "praisonaiagents required. Install with: pip install praisonai"
            )
        cfg = AGENT_CONFIGS[agent_id]
        _agents[agent_id] = Agent(
            name=cfg["name"],
            instructions=cfg["instructions"],
        )
    return _agents[agent_id]


# ------------------------------------------------------------------
# Callbacks
# ------------------------------------------------------------------
_current_agent = {"id": "coder"}
_contexts: dict[str, list] = {}


@aiui.profiles
async def get_profiles():
    """Return available agent profiles."""
    return [
        {
            "id": "coder",
            "name": "Coder",
            "description": "Expert programmer",
            "icon": "💻",
            "active": _current_agent["id"] == "coder",
        },
        {
            "id": "writer",
            "name": "Writer",
            "description": "Creative writer",
            "icon": "✍️",
            "active": _current_agent["id"] == "writer",
        },
        {
            "id": "analyst",
            "name": "Data Analyst",
            "description": "Data-driven insights",
            "icon": "📊",
            "active": _current_agent["id"] == "analyst",
        },
    ]


@aiui.starters
async def get_starters():
    """Context-aware starter messages."""
    agent_id = _current_agent["id"]
    starters_map = {
        "coder": [
            {"label": "Python script", "message": "Write a Python script to parse CSV files", "icon": "🐍"},
            {"label": "REST API", "message": "Create a simple REST API with FastAPI", "icon": "🌐"},
        ],
        "writer": [
            {"label": "Blog post", "message": "Write a blog post about AI in education", "icon": "📝"},
            {"label": "Story", "message": "Write a short sci-fi story about time travel", "icon": "🚀"},
        ],
        "analyst": [
            {"label": "Sales analysis", "message": "How would you analyze quarterly sales data?", "icon": "📈"},
            {"label": "A/B test", "message": "Design an A/B test for a landing page", "icon": "🧪"},
        ],
    }
    return starters_map.get(agent_id, [])


@aiui.welcome
async def on_welcome():
    agent_id = _current_agent["id"]
    name = AGENT_CONFIGS[agent_id]["name"]
    await aiui.say(f"👋 Hi! I'm **{name}**. How can I help you today?")


@aiui.reply
async def on_message(message):
    """Route message to the active agent."""
    # Resolve agent from profile name sent in the request body
    agent_name = getattr(message, "agent_name", None)
    agent_id = _current_agent["id"]  # fallback to current
    if agent_name:
        for aid, cfg in AGENT_CONFIGS.items():
            if cfg["name"] == agent_name:
                agent_id = aid
                _current_agent["id"] = aid
                break
    await aiui.think(f"Thinking as {AGENT_CONFIGS[agent_id]['name']}...")

    agent = _get_agent(agent_id)
    # Run blocking agent.chat() in thread pool to avoid blocking the event loop
    response = await asyncio.to_thread(agent.chat, str(message))
    await aiui.say(str(response))


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
