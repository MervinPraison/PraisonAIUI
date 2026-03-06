"""PraisonAIUI Dynamic Dashboard — Example Application.

This app demonstrates the settings-driven dashboard that showcases
all 16 PraisonAIUI features. No HTML, CSS, or JavaScript required.

Usage:
    python app.py
    # Open http://localhost:8082
"""

import praisonaiui as aiui
from praisonaiui.server import create_app

# ── Configure style ─────────────────────────────────────────
aiui.set_style("dashboard")


# ── Optional: register custom pages with the component API ──
@aiui.page("analytics", title="Analytics", icon="📊", group="Custom")
async def analytics_page():
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
    return aiui.layout([
        aiui.columns([
            aiui.card("Uptime", value="99.97%"),
            aiui.card("Memory", value="324 MB"),
            aiui.card("CPU", value="12%"),
        ]),
        aiui.text("System metrics are refreshed every 30 seconds."),
    ])


# ── Create and run ──────────────────────────────────────────
app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8082)
