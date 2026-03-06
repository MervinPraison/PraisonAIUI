"""Full Dashboard Example — All PraisonAIUI features enabled.

Demonstrates:
  - 12 built-in dashboard pages (Overview, Channels, Sessions, Instances,
    Usage, Cron, Agents, Skills, Nodes, Config, Logs, Debug)
  - Channel management (Discord/Telegram/Slack/WhatsApp)
  - Scheduled job management (cron, interval, one-shot)
  - Node registration and instance presence
  - Skill configuration
  - Protocol-driven feature auto-registration

Run:
    pip install praisonaiui
    python app.py
    # Dashboard at http://localhost:8082
"""

from praisonaiui.server import create_app
import uvicorn


# ── Seed some demo data ──────────────────────────────────────────────
def seed_demo_data():
    """Pre-populate channels, schedules, skills, and nodes for demo."""
    from praisonaiui.features.channels import _channels
    from praisonaiui.features.nodes import _nodes, _instances
    from praisonaiui.features.schedules import _jobs
    from praisonaiui.features.skills import _skills

    import time

    # Demo channels
    _channels["discord-main"] = {
        "id": "discord-main",
        "name": "Discord #general",
        "platform": "discord",
        "enabled": True,
        "running": True,
        "config": {"guild_id": "123456789", "channel_id": "987654321"},
        "created_at": time.time() - 86400,
        "last_activity": time.time() - 60,
    }
    _channels["telegram-bot"] = {
        "id": "telegram-bot",
        "name": "Telegram Support Bot",
        "platform": "telegram",
        "enabled": True,
        "running": True,
        "config": {"bot_token": "***"},
        "created_at": time.time() - 172800,
        "last_activity": time.time() - 120,
    }
    _channels["slack-workspace"] = {
        "id": "slack-workspace",
        "name": "Slack #ai-team",
        "platform": "slack",
        "enabled": False,
        "running": False,
        "config": {"workspace": "ai-team", "channel": "#ai-team"},
        "created_at": time.time() - 259200,
        "last_activity": None,
    }

    # Demo scheduled jobs
    _jobs["daily-report"] = {
        "id": "daily-report",
        "name": "Daily Summary Report",
        "schedule": "0 9 * * *",
        "enabled": True,
        "agent_id": "summarizer",
        "last_run": time.time() - 3600,
        "next_run": time.time() + 82800,
        "run_count": 42,
        "created_at": time.time() - 604800,
    }
    _jobs["health-check"] = {
        "id": "health-check",
        "name": "System Health Check",
        "schedule": "every 5 minutes",
        "enabled": True,
        "agent_id": "monitor",
        "last_run": time.time() - 120,
        "next_run": time.time() + 180,
        "run_count": 2016,
        "created_at": time.time() - 604800,
    }

    # Demo skills
    _skills["web-search"] = {
        "id": "web-search",
        "name": "Web Search",
        "enabled": True,
        "config": {"provider": "tavily"},
        "created_at": time.time() - 86400,
    }
    _skills["code-exec"] = {
        "id": "code-exec",
        "name": "Code Execution",
        "enabled": True,
        "config": {"sandbox": "docker"},
        "created_at": time.time() - 172800,
    }
    _skills["file-analysis"] = {
        "id": "file-analysis",
        "name": "File Analysis",
        "enabled": False,
        "config": {},
        "created_at": time.time() - 259200,
    }

    # Demo nodes
    _nodes["local-node"] = {
        "id": "local-node",
        "name": "Local Dev Machine",
        "host": "localhost",
        "platform": "macos",
        "status": "online",
        "agents": ["summarizer", "monitor"],
        "token": "demo-token-abc",
        "approval_policy": "auto",
        "created_at": time.time() - 86400,
        "last_heartbeat": time.time() - 10,
    }
    _nodes["gpu-server"] = {
        "id": "gpu-server",
        "name": "GPU Training Server",
        "host": "gpu.internal",
        "platform": "linux",
        "status": "online",
        "agents": ["trainer"],
        "token": "demo-token-xyz",
        "approval_policy": "deny",
        "created_at": time.time() - 172800,
        "last_heartbeat": time.time() - 30,
    }

    # Demo instances
    _instances["client-web-1"] = {
        "id": "client-web-1",
        "host": "browser-user-1",
        "platform": "web",
        "version": "0.1.0",
        "roles": ["chat"],
        "mode": "client",
        "last_seen": time.time() - 5,
    }
    _instances["worker-gpu-1"] = {
        "id": "worker-gpu-1",
        "host": "gpu.internal",
        "platform": "linux",
        "version": "0.1.0",
        "roles": ["inference", "training"],
        "mode": "worker",
        "last_seen": time.time() - 15,
    }


seed_demo_data()

if __name__ == "__main__":
    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8082, log_level="info")
