"""Custom Theme Chat — Register and apply a custom teal theme preset.

Run:
    aiui run app.py
"""

import os

import praisonaiui as aiui

aiui.register_theme("teal-dark", {"accent": "#14b8a6", "accentRgb": "20,184,166"})
aiui.configure(
    branding={"title": "Teal AI Chat"},
    theme={"preset": "teal-dark", "dark": True, "radius": "md"},
)
aiui.only_my_pages("chat")


@aiui.welcome
async def on_welcome():
    await aiui.say("Welcome! This chat uses a custom registered `teal-dark` theme.")


@aiui.starters
def get_starters():
    return [
        {"label": "Theme tip", "message": "How do custom theme presets work in PraisonAIUI?"},
        {"label": "Write a haiku", "message": "Write a haiku about teal ocean waves."},
    ]


@aiui.reply
async def on_message(message: str):
    if not os.getenv("OPENAI_API_KEY"):
        await aiui.say(f"Echo (set `OPENAI_API_KEY` for live streaming): **{message}**")
        return

    from openai import AsyncOpenAI

    stream = await AsyncOpenAI().chat.completions.create(
        model=os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": message}],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            await aiui.stream_token(delta)
