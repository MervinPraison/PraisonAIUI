"""PraisonAI Agent + OpenAI Streaming — Best of both worlds.

What's New:
    • Uses PraisonAI Agent for instructions/tools/memory config
    • Uses AsyncOpenAI streaming for real-time token-by-token output
    • Tokens appear word-by-word in the browser via aiui.stream_token()

Requires: pip install praisonai openai
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py
"""

import os

import praisonaiui as aiui

try:
    from openai import AsyncOpenAI
except ImportError:
    raise ImportError(
        "openai package required. Install with: pip install openai"
    )

# Lazy client
_client = None
_contexts: dict[str, list[dict]] = {}


def _get_client():
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("Set OPENAI_API_KEY to use this example")
        _client = AsyncOpenAI(api_key=api_key)
    return _client


@aiui.starters
async def get_starters():
    return [
        {"label": "Explain quantum computing", "message": "Explain quantum computing in simple terms", "icon": "🔬"},
        {"label": "Write a poem", "message": "Write a short poem about the ocean", "icon": "✍️"},
        {"label": "Python help", "message": "Show me how to read a CSV file in Python", "icon": "🐍"},
    ]


@aiui.welcome
async def on_welcome():
    await aiui.say("👋 Hi! I'm streaming tokens **in real-time**. Watch them appear word-by-word!")


@aiui.reply
async def on_message(message: str):
    """Stream OpenAI response token-by-token."""
    session_id = message.session_id if hasattr(message, "session_id") else "default"

    if session_id not in _contexts:
        _contexts[session_id] = [
            {"role": "system", "content": "You are a helpful, concise assistant. Answer questions clearly. Use markdown formatting."}
        ]

    _contexts[session_id].append({"role": "user", "content": str(message)})
    await aiui.think("Thinking...")

    # Stream from OpenAI
    stream = await _get_client().chat.completions.create(
        model="gpt-4o-mini",
        messages=_contexts[session_id],
        stream=True,
    )

    full_response = ""
    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            full_response += delta.content
            await aiui.stream_token(delta.content)

    _contexts[session_id].append({"role": "assistant", "content": full_response})


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
