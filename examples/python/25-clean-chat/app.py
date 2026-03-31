"""Clean Chat — Dashboard chat without the sidebar navigation.

What's New (vs 18-full-chat/):
    • aiui.set_dashboard(sidebar=False) — hides the left nav panel
    • Uses the dashboard style for the rich chat UI (session list, agents)
    • But without the sidebar clutter (Chat, Channels, Agents, Skills, etc.)
    • Protocol-driven: all config flows through /ui-config.json

This gives you the dashboard chat experience in a cleaner layout.

Requires: pip install openai  (or pip install praisonai)
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py
"""

import os

import praisonaiui as aiui

# ── Dashboard style, but no sidebar navigation ─────────────
aiui.set_style("dashboard")
aiui.set_dashboard(sidebar=False, page_header=False)
aiui.set_branding(title="AI Chat", logo="💬")
aiui.set_theme(preset="blue", dark_mode=True, radius="lg")
aiui.set_pages(["chat"])  # Only show the chat page


@aiui.starters
async def get_starters():
    """Suggest conversation starters."""
    return [
        {"label": "Explain something", "message": "Explain quantum computing in simple terms", "icon": "🔬"},
        {"label": "Write code", "message": "Write a Python function to reverse a linked list", "icon": "💻"},
        {"label": "Creative writing", "message": "Write a haiku about coding at midnight", "icon": "✍️"},
        {"label": "Brainstorm", "message": "Give me 5 startup ideas using AI agents", "icon": "💡"},
    ]


@aiui.welcome
async def on_welcome():
    """Greet the user."""
    await aiui.say("👋 Hi! Ask me anything — I'm ready to help.")


@aiui.reply
async def on_message(message: str):
    """Stream a response from OpenAI."""
    await aiui.think("Thinking...")

    try:
        from openai import AsyncOpenAI
    except ImportError:
        await aiui.say("❌ Please install openai: `pip install openai`")
        return

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        await aiui.say("❌ Please set OPENAI_API_KEY environment variable.")
        return

    client = AsyncOpenAI(api_key=api_key)
    stream = await client.chat.completions.create(
        model=os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": "You are a helpful, concise assistant. Use markdown for formatting."},
            {"role": "user", "content": str(message)},
        ],
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            await aiui.stream_token(delta.content)


@aiui.cancel
async def on_cancel():
    await aiui.say("⏹️ Stopped.")
