"""PraisonAI Agent Streaming — real-time token-by-token output.

Uses praisonaiagents.Agent with stream_emitter to stream tokens
via PraisonAIUI. Tokens appear word-by-word in the browser.

Requires: pip install praisonaiagents praisonaiui
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py
"""

import asyncio
import os
import sys

import praisonaiui as aiui

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '_shared'))
from stream_bridge import StreamBridge

try:
    from praisonaiagents import Agent
except ImportError:
    raise ImportError(
        "praisonaiagents package required. Install with: pip install praisonaiagents"
    )


def _create_agent():
    """Create a PraisonAI Agent for streaming chat."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Set OPENAI_API_KEY to use this example")

    agent = Agent(
        name="Streaming Assistant",
        instructions="You are a helpful, concise assistant. Answer questions clearly. Use markdown formatting.",
        llm="gpt-4o-mini",
    )
    return agent


# Lazy agent
_agent = None


def _get_agent():
    global _agent
    if _agent is None:
        _agent = _create_agent()
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
    await aiui.say("👋 Hi! I'm streaming tokens **in real-time** using PraisonAI Agent. Watch them appear word-by-word!")


@aiui.reply
async def on_message(message: str):
    """Stream PraisonAI Agent response token-by-token via stream_emitter."""
    agent = _get_agent()

    await aiui.think("Thinking...")

    # Set up thread-safe streaming bridge
    bridge = StreamBridge()

    # Register callback using the bridge
    callback = bridge.emitter_callback()
    agent.stream_emitter.add_callback(callback)
    agent.stream_emitter.enable_metrics()

    try:
        # Run agent.chat concurrently with token consumption
        chat_task = asyncio.create_task(
            asyncio.to_thread(lambda: agent.chat(str(message), stream=True))
        )

        # Consume tokens as they arrive and stream to UI
        async for token in bridge.consume():
            await aiui.stream_token(token)

        # Wait for the chat to fully complete
        await chat_task

    finally:
        # Clean up callback
        agent.stream_emitter.remove_callback(callback)
        bridge.cancel()


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
