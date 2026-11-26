"""Chat with PraisonAI Agent — Non-blocking agent execution with live step trace.

Requires:
    pip install "aiui[praisonai]"
    export OPENAI_API_KEY=sk-...

Run:
    aiui run app.py
    aiui run app.py --datastore json
"""

import asyncio
import os

import praisonaiui as aiui

_agent = None


def _get_agent():
    global _agent
    if _agent is None:
        from praisonaiagents import Agent

        _agent = Agent(
            name="Assistant",
            instructions="You are a helpful, concise assistant. Use Markdown formatting.",
            llm=os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        )
    return _agent


@aiui.welcome
async def on_welcome():
    await aiui.say("Hi! I am powered by PraisonAI Agents. Ask me anything.")


@aiui.starters
def get_starters():
    return [
        {"label": "Explain simply", "message": "Explain vector databases in plain English."},
        {"label": "Python helper", "message": "Show a clean dataclass example in Python."},
        {"label": "Summarize plan", "message": "Outline a 5-step launch checklist for a web app."},
    ]


@aiui.reply
async def on_message(message: str):
    async with aiui.Step("PraisonAI Agent", type="llm"):
        response = await asyncio.to_thread(_get_agent().chat, message)
    await aiui.say(str(response))
