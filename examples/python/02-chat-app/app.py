"""Chat App — Full callback showcase with PraisonAIUI.

What's New (vs chat/):
    • @welcome — greet users when they open the chat
    • @button — handle action button clicks
    • @profiles — offer selectable agent personas
    • @starters — suggest conversation starters
    • @goodbye, @cancel — lifecycle hooks

Run:
    aiui run app.py
"""

import praisonaiui as aiui


@aiui.welcome
async def on_welcome():
    """Called when a user opens the chat."""
    await aiui.say("👋 Welcome! I'm your AI assistant. How can I help you today?")


@aiui.reply
async def on_message(message: str):
    """Called when a user sends a message."""
    # Show thinking steps
    await aiui.think("Understanding your request...")
    await aiui.think("Formulating response...")

    # Echo the message back (replace with actual AI logic)
    await aiui.say(f"You said: {message}")

    # Show action buttons
    await aiui.action_buttons([
        {"name": "helpful", "label": "👍 Helpful"},
        {"name": "not_helpful", "label": "👎 Not helpful"},
    ])


@aiui.button("helpful")
async def on_helpful():
    """Called when user clicks the helpful button."""
    await aiui.say("Thank you for the feedback! 🎉")


@aiui.button("not_helpful")
async def on_not_helpful():
    """Called when user clicks the not helpful button."""
    await aiui.say("I'm sorry to hear that. I'll try to do better!")


@aiui.goodbye
async def on_goodbye():
    """Called when a session ends."""
    print("Session ended")


@aiui.cancel
async def on_cancel():
    """Called when user clicks stop."""
    await aiui.say("Stopped generating response.")


@aiui.profiles
async def get_profiles():
    """Return available chat profiles."""
    return [
        {
            "name": "General Assistant",
            "description": "A helpful general-purpose assistant",
            "icon": "🤖",
            "default": True,
        },
        {
            "name": "Code Helper",
            "description": "Specialized in coding tasks",
            "icon": "💻",
        },
        {
            "name": "Creative Writer",
            "description": "Helps with creative writing",
            "icon": "✍️",
        },
    ]


@aiui.starters
async def get_starters():
    """Return starter messages."""
    return [
        {"label": "Say hello", "message": "Hello!", "icon": "👋"},
        {"label": "Tell me a joke", "message": "Tell me a funny joke", "icon": "😄"},
        {"label": "Help me code", "message": "Help me write a Python function", "icon": "💻"},
        {"label": "Explain something", "message": "Explain quantum computing simply", "icon": "🔬"},
    ]
