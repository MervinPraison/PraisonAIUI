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

import sys
import os

from praisonaiui.server import create_app
import uvicorn

# Use shared seed data helper
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _shared.seed_data import seed_demo_data

seed_demo_data()

if __name__ == "__main__":
    app = create_app()
    print("✅ Full Dashboard at http://localhost:8082")
    print("   API: http://localhost:8082/api/features")
    uvicorn.run(app, host="0.0.0.0", port=8082, log_level="info")
