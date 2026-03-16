"""Example 22: AgentMail Channel — Integrate AgentMail into the AIUI dashboard.

Unique Concept: AgentMail as a dashboard channel — managed via Channels API.

This example shows how AgentMail integrates with PraisonAIUI as a channel,
appearing alongside Telegram/Discord/Slack/Email in the dashboard. The
agentmail channel is managed through the same /api/channels endpoints.

Features:
    • Register agentmail as a channel via /api/channels API
    • Dashboard visibility alongside other messaging platforms
    • Gateway-managed lifecycle (start/stop/restart)
    • Programmatic inbox management (unique to AgentMail)

Architecture:
    ┌──────────────────────────────────────────────────────────┐
    │               AIUIGateway (port 8084)                    │
    │                                                          │
    │  ┌────────────┐  ┌──────────────────┐  ┌─────────────┐  │
    │  │  Dashboard  │  │  Channel APIs    │  │ AgentMail   │  │
    │  │  + Email    │  │  /api/channels   │  │  API-based  │  │
    │  │  Status     │  │  CRUD + Toggle   │  │  polling    │  │
    │  └────────────┘  └──────────────────┘  └─────────────┘  │
    └──────────────────────────────────────────────────────────┘

Requires:
    pip install praisonaiui praisonai agentmail praisonaiagents
    export OPENAI_API_KEY=sk-...
    export AGENTMAIL_API_KEY=am_...

Run:
    python app.py              # Start dashboard with agentmail channel
    python app.py --test       # Test APIs + seed data only
"""

import asyncio
import os
import sys

# ── Imports ─────────────────────────────────────────────────────────

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "src"))

from praisonaiui.server import create_app
import uvicorn

try:
    from praisonaiui.features.channels import ChannelsFeature
    from praisonaiui.features import get_feature
    CHANNELS_OK = True
except ImportError:
    CHANNELS_OK = False


# ── Seed agentmail channel via API ──────────────────────────────────

def seed_agentmail_channel():
    """Register an agentmail channel in the dashboard.

    This demonstrates how to programmatically add an agentmail channel
    to the AIUI dashboard, which is the same as using the dashboard UI
    or calling POST /api/channels directly.
    """
    from starlette.testclient import TestClient

    app = create_app()
    client = TestClient(app)

    # Check if agentmail channel already exists
    r = client.get("/api/channels")
    channels = r.json().get("channels", [])
    agentmail_exists = any(
        ch.get("platform") == "agentmail"
        for ch in channels
    )

    if not agentmail_exists:
        # Register agentmail as a channel
        r = client.post("/api/channels", json={
            "name": "Agent Inbox",
            "platform": "agentmail",
            "config": {
                "api_key": os.getenv("AGENTMAIL_API_KEY", ""),
                "domain": os.getenv("AGENTMAIL_DOMAIN", ""),
                "inbox_id": os.getenv("AGENTMAIL_INBOX_ID", ""),
                "polling_interval": 15,
            },
        })
        if r.status_code in (200, 201):
            channel_id = r.json().get("id", "unknown")
            print(f"   ✅ AgentMail channel registered: {channel_id}")
        else:
            print(f"   ⚠️  Channel registration: {r.status_code} — {r.json()}")
    else:
        print("   ✓ AgentMail channel already exists")

    # Also seed email + telegram for comparison in dashboard
    for name, platform in [("Support Email", "email"), ("Telegram Support", "telegram")]:
        existing = any(ch.get("platform") == platform for ch in channels)
        if not existing:
            client.post("/api/channels", json={
                "name": name,
                "platform": platform,
                "config": {},
            })
            print(f"   ✓ Seeded {platform} channel")


# ── Verify agentmail platform support ──────────────────────────────

def verify_agentmail_support():
    """Check if 'agentmail' is in the supported platforms list."""
    from starlette.testclient import TestClient

    app = create_app()
    client = TestClient(app)

    r = client.get("/api/channels/platforms")
    if r.status_code == 200:
        platforms = r.json().get("platforms", [])
        am_supported = "agentmail" in platforms
        email_supported = "email" in platforms
        print(f"   Supported platforms: {platforms}")
        print(f"   email supported: {'✅ Yes' if email_supported else '❌ No'}")
        print(f"   agentmail supported: {'✅ Yes' if am_supported else '❌ No'}")
        return am_supported
    return False


# ── Test channel lifecycle ──────────────────────────────────────────

def test_channel_api():
    """Test the full channel lifecycle for agentmail."""
    from starlette.testclient import TestClient

    app = create_app()
    client = TestClient(app)

    print("\n📋 Channel API Test")
    print("=" * 40)

    # List channels
    r = client.get("/api/channels")
    channels = r.json().get("channels", [])
    print(f"   GET /api/channels: {len(channels)} channels")
    for ch in channels:
        icon = {"email": "📧", "agentmail": "📩"}.get(ch.get("platform", ""), "💬")
        print(f"      {icon} {ch.get('name', '?')} ({ch.get('platform', '?')})")

    # Get agentmail channel status
    am_ch = next((ch for ch in channels if ch.get("platform") == "agentmail"), None)
    if am_ch:
        ch_id = am_ch.get("id")
        r = client.get(f"/api/channels/{ch_id}/status")
        print(f"   GET /api/channels/{ch_id}/status: {r.json()}")

    print()


# ── Main ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("📩 PraisonAIUI — AgentMail Channel Integration")
    print("=" * 50)
    print()

    if "--test" in sys.argv:
        # Test mode: verify APIs + seed data
        print("🔍 Verifying agentmail platform support...")
        verify_agentmail_support()
        print()
        print("🌱 Seeding agentmail channel...")
        seed_agentmail_channel()
        test_channel_api()
    else:
        # Run the dashboard
        print("🌱 Seeding channels...")
        seed_agentmail_channel()
        print()

        app = create_app()
        print(f"✅ Dashboard at http://localhost:8084")
        print(f"   Channels: http://localhost:8084/api/channels")
        print(f"   Platforms: http://localhost:8084/api/channels/platforms")
        uvicorn.run(app, host="0.0.0.0", port=8084, log_level="info")
