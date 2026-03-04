"""Basic Chat — Minimal echo-based chat with PraisonAIUI.

This is the simplest possible chat app. It echoes user messages back.
Use this as a starting point to understand the callback pattern.

Run:
    aiui run app.py
"""

import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    """Echo the user's message back."""
    await aiui.say(f"You said: {message}")
