"""PraisonAI Agent Streaming — Real-time token streaming via StreamBridge.

Requires:
    pip install "aiui[praisonai]"
    export OPENAI_API_KEY=sk-...

Run:
    aiui run app.py
"""

import asyncio
import os
import sys

import praisonaiui as aiui

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_shared"))
from stream_bridge import StreamBridge

_agent = None


def _get_agent():
    global _agent
    if _agent is None:
        from praisonaiagents import Agent

        _agent = Agent(
            name="Streaming Assistant",
            instructions="You are a helpful, concise assistant. Use Markdown formatting.",
            llm=os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        )
    return _agent


@aiui.welcome
async def on_welcome():
    await aiui.say("Hi! Watch replies stream token by token from a PraisonAI Agent.")


@aiui.starters
def get_starters():
    return [
        {"label": "Explain streaming", "message": "Explain SSE vs WebSockets in 3 bullets."},
        {"label": "Write a haiku", "message": "Write a haiku about clean Python code."},
    ]


@aiui.reply
async def on_message(message: str):
    agent = _get_agent()
    bridge = StreamBridge()
    callback = bridge.emitter_callback()
    agent.stream_emitter.add_callback(callback)

    try:
        chat_task = asyncio.create_task(
            asyncio.to_thread(lambda: agent.chat(message, stream=True))
        )
        async for token in bridge.consume():
            await aiui.stream_token(token)
        await chat_task
    finally:
        agent.stream_emitter.remove_callback(callback)
        bridge.cancel()
