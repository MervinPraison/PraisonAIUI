"""Agent Playground — Multi-agent chat UI with PraisonAIUI.

What's New (vs chat-with-ai/):
    • Multiple agents with different system prompts
    • Profile-based agent switching via @profiles
    • Per-session, per-agent conversation context
    • register_agent() for dashboard visibility

Requires: pip install openai
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py --datastore json
"""

import os

import praisonaiui as aiui

try:
    from openai import AsyncOpenAI
except ImportError:
    raise ImportError(
        "openai package required. Install with: pip install openai"
    )

# Lazy client — only created when first message is sent
_client = None


def _get_client():
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "Set OPENAI_API_KEY environment variable to use this example"
            )
        _client = AsyncOpenAI(api_key=api_key)
    return _client

# Agent configurations — each has a system prompt and model
AGENTS = {
    "general": {
        "name": "General Assistant",
        "description": "A helpful general-purpose assistant",
        "icon": "🤖",
        "system": "You are a helpful, concise assistant.",
        "model": "gpt-4o-mini",
    },
    "coder": {
        "name": "Code Expert",
        "description": "Specialized in writing and debugging code",
        "icon": "💻",
        "system": (
            "You are an expert programmer. Write clean, well-documented code. "
            "Always include brief explanations of your approach."
        ),
        "model": "gpt-4o-mini",
    },
    "analyst": {
        "name": "Data Analyst",
        "description": "Analyzes data and provides insights",
        "icon": "📊",
        "system": (
            "You are a data analyst. When asked about data, provide structured analysis "
            "with clear insights. Use tables and bullet points for clarity."
        ),
        "model": "gpt-4o-mini",
    },
    "writer": {
        "name": "Creative Writer",
        "description": "Helps with creative writing and content",
        "icon": "✍️",
        "system": (
            "You are a creative writer. Craft engaging, vivid prose. "
            "Be imaginative and expressive."
        ),
        "model": "gpt-4o-mini",
    },
}

_contexts: dict[str, list[dict]] = {}
_active_agent: dict[str, str] = {}

# Register all agents
for agent_id, config in AGENTS.items():
    aiui.register_agent(config["name"], config)


@aiui.profiles
async def get_profiles():
    """Return available agent profiles (shown in sidebar profile selector)."""
    profiles = []
    for agent_id, config in AGENTS.items():
        profiles.append({
            "name": config["name"],
            "description": config["description"],
            "icon": config["icon"],
            "default": agent_id == "general",
        })
    return profiles


@aiui.starters
async def get_starters():
    """Dynamic starters based on the active agent."""
    return [
        {"label": "What can you do?", "message": "What are your capabilities?", "icon": "❓"},
        {"label": "Help me build", "message": "Help me build a REST API in Python", "icon": "🔧"},
        {"label": "Analyze this", "message": "Analyze the pros and cons of microservices vs monolith", "icon": "📊"},
        {"label": "Write something", "message": "Write a short story about an AI that learns to paint", "icon": "🎨"},
    ]


@aiui.welcome
async def on_welcome():
    """Welcome with agent list."""
    agent_list = "\n".join(
        f"- {cfg['icon']} **{cfg['name']}**: {cfg['description']}"
        for cfg in AGENTS.values()
    )
    await aiui.say(
        f"👋 Welcome to the Agent Playground!\n\n"
        f"Select an agent profile from the sidebar, or chat with the default assistant.\n\n"
        f"**Available Agents:**\n{agent_list}"
    )


@aiui.reply
async def on_message(message):
    """Route the message to the active agent and stream the response."""
    msg_text = str(message)
    session_id = getattr(message, "session_id", "default")
    agent_name = getattr(message, "agent_name", None)

    # Resolve agent from profile name or default
    agent_id = "general"
    if agent_name:
        for aid, cfg in AGENTS.items():
            if cfg["name"] == agent_name:
                agent_id = aid
                break

    _active_agent[session_id] = agent_id
    agent = AGENTS[agent_id]

    # Build per-session, per-agent context
    ctx_key = f"{session_id}:{agent_id}"
    if ctx_key not in _contexts:
        _contexts[ctx_key] = [
            {"role": "system", "content": agent["system"]}
        ]

    _contexts[ctx_key].append({"role": "user", "content": msg_text})

    await aiui.think(f"{agent['icon']} {agent['name']} is thinking...")

    # Stream from OpenAI
    stream = await _get_client().chat.completions.create(
        model=agent["model"],
        messages=_contexts[ctx_key],
        stream=True,
    )

    full_response = ""
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            full_response += delta.content
            await aiui.stream_token(delta.content)

    _contexts[ctx_key].append({"role": "assistant", "content": full_response})

    await aiui.action_buttons([
        {"name": "helpful", "label": "👍 Helpful"},
        {"name": "not_helpful", "label": "👎 Not helpful"},
        {"name": "copy", "label": "📋 Copy"},
    ])


@aiui.button("helpful")
async def on_helpful():
    await aiui.say("Thanks for the feedback! 🎉")


@aiui.button("not_helpful")
async def on_not_helpful():
    await aiui.say("I'll try harder next time! 🙏")


@aiui.button("copy")
async def on_copy():
    await aiui.say("Response copied to clipboard! 📋")


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Generation stopped.")


@aiui.goodbye
async def on_goodbye():
    print("Session ended.")
