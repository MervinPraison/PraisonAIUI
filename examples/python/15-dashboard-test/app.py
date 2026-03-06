"""PraisonAIUI Dashboard — Complete Example.

Demonstrates the protocol-first page registration system.
All navigation/pages are registered via protocol → GET /api/pages → sidebar.
View modules auto-bind to pages via the extensible view registry.

Usage:
    conda activate test
    pip install -e /path/to/PraisonAIUI
    python app.py
    # Open http://localhost:8082

Architecture:
    ┌──────────────────────────────────────────────────────────┐
    │                     Protocol Flow                        │
    │                                                          │
    │  register_page()  →  GET /api/pages  →  sidebar menu    │
    │  @aiui.page()     →  GET /api/pages  →  sidebar menu    │
    │                                                          │
    │  dashboard.js     →  BUILTIN_VIEWS   →  view module     │
    │  window.aiui.registerView()          →  custom view      │
    └──────────────────────────────────────────────────────────┘

Everything is protocol-driven:
  - Pages come from API, not hardcoded HTML
  - Views come from modules, not inlined JS
  - Navigation is built from API response
  - Users can override any built-in page
"""

import praisonaiui as aiui
from praisonaiui.server import create_app

# ── Set style to "dashboard" ────────────────────────────────
aiui.set_style("dashboard")


# ── Optional: register custom pages ─────────────────────────
# These are registered VIA THE SAME PROTOCOL as built-in pages.
# The @aiui.page decorator calls register_page() internally.
# They appear in the sidebar alongside built-in pages.

@aiui.page("analytics", title="Analytics", icon="📊", group="Custom")
async def analytics_page():
    """Custom page with cards and tables rendered via component protocol."""
    return aiui.layout([
        aiui.columns([
            aiui.card("Total Users", value=142, footer="+12% this week"),
            aiui.card("API Calls", value="3,847", footer="Last 24h"),
            aiui.card("Avg Latency", value="47ms", footer="-5ms from yesterday"),
            aiui.card("Success Rate", value="99.2%", footer="✓ Healthy"),
        ]),
        aiui.table(
            headers=["Agent", "Tasks Completed", "Status"],
            rows=[
                ["Researcher", 15, "Active"],
                ["Code Writer", 8, "Idle"],
                ["Reviewer", 12, "Active"],
            ],
        ),
    ])


@aiui.page("metrics", title="Metrics", icon="📈", group="Custom")
async def metrics_page():
    """Another custom page — shows up in Custom group in sidebar."""
    return aiui.layout([
        aiui.columns([
            aiui.card("Uptime", value="99.97%"),
            aiui.card("Memory", value="324 MB"),
            aiui.card("CPU", value="12%"),
        ]),
        aiui.text("System metrics are refreshed every 30 seconds."),
    ])


# ── Create and run ──────────────────────────────────────────
# create_app() registers all built-in pages via the same protocol:
#   overview, channels, sessions, instances, usage, cron, jobs,
#   approvals, api, agents, skills, nodes, config, auth, logs, debug
#
# The sidebar is built from GET /api/pages response.
# View modules auto-bind via the BUILTIN_VIEWS registry in dashboard.js.

app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8082)
