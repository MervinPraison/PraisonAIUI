"""Example 20: Email Channel — Integrate email into the AIUI dashboard.

Unique Concept: Email as a dashboard channel — managed via the Channels API.

This example shows how email integrates with PraisonAIUI as a channel,
appearing alongside Telegram/Discord/Slack in the dashboard. The email
channel is managed through the same /api/channels endpoints.

Features:
    • Register email as a channel via /api/channels API
    • Dashboard visibility alongside other messaging platforms
    • Gateway-managed lifecycle (start/stop/restart)
    • Approval integration for draft-before-send workflow
    • Full feature dashboard with email channel status

Architecture:
    ┌──────────────────────────────────────────────────────────┐
    │               AIUIGateway (port 8084)                    │
    │                                                          │
    │  ┌────────────┐  ┌──────────────────┐  ┌─────────────┐  │
    │  │  Dashboard  │  │  Channel APIs    │  │  Email Bot   │  │
    │  │  + Email    │  │  /api/channels   │  │  IMAP/SMTP   │  │
    │  │  Status     │  │  CRUD + Toggle   │  │  polling     │  │
    │  └────────────┘  └──────────────────┘  └─────────────┘  │
    └──────────────────────────────────────────────────────────┘

Requires:
    pip install praisonaiui praisonai[email] praisonaiagents
    export OPENAI_API_KEY=sk-...
    export EMAIL_ADDRESS=support@example.com
    export EMAIL_APP_PASSWORD=your_app_password

Run:
    python app.py
    # Dashboard at http://localhost:8084
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


# ── Seed email channel via API ──────────────────────────────────────

def seed_email_channel():
    """Register an email channel in the dashboard.
    
    This demonstrates how to programmatically add an email channel
    to the AIUI dashboard, which is the same as using the dashboard UI
    or calling POST /api/channels directly.
    """
    from starlette.testclient import TestClient

    app = create_app()
    client = TestClient(app)

    # Check if email channel already exists
    r = client.get("/api/channels")
    channels = r.json().get("channels", [])
    email_exists = any(
        ch.get("platform") == "email"
        for ch in channels
    )

    if not email_exists:
        # Register email as a channel
        r = client.post("/api/channels", json={
            "name": "Support Email",
            "platform": "email",
            "config": {
                "email_address": os.getenv("EMAIL_ADDRESS", "support@example.com"),
                "imap_server": os.getenv("EMAIL_IMAP_SERVER", "imap.gmail.com"),
                "smtp_server": os.getenv("EMAIL_SMTP_SERVER", "smtp.gmail.com"),
                "app_password_ref": "env:EMAIL_APP_PASSWORD",
                "polling_interval": 30,
            },
        })
        if r.status_code in (200, 201):
            channel_id = r.json().get("id", "unknown")
            print(f"   ✅ Email channel registered: {channel_id}")
        else:
            print(f"   ⚠️  Channel registration: {r.status_code} — {r.json()}")
    else:
        print("   ✓ Email channel already exists")

    # Also seed other channels for comparison in dashboard
    for name, platform in [("Discord #general", "discord"), ("Telegram Support", "telegram")]:
        existing = any(ch.get("platform") == platform for ch in channels)
        if not existing:
            client.post("/api/channels", json={
                "name": name,
                "platform": platform,
                "config": {},
            })
            print(f"   ✓ Seeded {platform} channel")


# ── Verify email platform support ──────────────────────────────────

def verify_email_support():
    """Check if 'email' is in the supported platforms list."""
    from starlette.testclient import TestClient

    app = create_app()
    client = TestClient(app)

    r = client.get("/api/channels/platforms")
    if r.status_code == 200:
        platforms = r.json().get("platforms", [])
        email_supported = "email" in platforms
        print(f"   Supported platforms: {platforms}")
        print(f"   Email supported: {'✅ Yes' if email_supported else '❌ No — add email to SUPPORTED_PLATFORMS'}")
        return email_supported
    return False


# ── Test channel lifecycle ──────────────────────────────────────────

def test_channel_api():
    """Test the full channel lifecycle for email."""
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
        icon = "📧" if ch.get("platform") == "email" else "💬"
        print(f"      {icon} {ch.get('name', '?')} ({ch.get('platform', '?')})")

    # Get email channel status
    email_ch = next((ch for ch in channels if ch.get("platform") == "email"), None)
    if email_ch:
        ch_id = email_ch.get("id")
        r = client.get(f"/api/channels/{ch_id}/status")
        print(f"   GET /api/channels/{ch_id}/status: {r.json()}")

    print()


# ── Main ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("📧 PraisonAIUI — Email Channel Integration")
    print("=" * 50)
    print()

    if "--test" in sys.argv:
        # Test mode: verify APIs + seed data
        print("🔍 Verifying email platform support...")
        verify_email_support()
        print()
        print("🌱 Seeding email channel...")
        seed_email_channel()
        test_channel_api()
    else:
        # Run the dashboard
        print("🌱 Seeding channels...")
        seed_email_channel()
        print()

        app = create_app()
        print(f"✅ Dashboard at http://localhost:8084")
        print(f"   Channels: http://localhost:8084/api/channels")
        print(f"   Platforms: http://localhost:8084/api/channels/platforms")
        host = os.getenv("HOST", "127.0.0.1")
        uvicorn.run(app, host=host, port=8084, log_level="info")
