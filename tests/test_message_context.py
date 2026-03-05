"""Test app with MessageContext typing to verify type dispatch.

Run with:
    aiui run test_app.py
"""

import praisonaiui as aiui
from praisonaiui.server import MessageContext


@aiui.welcome
async def on_welcome():
    """Called when a user opens the chat."""
    await aiui.say("🧪 Test server running! All callbacks registered.")


@aiui.reply
async def on_message(msg: MessageContext):
    """Called with full MessageContext — verifies context dispatch."""
    await aiui.think(f"Received MessageContext with text: {msg.text}")
    await aiui.say(f"[MessageContext mode] text={msg.text}, session={msg.session_id}")


@aiui.starters
def get_starters():
    """Return starter messages (sync function)."""
    return [
        {"label": "Test 1", "message": "Hello from starter 1", "icon": "🔬"},
        {"label": "Test 2", "message": "Hello from starter 2", "icon": "🧪"},
    ]


@aiui.profiles
def get_profiles():
    """Return profiles (sync function)."""
    return [
        {"name": "Test Profile", "description": "For testing", "icon": "🔧"},
    ]


@aiui.cancel
async def on_cancel():
    """Called when stream is cancelled."""
    print("Cancel callback fired!")
