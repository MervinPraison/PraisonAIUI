"""Chat with AI — LLM-powered chat using PraisonAIUI.

What's New (vs chat-app/):
    • OpenAI integration with AsyncOpenAI client
    • Streaming responses via aiui.stream_token()
    • Per-session conversation context
    • Lazy client initialization pattern

Requires: pip install openai
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py
    aiui run app.py --datastore json   # persist conversation history
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

# Keep per-session context in memory (DataStore handles persistence)
_contexts: dict[str, list[dict]] = {}


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
    await aiui.say("👋 Hi! I'm powered by OpenAI. Ask me anything.")


@aiui.reply
async def on_message(message: str):
    """Send the message to OpenAI and stream the response."""
    session_id = message.session_id if hasattr(message, "session_id") else "default"

    # Build conversation context
    if session_id not in _contexts:
        _contexts[session_id] = [
            {"role": "system", "content": "You are a helpful, concise assistant."}
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

    # Save assistant response to context
    _contexts[session_id].append({"role": "assistant", "content": full_response})

    # Feedback buttons
    await aiui.action_buttons([
        {"name": "helpful", "label": "👍 Helpful"},
        {"name": "not_helpful", "label": "👎 Not helpful"},
    ])


@aiui.button("helpful")
async def on_helpful():
    await aiui.say("Thank you! 🎉")


@aiui.button("not_helpful")
async def on_not_helpful():
    await aiui.say("Sorry about that. I'll try to improve! 🙏")


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
