"""Custom Theme Chat — Dashboard chat with custom cyan/teal theme.

Demonstrates dynamic theme registration using aiui.register_theme()
to create a custom color palette with cyan accent colors.

Key colors (dark mode):
  - Background: #0a0a0f (near black)
  - Accent: #14b8a6 (teal/cyan)

Requires: pip install openai  (or pip install praisonai)
Set OPENAI_API_KEY before running.

Run:
    aiui run app.py
"""

import os

import praisonaiui as aiui

# ── Register custom teal/cyan theme ──────────────────────────────────
aiui.register_theme("teal-dark", {
    "accent": "#14b8a6",        # teal-500
    "accentRgb": "20,184,166",
})

# Apply the custom theme
aiui.set_theme(preset="teal-dark", dark_mode=True, radius="md")

# Configure branding
aiui.set_branding(title="AI Chat", logo="🤖")

# Dashboard style with sidebar disabled for clean look
aiui.set_style("dashboard")
aiui.set_dashboard(sidebar=False, page_header=False)
aiui.set_pages(["chat"])


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
