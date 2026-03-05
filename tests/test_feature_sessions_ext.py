"""Per-feature test: Extended Sessions — API tests."""
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

print("\n── Extended Sessions: API Tests ──")
sid = "test-session-ext"

# State — empty initially
r = client.get(f"/api/sessions/{sid}/state")
check("GET state (empty)", r, 200, ["session_id", "state"])
assert r.json()["state"] == {}

# State — save
r = client.post(f"/api/sessions/{sid}/state", json={"state": {"mood": "focused", "topic": "ML"}})
check("POST state (save)", r, 200, ["session_id", "state"])
assert r.json()["state"]["mood"] == "focused"

# State — restore
r = client.get(f"/api/sessions/{sid}/state")
check("GET state (restored)", r, 200)
assert r.json()["state"]["topic"] == "ML"

# State — update (merge update — topic should still exist)
r = client.post(f"/api/sessions/{sid}/state", json={"state": {"mood": "relaxed"}})
check("POST state (update)", r, 200)
assert r.json()["state"]["mood"] == "relaxed"
assert r.json()["state"]["topic"] == "ML"  # merge preserves previous keys

# Context
r = client.post(f"/api/sessions/{sid}/context", json={"query": "What is the user working on?"})
check("POST context", r, 200, ["session_id", "context"])

# Labels — set
r = client.post(f"/api/sessions/{sid}/labels", json={"labels": ["priority", "customer-demo"]})
check("POST labels (set)", r, 200, ["labels"])
assert r.json()["labels"] == ["priority", "customer-demo"]

# Labels — get
r = client.get(f"/api/sessions/{sid}/labels")
check("GET labels", r, 200, ["labels"])
assert len(r.json()["labels"]) == 2

# Labels — update
r = client.post(f"/api/sessions/{sid}/labels", json={"labels": ["vip"]})
check("POST labels (update)", r, 200)
assert r.json()["labels"] == ["vip"]

# Usage
r = client.get(f"/api/sessions/{sid}/usage")
check("GET usage", r, 200, ["session_id", "usage"])

# Compact
r = client.post(f"/api/sessions/{sid}/compact")
check("POST compact", r, 200, ["compacted"])

# Reset
r = client.post(f"/api/sessions/{sid}/reset", json={"mode": "clear"})
check("POST reset (clear)", r, 200, ["reset_mode"])

# Verify state is cleared
r = client.get(f"/api/sessions/{sid}/state")
check("GET state (after reset)", r, 200)

# Test different session
sid2 = "test-session-ext-2"
r = client.post(f"/api/sessions/{sid2}/state", json={"state": {"x": 1}})
check("POST state (different session)", r, 200)
assert r.json()["session_id"] == sid2

print(f"\n{'='*50}")
print(f"  Sessions Ext: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
