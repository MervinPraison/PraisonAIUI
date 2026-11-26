"""Chat with AI — Streaming OpenAI replies with per-chat memory and feedback.

Requires:
    pip install openai
    export OPENAI_API_KEY=sk-...

Run:
    aiui run app.py
    aiui run app.py --datastore json   # persist conversation history
"""

import os

import praisonaiui as aiui

aiui.configure(
    branding={"title": "AI Chat"},
    chat={"feedback": True},
)

_client = None


def _get_client():
    global _client
    if _client is None:
        from openai import AsyncOpenAI

        _client = AsyncOpenAI()  # reads OPENAI_API_KEY from env or .env
    return _client


@aiui.welcome
async def on_welcome():
    await aiui.say("Hi! Ask me anything — replies stream live token by token.")


@aiui.starters
def get_starters():
    return [
        {"label": "Explain a concept", "message": "Explain async/await in Python in 3 bullets."},
        {"label": "Read CSV in Python", "message": "Show a concise Python snippet to parse a CSV file."},
        {"label": "Brainstorm", "message": "Give me 3 practical AI workflow ideas for a small team."},
    ]


@aiui.on_chat_start
async def on_start():
    aiui.user_session["messages"] = [
        {"role": "system", "content": "You are a helpful, concise assistant. Use Markdown."}
    ]


@aiui.reply
async def on_message(message: str):
    history = aiui.user_session.setdefault(
        "messages",
        [{"role": "system", "content": "You are a helpful, concise assistant. Use Markdown."}],
    )
    history.append({"role": "user", "content": message})

    stream = await _get_client().chat.completions.create(
        model=os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
        messages=history[-20:],
        stream=True,
    )

    chunks: list[str] = []
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            chunks.append(delta)
            await aiui.stream_token(delta)

    history.append({"role": "assistant", "content": "".join(chunks)})


@aiui.on("feedback")
async def on_feedback(event: dict):
    await aiui.notify(f"Feedback recorded ({event.get('value')})", type="info")
