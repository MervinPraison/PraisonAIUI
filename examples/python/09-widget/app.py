"""Copilot Widget — Floating or sidebar AI chat widget.

Configures chat in floating mode (switch to ``"sidebar"`` or ``"fullpage"`` as needed)
and streams replies using the shared StreamBridge helper when ``praisonaiagents`` is
installed, falling back to a concise echo reply otherwise.

Run:
    aiui run app.py
"""

import asyncio
import os
import sys

import praisonaiui as aiui

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "_shared"))
from stream_bridge import StreamBridge

aiui.configure(
    branding={"title": "Copilot Widget"},
    chat={"mode": "floating"},
)
aiui.set_chat_mode("floating", position=(20, 20), size=(420, 560), resizable=True)

_agent = None


def _get_agent():
    global _agent
    if _agent is None:
        try:
            from praisonaiagents import Agent
        except ImportError:
            return None
        _agent = Agent(
            name="Copilot",
            instructions="You are a concise embedded copilot. Keep answers brief and actionable.",
            llm=os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        )
    return _agent


@aiui.welcome
async def on_welcome():
    await aiui.say("Hi! I am your embedded AI copilot. Ask me anything.")


@aiui.starters
def get_starters():
    return [
        {"label": "Quick help", "message": "How can you help me?"},
        {"label": "Summarize", "message": "Summarize the key steps to deploy an AI app."},
        {"label": "Write code", "message": "Write a 5-line Python HTTP health check."},
    ]


@aiui.reply
async def on_message(message: str):
    agent = _get_agent()
    if agent is None:
        await aiui.say(f"Copilot preview (install `praisonaiagents` for live LLM): **{message}**")
        return

    bridge = StreamBridge()
    callback = bridge.emitter_callback()
    agent.stream_emitter.add_callback(callback)
    try:
        task = asyncio.create_task(asyncio.to_thread(lambda: agent.chat(message, stream=True)))
        async for token in bridge.consume():
            await aiui.stream_token(token)
        await task
    finally:
        agent.stream_emitter.remove_callback(callback)
        bridge.cancel()
