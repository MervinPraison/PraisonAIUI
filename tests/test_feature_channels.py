"""Per-feature test: Channels — API + gateway integration + CLI parity."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from starlette.testclient import TestClient
from praisonaiui.server import create_app

client = TestClient(create_app())
passed = failed = 0
errors = []

def check(name, r, status=200, keys=None):
    global passed, failed
    try:
        assert r.status_code == status, f"Expected {status}, got {r.status_code}: {r.text[:200]}"
        if keys:
            data = r.json()
            for k in keys:
                assert k in data, f"Missing '{k}' in {list(data.keys())}"
        passed += 1
        print(f"  ✓ {name}")
    except AssertionError as e:
        failed += 1; errors.append(f"  ✗ {name}: {e}"); print(f"  ✗ {name}: {e}")


# ── CRUD Tests ────────────────────────────────────────────────────────

print("\n── Channels: API CRUD Tests ──")

# Empty list
check("GET /api/channels (empty)", client.get("/api/channels"), 200, ["channels", "count"])
r = client.get("/api/channels")
assert r.json()["count"] == 0, f"Expected 0 channels, got {r.json()['count']}"

# Create
r = client.post("/api/channels", json={
    "name": "Test Discord", "platform": "discord",
    "config": {"guild_id": "123", "channel_id": "456"},
})
check("POST /api/channels (create discord)", r, 201, ["id", "name", "platform", "enabled"])
ch_id = r.json()["id"]
assert r.json()["platform"] == "discord"
assert r.json()["enabled"] == True

# Create second
r2 = client.post("/api/channels", json={
    "name": "Test Telegram", "platform": "telegram",
    "config": {"bot_token": "test-token"},
})
check("POST /api/channels (create telegram)", r2, 201)
ch_id2 = r2.json()["id"]

# List (should have 2)
r = client.get("/api/channels")
check("GET /api/channels (list 2)", r, 200)
assert r.json()["count"] == 2, f"Expected 2, got {r.json()['count']}"

# Get by ID
check("GET /api/channels/:id", client.get(f"/api/channels/{ch_id}"), 200, ["id", "platform"])

# Update
r = client.put(f"/api/channels/{ch_id}", json={"name": "Updated Discord"})
check("PUT /api/channels/:id (update)", r, 200)
assert r.json()["name"] == "Updated Discord"

# Delete
check("DELETE /api/channels/:id", client.delete(f"/api/channels/{ch_id}"), 200, ["deleted"])

# 404s
check("GET missing → 404", client.get("/api/channels/nonexistent"), 404)
check("PUT missing → 404", client.put("/api/channels/nonexistent", json={"name": "x"}), 404)
check("DELETE missing → 404", client.delete("/api/channels/nonexistent"), 404)

# ── Toggle Test ───────────────────────────────────────────────────────

print("\n── Channels: Toggle Tests ──")

r = client.post(f"/api/channels/{ch_id2}/toggle")
check("POST toggle (disable)", r, 200, ["id", "enabled"])
assert r.json()["enabled"] == False

r = client.post(f"/api/channels/{ch_id2}/toggle")
check("POST toggle (enable)", r, 200)
assert r.json()["enabled"] == True

check("POST toggle missing → 404", client.post("/api/channels/xxx/toggle"), 404)

# ── Status Test ───────────────────────────────────────────────────────

print("\n── Channels: Status Tests ──")

r = client.get(f"/api/channels/{ch_id2}/status")
check("GET /api/channels/:id/status", r, 200, ["id", "platform", "enabled", "running"])

check("GET status missing → 404", client.get("/api/channels/nonexistent/status"), 404)

# ── Platforms Test ────────────────────────────────────────────────────

print("\n── Channels: Platforms ──")

r = client.get("/api/channels/platforms")
check("GET /api/channels/platforms", r, 200, ["platforms"])
platforms = r.json()["platforms"]
assert "discord" in platforms
assert "telegram" in platforms
assert "slack" in platforms
assert "whatsapp" in platforms

# ── Platform validation ──────────────────────────────────────────────

print("\n── Channels: Platform Validation ──")

r = client.post("/api/channels", json={"name": "Bad", "platform": "fakechat"})
check("POST invalid platform → 400", r, 400)

# ── Gateway Integration Tests ─────────────────────────────────────────

print("\n── Channels: Gateway Integration ──")

# Test _get_gateway_health returns None when no gateway is set
from praisonaiui.features.channels import PraisonAIChannels
ch_feature = PraisonAIChannels()
gw_health = ch_feature._get_gateway_health()
try:
    assert gw_health is None, f"Expected None when no gateway, got {gw_health}"
    passed += 1
    print("  ✓ _get_gateway_health() returns None without gateway")
except AssertionError as e:
    failed += 1; errors.append(f"  ✗ _get_gateway_health: {e}"); print(f"  ✗ _get_gateway_health: {e}")

# Test with mock gateway set via _gateway_ref
from praisonaiui.features import _gateway_ref

class MockGateway:
    def health(self):
        return {
            "status": "healthy",
            "channels": {
                "mock-ch": {"platform": "discord", "running": True},
            },
        }

_gateway_ref.set_gateway(MockGateway())
gw_health = ch_feature._get_gateway_health()
try:
    assert gw_health is not None, "Expected gateway health data"
    assert "mock-ch" in gw_health, f"Expected 'mock-ch' in {gw_health}"
    assert gw_health["mock-ch"]["running"] == True
    passed += 1
    print("  ✓ _get_gateway_health() returns data with mock gateway")
except AssertionError as e:
    failed += 1; errors.append(f"  ✗ _get_gateway_health mock: {e}"); print(f"  ✗ _get_gateway_health mock: {e}")

# Reset
_gateway_ref.set_gateway(None)

# ── Cleanup ───────────────────────────────────────────────────────────

# Clean up remaining channel
client.delete(f"/api/channels/{ch_id2}")

# ── Summary ───────────────────────────────────────────────────────────

print(f"\n{'='*50}")
print(f"  Channels: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
