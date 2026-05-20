"""Video Studio example — YAML scenes via PraisonAI Video engine sidecar."""

import praisonaiui as aiui
from praisonaiui.server import create_app
from praisonaiui.video_config import set_video_engine

aiui.set_style("dashboard")
aiui.set_branding(title="Video Studio", logo="🎬")
aiui.set_pages(["chat", "video-studio", "jobs", "config"])
aiui.set_dashboard(modules=["jobs", "video"], sidebar=True, page_header=True)

# Optional: override engine URL (default http://127.0.0.1:3921)
# set_video_engine(url="http://127.0.0.1:3921")


@aiui.page("video-studio", title="Video", icon="🎬", group="Create", order=20)
async def video_studio_page():
    return aiui.layout(
        [
            aiui.html_embed('<div id="video-studio-root"></div>'),
        ]
    )


app = create_app()
