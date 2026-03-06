"""Shared demo data seeding for examples.

Used by examples 13, 15, and 16 to avoid copy-pasting the same data.
Import and call seed_demo_data() once at module load.
"""

import time


def seed_demo_data():
    """Populate all feature stores with realistic demo data."""
    from praisonaiui.features.channels import _channels
    from praisonaiui.features.nodes import _nodes, _instances
    from praisonaiui.features.schedules import _jobs
    from praisonaiui.features.skills import _skills

    now = time.time()

    # ── Channels ─────────────────────────────────────────────────────
    _channels["discord-general"] = {
        "id": "discord-general", "name": "Discord #general", "platform": "discord",
        "enabled": True, "running": True,
        "config": {"guild_id": "123456789", "channel_id": "987654321"},
        "created_at": now - 86400, "last_activity": now - 45,
    }
    _channels["telegram-support"] = {
        "id": "telegram-support", "name": "Telegram Support Bot", "platform": "telegram",
        "enabled": True, "running": True,
        "config": {"bot_token": "***masked***"},
        "created_at": now - 172800, "last_activity": now - 120,
    }
    _channels["slack-ai-team"] = {
        "id": "slack-ai-team", "name": "Slack #ai-team", "platform": "slack",
        "enabled": False, "running": False, "config": {},
        "created_at": now - 259200, "last_activity": None,
    }
    _channels["whatsapp-biz"] = {
        "id": "whatsapp-biz", "name": "WhatsApp Business", "platform": "whatsapp",
        "enabled": True, "running": True,
        "config": {"phone": "+1234567890"},
        "created_at": now - 43200, "last_activity": now - 300,
    }

    # ── Nodes ────────────────────────────────────────────────────────
    _nodes["dev-macbook"] = {
        "id": "dev-macbook", "name": "Dev MacBook Pro", "host": "localhost",
        "platform": "macos", "status": "online",
        "agents": ["code-reviewer", "summarizer", "translator"],
        "token": "node-tok-abc123", "approval_policy": "auto",
        "created_at": now - 86400, "last_heartbeat": now - 8,
    }
    _nodes["gpu-server-01"] = {
        "id": "gpu-server-01", "name": "GPU Training Server", "host": "gpu-01.internal",
        "platform": "linux", "status": "online",
        "agents": ["trainer", "embedder"],
        "token": "node-tok-xyz789", "approval_policy": "deny",
        "created_at": now - 172800, "last_heartbeat": now - 25,
    }
    _nodes["staging-k8s"] = {
        "id": "staging-k8s", "name": "K8s Staging Cluster", "host": "staging.k8s.internal",
        "platform": "linux", "status": "online",
        "agents": ["api-agent"],
        "token": "node-tok-stg456", "approval_policy": "ask",
        "created_at": now - 604800, "last_heartbeat": now - 60,
    }

    # ── Instances ────────────────────────────────────────────────────
    _instances["web-browser-1"] = {
        "id": "web-browser-1", "host": "user-laptop",
        "platform": "web", "version": "0.1.0",
        "roles": ["chat", "dashboard"], "mode": "client",
        "last_seen": now - 5,
    }
    _instances["worker-gpu-01"] = {
        "id": "worker-gpu-01", "host": "gpu-01.internal",
        "platform": "linux", "version": "0.1.0",
        "roles": ["inference", "training", "embedding"], "mode": "worker",
        "last_seen": now - 15,
    }
    _instances["mobile-ios-1"] = {
        "id": "mobile-ios-1", "host": "iphone-user",
        "platform": "ios", "version": "0.2.0",
        "roles": ["chat"], "mode": "client",
        "last_seen": now - 180,
    }
    _instances["cli-dev-1"] = {
        "id": "cli-dev-1", "host": "dev-terminal",
        "platform": "macos", "version": "0.1.0",
        "roles": ["admin", "debug"], "mode": "client",
        "last_seen": now - 30,
    }

    # ── Schedules ────────────────────────────────────────────────────
    _jobs["daily-report"] = {
        "id": "daily-report", "name": "Daily Summary Report",
        "schedule": "0 9 * * *", "enabled": True,
        "agent_id": "summarizer", "last_run": now - 3600,
        "run_count": 42, "created_at": now - 604800,
    }
    _jobs["health-ping"] = {
        "id": "health-ping", "name": "Health Ping",
        "schedule": "*/5 * * * *", "enabled": True,
        "agent_id": "monitor", "last_run": now - 120,
        "run_count": 2880, "created_at": now - 604800,
    }
    _jobs["weekly-train"] = {
        "id": "weekly-train", "name": "Weekly Model Retrain",
        "schedule": "0 2 * * 0", "enabled": False,
        "agent_id": "trainer", "last_run": now - 604800,
        "run_count": 8, "created_at": now - 2592000,
    }

    # ── Skills ───────────────────────────────────────────────────────
    _skills["web-search"] = {
        "id": "web-search", "name": "Web Search",
        "enabled": True, "config": {"provider": "tavily", "max_results": 5},
        "created_at": now - 86400,
    }
    _skills["code-review"] = {
        "id": "code-review", "name": "Code Review",
        "enabled": True, "config": {"language": "python", "style": "pep8"},
        "created_at": now - 172800,
    }
    _skills["translation"] = {
        "id": "translation", "name": "Translation",
        "enabled": True, "config": {"languages": ["en", "es", "fr", "de", "ja"]},
        "created_at": now - 259200,
    }
    _skills["image-gen"] = {
        "id": "image-gen", "name": "Image Generation",
        "enabled": False, "config": {"model": "dall-e-3"},
        "created_at": now - 345600,
    }
