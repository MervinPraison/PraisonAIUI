"""Clean Chat — Distraction-free chat in the React app shell (Workbench layout).

Uses ``aiui.configure()`` and ``aiui.only_my_pages("chat")`` so only the chat
experience appears, with clean branding and optional OpenAI streaming.

Run:
    aiui run app.py
"""

import os

import praisonaiui as aiui

aiui.configure(
    branding={"title": "AI Chat"},
    theme={"preset": "blue", "dark": True, "radius": "lg"},
)
aiui.set_layout("workbench")
aiui.only_my_pages("chat")


@aiui.welcome
async def on_welcome():
    await aiui.say("Hi! Ask me anything — I am ready to help.")


@aiui.starters
def get_starters():
    return [
        {"label": "Explain simply", "message": "Explain quantum computing in 3 plain sentences."},
        {"label": "Write code", "message": "Write a Python function to reverse a linked list."},
        {"label": "Brainstorm", "message": "Give me 5 practical AI agent ideas."},
    ]


@aiui.reply
async def on_message(message: str):
    if not os.getenv("OPENAI_API_KEY"):
        await aiui.say(f"Set `OPENAI_API_KEY` for live LLM streaming. Echo: **{message}**")
        return

    from openai import AsyncOpenAI

    stream = await AsyncOpenAI().chat.completions.create(
        model=os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        messages=[
            {"role": "system", "content": "You are a helpful, concise assistant."},
            {"role": "user", "content": message},
        ],
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            await aiui.stream_token(delta)
