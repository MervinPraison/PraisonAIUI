"""Gateway integration tests — verifies _gateway_ref singleton and feature wiring."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

passed = failed = 0
errors = []

def check(name, condition, msg=""):
    global passed, failed
    try:
        assert condition, msg
        passed += 1
        print(f"  ✓ {name}")
    except AssertionError as e:
        failed += 1; errors.append(f"  ✗ {name}: {e}"); print(f"  ✗ {name}: {e}")


# ── Gateway Ref Singleton ────────────────────────────────────────────

print("\n── Gateway Ref Singleton Tests ──")

from praisonaiui.features import _gateway_ref

# Initially None
check("get_gateway() initially None", _gateway_ref.get_gateway() is None)

# Set and get
class MockGW:
    def health(self):
        return {"status": "healthy", "channels": {}}

mock = MockGW()
_gateway_ref.set_gateway(mock)
check("set_gateway() stores reference", _gateway_ref.get_gateway() is mock)

# Clear
_gateway_ref.set_gateway(None)
check("set_gateway(None) clears", _gateway_ref.get_gateway() is None)


# ── Channels Gateway Wiring ──────────────────────────────────────────

print("\n── Channels Gateway Wiring ──")

from praisonaiui.features.channels import PraisonAIChannels

ch = PraisonAIChannels()

# Without gateway
result = ch._get_gateway_health()
check("No gateway → None", result is None)

# With gateway
class MockGWWithChannels:
    def health(self):
        return {
            "status": "healthy",
            "channels": {
                "discord-main": {"platform": "discord", "running": True},
                "telegram-bot": {"platform": "telegram", "running": False},
            },
        }

_gateway_ref.set_gateway(MockGWWithChannels())
result = ch._get_gateway_health()
check("With gateway → channel data", result is not None)
check("Has discord-main", "discord-main" in result if result else False)
check("discord-main running", result.get("discord-main", {}).get("running") == True if result else False)
check("Has telegram-bot", "telegram-bot" in result if result else False)

_gateway_ref.set_gateway(None)


# ── App Creation Smoke Test ──────────────────────────────────────────

print("\n── App Creation Smoke Test ──")

from starlette.testclient import TestClient
from praisonaiui.server import create_app

client = TestClient(create_app())

# All features registered
r = client.get("/api/features")
check("GET /api/features returns features", r.status_code == 200)
features = r.json()["features"]
feature_names = [f["name"] for f in features]
check("channels feature registered", "channels" in feature_names)
check("nodes feature registered", "nodes" in feature_names)

# All pages registered
r = client.get("/api/pages")
check("GET /api/pages returns pages", r.status_code == 200)
pages = r.json()["pages"]
page_ids = [p["id"] for p in pages]
check("channels page exists", "channels" in page_ids)
check("instances page exists", "instances" in page_ids)
check("cron page exists", "cron" in page_ids)
check("skills page exists", "skills" in page_ids)
check("nodes page exists", "nodes" in page_ids)

# Channels API endpoint mapped correctly
channels_page = next(p for p in pages if p["id"] == "channels")
check("channels api_endpoint", channels_page["api_endpoint"] == "/api/channels")

# Cron → schedules alias
cron_page = next(p for p in pages if p["id"] == "cron")
check("cron → /api/schedules alias", cron_page["api_endpoint"] == "/api/schedules")


# ── Summary ──────────────────────────────────────────────────────────

print(f"\n{'='*50}")
print(f"  Gateway Integration: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
