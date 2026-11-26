"""Chat App — Full chat lifecycle, steps, prompts, buttons, and notifications.

Showcases:
    - @aiui.welcome, @aiui.on_chat_start, @aiui.reply, @aiui.cancel, @aiui.goodbye
    - @aiui.profiles, @aiui.starters, @aiui.author_rename
    - @aiui.step() for collapsible, timed tool traces
    - aiui.action_buttons() + @aiui.button() + aiui.notify(..., persist=True)

Run:
    aiui run app.py
"""

import praisonaiui as aiui


@aiui.step("Analyze prompt", type="tool")
def analyze_prompt(text: str) -> dict:
    return {"words": len(text.split()), "chars": len(text)}


@aiui.welcome
async def on_welcome():
    await aiui.say("Welcome! Pick a starter below or choose an assistant profile.")


@aiui.on_chat_start
async def on_start():
    aiui.user_session["turns"] = 0


@aiui.profiles
def get_profiles():
    return [
        {"name": "General", "description": "Everyday answers and brainstorming", "default": True},
        {"name": "Code", "description": "Focused code generation and review"},
        {"name": "Writer", "description": "Clear, concise editing and drafting"},
    ]


@aiui.author_rename
def rename_author(name: str) -> str:
    return {"Code": "Code Helper", "Writer": "Writing Coach"}.get(name, name)


@aiui.starters
def get_starters():
    return [
        {"label": "Say hello", "message": "Hello! What can you do?"},
        {"label": "Help me code", "message": "Write a concise Python retry decorator."},
        {"label": "Draft an update", "message": "Draft a 3-sentence project status update."},
    ]


@aiui.reply
async def on_message(message):
    turns = aiui.user_session.get("turns", 0) + 1
    aiui.user_session["turns"] = turns
    profile = message.agent_name or "General"

    async with aiui.Step("Prepare reply", type="run") as step:
        stats = analyze_prompt(message.text)
        await step.stream_token(f"Profile: {profile} · {stats['words']} words")

    await aiui.say(f"**[{profile} · Turn {turns}]** You said: {message.text}")
    await aiui.action_buttons([
        {"name": "helpful", "label": "Helpful"},
        {"name": "save_note", "label": "Save to notifications"},
    ])


@aiui.button("helpful")
async def on_helpful():
    await aiui.notify("Thanks for the feedback!", type="success")


@aiui.button("save_note")
async def on_save_note():
    await aiui.notify("Saved reply to workspace notes", type="info", persist=True, category="chat")


@aiui.cancel
async def on_cancel():
    await aiui.notify("Generation stopped", type="info")


@aiui.goodbye
async def on_goodbye():
    aiui.user_session.clear()
