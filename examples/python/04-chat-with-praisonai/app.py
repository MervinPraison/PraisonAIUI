"""Chat with PraisonAI Agents — Agent-powered chat using PraisonAIUI.

What's New (vs chat-with-ai/):
    • PraisonAI Agent instead of raw OpenAI client
    • asyncio.to_thread() for blocking agent.chat() calls
    • Non-streaming by default (agent returns full response)
    • Tip: pass stream=False explicitly for guaranteed non-streaming

Requires: pip install praisonai
Set OPENAI_API_KEY (or your preferred LLM key) before running.

Run:
    aiui run app.py
    aiui run app.py --datastore json   # persist conversation history
"""

import asyncio
import praisonaiui as aiui

# Lazy agent — only created when first message is sent
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
    """Suggest conversation starters."""
    return [
        {"label": "Explain quantum computing", "message": "Explain quantum computing in simple terms", "icon": "🔬"},
        {"label": "Write a poem", "message": "Write a short poem about the ocean", "icon": "✍️"},
        {"label": "Python help", "message": "Show me how to read a CSV file in Python", "icon": "🐍"},
        {"label": "Travel tips", "message": "What are the top 3 things to see in Tokyo?", "icon": "🗼"},
    ]


@aiui.welcome
async def on_welcome():
    """Greet the user."""
    await aiui.say("👋 Hi! I'm powered by PraisonAI Agents. Ask me anything.")


@aiui.reply
async def on_message(message: str):
    """Send the message to PraisonAI Agent and return the response."""
    await aiui.think("Thinking...")

    agent = _get_agent()
    # Run blocking agent.chat() in thread pool to avoid blocking the event loop
    response = await asyncio.to_thread(agent.chat, str(message))

    await aiui.say(str(response))


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
