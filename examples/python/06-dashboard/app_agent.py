"""Dashboard with PraisonAI Agent — no @aiui.reply override.

When no @aiui.reply callback is registered, PraisonAIProvider
falls through to direct mode and creates a praisonaiagents.Agent()
per session with memory=True.

Run:
    aiui run app_agent.py --style dashboard --port 8082
"""
import praisonaiui as aiui

# Only register pages — no @aiui.reply so the real Agent() is used
@aiui.page("metrics", title="My Metrics", icon="📊", group="Analytics",
           description="Custom analytics dashboard")
async def metrics_page():
    return {
        "total_users": 1_234,
        "active_today": 42,
        "revenue": "$12,345",
    }
