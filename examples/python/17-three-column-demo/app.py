"""PraisonAIUI — Three-Column Feature Explorer.

Three-column layout that exercises ALL 31 features in one view:
  Left   → Clickable feature & endpoint list (grouped by category)
  Center → Live request/response activity log (what the gateway is doing)
  Right  → Formatted JSON output from the selected endpoint

Usage:
    cd examples/python/17-three-column-demo
    pip install -e ../../..          # install PraisonAIUI from source
    python app.py
    # Open http://localhost:8082
"""

import praisonaiui as aiui
from praisonaiui.server import create_app

aiui.set_style("dashboard")


# ── Register the Three-Column Explorer page ──────────────────

@aiui.page(
    "explorer",
    title="Feature Explorer",
    icon="🔬",
    group="Tools",
    order=0,
)
async def explorer_page():
    """Three-column feature explorer — custom view renders in JS."""
    return aiui.layout([
        aiui.text("Feature Explorer loads via custom view module."),
    ])


# ── Create and run ──────────────────────────────────────────

app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8082)
