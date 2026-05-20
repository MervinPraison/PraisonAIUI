"""Image preview in chat — ImageAgent example.

Uses praisonaiagents ``ImageAgent`` with ``PraisonAIProvider`` so generated
images appear inline in chat via ``MESSAGE_ELEMENT`` events.

Requires:
    pip install praisonaiagents litellm
    export OPENAI_API_KEY=your-key

Optional:
    export IMAGE_MODEL=gpt-image-2   # default; override if your project uses another image model

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

# Match other chat examples (25-clean-chat, 26-custom-theme-chat): dashboard shell
aiui.set_style("dashboard")
aiui.set_dashboard(sidebar=False, page_header=False)
aiui.set_branding(title="Image Studio", logo="🖼️")
aiui.set_theme(preset="blue", dark_mode=True, radius="lg")
aiui.set_pages(["chat"])

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
async def get_starters():
    return [
        {"label": "Sunset over mountains", "message": "A sunset over mountains", "icon": "🌄"},
        {"label": "Robot portrait", "message": "A friendly robot portrait", "icon": "🤖"},
    ]
