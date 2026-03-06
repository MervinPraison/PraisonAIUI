"""Per-feature test: Nodes & Instances — API + gateway integration."""
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


# ── Node CRUD Tests ──────────────────────────────────────────────────

print("\n── Nodes: CRUD Tests ──")

# Empty list
check("GET /api/nodes (empty)", client.get("/api/nodes"), 200, ["nodes", "count"])
r = client.get("/api/nodes")
assert r.json()["count"] == 0

# Register node
r = client.post("/api/nodes", json={
    "name": "local-dev", "host": "localhost",
    "platform": "macos", "agents": ["summarizer"],
})
check("POST /api/nodes (register)", r, 201, ["id", "name", "host", "platform"])
nid = r.json()["id"]
assert r.json()["status"] == "online"

# Register second
r2 = client.post("/api/nodes", json={
    "name": "gpu-server", "host": "gpu.internal",
    "platform": "linux", "agents": ["trainer"],
})
check("POST /api/nodes (register 2nd)", r2, 201)
nid2 = r2.json()["id"]

# List (should have 2)
r = client.get("/api/nodes")
check("GET /api/nodes (list 2)", r, 200)
assert r.json()["count"] == 2

# Get by ID
check("GET /api/nodes/:id", client.get(f"/api/nodes/{nid}"), 200, ["id", "name", "host"])

# Update
r = client.put(f"/api/nodes/{nid}", json={"name": "updated-dev"})
check("PUT /api/nodes/:id", r, 200)
assert r.json()["name"] == "updated-dev"

# Delete
check("DELETE /api/nodes/:id", client.delete(f"/api/nodes/{nid}"), 200, ["deleted"])

# 404s
check("GET missing → 404", client.get("/api/nodes/nonexistent"), 404)
check("PUT missing → 404", client.put("/api/nodes/nonexistent", json={"name": "x"}), 404)
check("DELETE missing → 404", client.delete("/api/nodes/nonexistent"), 404)


# ── Node Status ──────────────────────────────────────────────────────

print("\n── Nodes: Status Tests ──")

r = client.get(f"/api/nodes/{nid2}/status")
check("GET /api/nodes/:id/status", r, 200, ["id", "status"])

check("GET status missing → 404", client.get("/api/nodes/nonexistent/status"), 404)


# ── Agent Bindings ───────────────────────────────────────────────────

print("\n── Nodes: Agent Bindings ──")

r = client.get(f"/api/nodes/{nid2}/agents")
check("GET /api/nodes/:id/agents", r, 200, ["node_id", "agents"])
assert "trainer" in r.json()["agents"]

r = client.put(f"/api/nodes/{nid2}/agents", json={"agents": ["trainer", "analyzer"]})
check("PUT /api/nodes/:id/agents (update)", r, 200)
assert "analyzer" in r.json()["agents"]


# ── Instances / Presence ─────────────────────────────────────────────

print("\n── Instances: Heartbeat & List ──")

# Empty list
check("GET /api/instances (empty)", client.get("/api/instances"), 200, ["instances", "count"])

# Heartbeat
r = client.post("/api/instances/heartbeat", json={
    "id": "client-web-1", "host": "browser",
    "platform": "web", "version": "0.1.0",
    "roles": ["chat"], "mode": "client",
})
check("POST heartbeat", r, 200, ["status", "instance_id"])
assert r.json()["instance_id"] == "client-web-1"

# Second heartbeat
r = client.post("/api/instances/heartbeat", json={
    "id": "worker-gpu-1", "host": "gpu.internal",
    "platform": "linux", "version": "0.1.0",
    "roles": ["inference"], "mode": "worker",
})
check("POST heartbeat (2nd)", r, 200)

# List instances
r = client.get("/api/instances")
check("GET /api/instances (list 2)", r, 200)
assert r.json()["count"] == 2

# Verify instance data
instances = r.json()["instances"]
ids = [i["id"] for i in instances]
assert "client-web-1" in ids, f"Expected client-web-1, got {ids}"
assert "worker-gpu-1" in ids


# ── Gateway Enrichment Test ──────────────────────────────────────────

print("\n── Nodes: Gateway Enrichment ──")

from praisonaiui.features import _gateway_ref

class MockGateway:
    def health(self):
        return {
            "status": "healthy",
            "agents": 3,
            "sessions": 5,
            "clients": 2,
        }

_gateway_ref.set_gateway(MockGateway())

# Node status should include gateway info when available
r = client.get(f"/api/nodes/{nid2}/status")
check("GET status with gateway", r, 200, ["id", "status"])
data = r.json()
try:
    assert "gateway" in data, f"Expected 'gateway' key when gateway set, got {list(data.keys())}"
    assert data["gateway"]["agents"] == 3
    passed += 1
    print("  ✓ Node status enriched with gateway data")
except AssertionError as e:
    failed += 1; errors.append(f"  ✗ Gateway enrichment: {e}"); print(f"  ✗ Gateway enrichment: {e}")

# Reset
_gateway_ref.set_gateway(None)


# ── Cleanup ──────────────────────────────────────────────────────────
client.delete(f"/api/nodes/{nid2}")

# ── Summary ──────────────────────────────────────────────────────────

print(f"\n{'='*50}")
print(f"  Nodes & Instances: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
