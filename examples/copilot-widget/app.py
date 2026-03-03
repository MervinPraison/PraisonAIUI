"""Example Copilot Widget Application using PraisonAIUI.

This example shows how to add a floating chat widget to an existing docs site.

Run with:
    aiui run app.py
"""

import praisonaiui as aiui


@aiui.welcome
async def on_welcome():
    """Called when user opens the copilot widget."""
    await aiui.say("Hi! I'm your documentation assistant. Ask me anything about this site!")


@aiui.reply
async def on_message(message: str):
    """Handle user messages."""
    await aiui.think("Searching documentation...")

    # Simulate finding relevant docs
    await aiui.say(f"Based on your question about '{message}', here's what I found:\n\n"
                   "This is a placeholder response. In a real app, you would integrate "
                   "with your AI backend here.")


@aiui.starters
async def get_starters():
    """Return starter messages for the copilot."""
    return [
        {"label": "Getting started", "message": "How do I get started?", "icon": "🚀"},
        {"label": "Installation", "message": "How do I install this?", "icon": "📦"},
    ]
