"""Dashboard — Admin panel with custom pages via @aiui.page.

What's New (vs agent-playground/):
    • @page decorator — register custom dashboard pages
    • @on("event") — alternative event-based callback syntax
    • Data-driven pages with zero frontend code
    • Protocol-driven provider system — swap any AI backend:
        aiui.set_provider(MyProvider())

Run:
    aiui run app.py --style dashboard
"""
import praisonaiui as aiui

# Register some agents for the dashboard to display
@aiui.on("profiles")
def profiles():
    return [
        {"name": "Code Expert", "description": "Code review & generation"},
        {"name": "Data Analyst", "description": "Data analysis & visualization"},
    ]

@aiui.on("reply")
def reply(message):
    return f"Echo: {message}"


# ---------- Protocol-driven custom page ----------
# This demonstrates how users can add their own dashboard pages
# with just a decorator and a function — zero frontend code needed.

@aiui.page("metrics", title="My Metrics", icon="📊", group="Analytics",
           description="Custom analytics dashboard")
async def metrics_page():
    """Data handler for the custom Metrics page.
    Returns a dict that the frontend renders automatically."""
    return {
        "total_users": 1_234,
        "active_today": 42,
        "revenue": "$12,345",
        "kpis": [
            {"label": "Conversion Rate", "value": "3.2%"},
            {"label": "Avg Response Time", "value": "1.2s"},
            {"label": "Uptime", "value": "99.9%"},
        ],
        "top_models": {
            "gpt-4o": "1,200 requests",
            "claude-3.5": "800 requests",
            "llama-3": "300 requests",
        },
    }
