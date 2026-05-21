"""Video Studio example — YAML scenes via PraisonAI Video engine sidecar."""

import os

import praisonaiui as aiui
from praisonaiui.server import create_app
from praisonaiui.video_config import set_video_engine

aiui.set_style("dashboard")
aiui.set_branding(title="Video Studio", logo="🎬")
aiui.set_pages(["chat", "video-studio", "jobs", "config"])
aiui.set_dashboard(modules=["jobs", "video"], sidebar=True, page_header=True)

# Optional: override engine URL (default http://127.0.0.1:3921)
# set_video_engine(url="http://127.0.0.1:3921")

_VIDEO_AGENT_INSTRUCTIONS = """You edit PraisonAI Video projects via tools.

Rules:
- scene.yaml must use schemaVersion: 1 with composition and scene blocks.
- Always video_lint_scene after video_update_scene; fix errors before render.
- Use video_render_project only when lint is clean.
- Omit render: in scene.yaml unless the user needs remotion (licensed) or hyperframes (deferred).
- Default render path is Playwright; optional render.backend in scene.yaml.
- Default project: VIDEO_STUDIO_PROJECT_ID env, or the only listed project.
- Skill reference: praisonai-video repo skills/praisonai-video/SKILL.md (YAML-first invariants).
"""

try:
    from praisonaiagents import Agent
    from praisonaiui.providers import PraisonAIProvider
    from praisonaiui.video_agent_tools import get_video_agent_tools

    _video_agent = Agent(
        name="Video Editor",
        instructions=_VIDEO_AGENT_INSTRUCTIONS,
        llm=os.environ.get("PRAISONAI_MODEL", "gpt-4o-mini"),
        tools=get_video_agent_tools(),
        reflection=False,
    )
    aiui.set_provider(PraisonAIProvider(agent=_video_agent))
except ImportError:
    pass  # Chat works without praisonaiagents; Video tab still uses REST APIs


@aiui.page("video-studio", title="Video", icon="🎬", group="Create", order=20)
async def video_studio_page():
    return aiui.layout(
        [
            aiui.html_embed('<div id="video-studio-root"></div>'),
        ]
    )


app = create_app()
