"""Shared demo data seeding for examples.

Used by examples 13, 15, and 16 to avoid copy-pasting the same data.
Import and call seed_demo_data() once at module load.

NOTE: Since PraisonAIUI features now use various backends (FileScheduleStore,
ApprovalRegistry, etc.), seeding is best done via API calls in tests rather
than direct store manipulation.
"""


def seed_demo_data():
    """Populate feature stores with demo data.
    
    This is a no-op placeholder. Use API calls in tests to seed data,
    as feature stores may use different backends (file, DB, etc.).
    """
    pass


def seed_via_api(client):
    """Seed demo data via API calls (recommended approach).
    
    Args:
        client: Starlette TestClient instance
    """
    # Channels
    client.post("/api/channels", json={
        "name": "Discord #general", "platform": "discord",
        "config": {"guild_id": "123456789"}
    })
    client.post("/api/channels", json={
        "name": "Telegram Support", "platform": "telegram",
        "config": {"bot_token": "***masked***"}
    })
    
    # Agents
    client.post("/api/agents/definitions", json={
        "name": "Summarizer",
        "instructions": "You are an expert summarizer.",
        "model": "gpt-4o-mini"
    })
    client.post("/api/agents/definitions", json={
        "name": "Code Assistant",
        "instructions": "You are an expert programmer.",
        "model": "gpt-4o"
    })
    
    # Schedules
    client.post("/api/schedules", json={
        "name": "Daily Report",
        "schedule": {"kind": "every", "every_seconds": 86400},
        "message": "Generate daily summary"
    })
    
    # Usage
    client.post("/api/usage/track", json={
        "model": "gpt-4o-mini",
        "input_tokens": 150,
        "output_tokens": 80
    })
    
    # Jobs
    client.post("/api/jobs", json={
        "prompt": "Test job",
        "config": {"model": "gpt-4o-mini"}
    })
