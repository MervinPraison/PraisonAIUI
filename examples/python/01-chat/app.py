"""Basic Chat — Minimal echo-based chat with PraisonAIUI.

What's New (vs nothing):
    • @reply decorator — the core callback pattern
    • aiui.say() — send a message to the UI

This is the simplest possible chat app (8 lines). Start here.

Run:
    aiui run app.py
"""

import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    """Echo the user's message back."""
    await aiui.say(f"You said: {message}")
