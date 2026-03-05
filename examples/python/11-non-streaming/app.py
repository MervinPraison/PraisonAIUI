"""PraisonAI Agent — Non-Streaming Mode.

What's New:
    • Explicit non-streaming: agent.chat(stream=False)
    • Full response arrives at once via aiui.say()
    • Simple, clean code — no streaming complexity

Requires: pip install praisonai
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py
"""

import asyncio

import praisonaiui as aiui

_agent = None


def _get_agent():
    global _agent
    if _agent is None:
        try:
            from praisonaiagents import Agent
        except ImportError:
            raise ImportError(
                "praisonaiagents package required. Install with: pip install praisonai"
            )
        _agent = Agent(
            name="Assistant",
            instructions="You are a helpful, concise assistant. Answer questions clearly. Use markdown formatting.",
        )
    return _agent


@aiui.starters
async def get_starters():
    return [
        {"label": "Explain quantum computing", "message": "Explain quantum computing in simple terms", "icon": "🔬"},
        {"label": "Write a poem", "message": "Write a short poem about the ocean", "icon": "✍️"},
        {"label": "Python help", "message": "Show me how to read a CSV file in Python", "icon": "🐍"},
    ]


@aiui.welcome
async def on_welcome():
    await aiui.say("👋 Hi! I'm powered by PraisonAI Agents (**non-streaming**). Response appears all at once.")


@aiui.reply
async def on_message(message: str):
    """Send message to PraisonAI Agent and return full response."""
    await aiui.think("Thinking...")

    agent = _get_agent()
    # Non-streaming: agent returns full response at once
    response = await asyncio.to_thread(agent.chat, str(message), stream=False)

    await aiui.say(str(response))


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
