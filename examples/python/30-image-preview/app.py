"""Image preview in chat — custom provider example.

Shows how any backend can emit ``MESSAGE_ELEMENT`` events so the chat UI
displays generated images inline. Swap ``ImagePreviewProvider`` for
``PraisonAIProvider`` or any other ``BaseProvider`` implementation.

Run:
    aiui run app.py
"""

import praisonaiui as aiui
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

# Placeholder image — replace with your own generation backend
DEMO_IMAGE_URL = "https://picsum.photos/seed/praisonaiui/512/512"


class ImagePreviewProvider(BaseProvider):
    """Minimal provider that returns a demo image for any prompt."""

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name=agent_name or "Image Bot")
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="Generating your image…\n")
        yield BaseProvider.message_element_event(
            {
                "type": "image",
                "url": DEMO_IMAGE_URL,
                "alt": f"Generated for: {message[:80]}",
            }
        )
        yield RunEvent(
            type=RunEventType.RUN_COMPLETED,
            content="Here is your generated image.",
            agent_name=agent_name or "Image Bot",
        )


aiui.set_provider(ImagePreviewProvider())


@aiui.starters
async def get_starters():
    return [
        {"label": "Sunset over mountains", "message": "A sunset over mountains", "icon": "🌄"},
        {"label": "Robot portrait", "message": "A friendly robot portrait", "icon": "🤖"},
    ]
