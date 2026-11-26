"""Image preview in chat — Inline agent-generated images via MESSAGE_ELEMENT.

Requires:
    pip install "aiui[praisonai]" litellm
    export OPENAI_API_KEY=sk-...

Optional:
    export IMAGE_MODEL=gpt-image-2

Run:
    aiui run app.py
"""

import os

import praisonaiui as aiui
from praisonaiui.providers import PraisonAIProvider

try:
    from praisonaiagents import ImageAgent
except ImportError as exc:
    raise ImportError("Install praisonaiagents: pip install praisonaiagents") from exc

aiui.configure(
    branding={"title": "Image Studio"},
    theme={"preset": "blue", "dark": True, "radius": "lg"},
)
aiui.only_my_pages("chat")

image_agent = ImageAgent(
    name="Image Bot",
    llm=os.environ.get("IMAGE_MODEL", "gpt-image-2"),
    verbose=False,
)
# Legacy DALL-E params break newer OpenAI image endpoints
image_agent.image_config.response_format = None
image_agent.image_config.style = None

aiui.set_provider(PraisonAIProvider(agent=image_agent))


@aiui.starters
def get_starters():
    return [
        {"label": "Sunset over mountains", "message": "A sunset over mountains"},
        {"label": "Robot portrait", "message": "A friendly robot portrait"},
    ]
