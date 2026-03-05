"""Per-feature test: Approvals — API + CLI parity."""
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

print("\n── Approvals: API Tests ──")

# Empty list
check("GET /api/approvals (empty)", client.get("/api/approvals"), 200, ["approvals", "count"])
assert client.get("/api/approvals").json()["count"] == 0

# Create
r = client.post("/api/approvals", json={
    "tool_name": "run_code", "arguments": {"code": "1+1"},
    "risk_level": "low", "agent_name": "MathBot",
})
check("POST create", r, 201, ["id", "status", "tool_name"])
aid = r.json()["id"]
assert r.json()["status"] == "pending"

# Get by ID
check("GET /:id", client.get(f"/api/approvals/{aid}"), 200, ["id", "tool_name"])

# Filter pending
r = client.get("/api/approvals?status=pending")
check("GET ?status=pending", r, 200, ["approvals"])
assert r.json()["count"] == 1

# Resolve — approve
r = client.post(f"/api/approvals/{aid}/resolve", json={"approved": True, "reason": "safe"})
check("POST resolve (approve)", r, 200, ["status", "resolved_at"])
assert r.json()["status"] == "approved"

# Verify resolved
r = client.get("/api/approvals?status=resolved")
check("GET ?status=resolved", r, 200)
assert r.json()["count"] == 1

# Pending should now be 0
r = client.get("/api/approvals?status=pending")
check("GET ?status=pending (empty after resolve)", r, 200)
assert r.json()["count"] == 0

# Create + deny
r2 = client.post("/api/approvals", json={"tool_name": "delete_file", "risk_level": "high"})
aid2 = r2.json()["id"]
r = client.post(f"/api/approvals/{aid2}/resolve", json={"approved": False, "reason": "too risky"})
check("POST resolve (deny)", r, 200)
assert r.json()["status"] == "denied"

# 404 on nonexistent
check("POST resolve nonexistent → 404", client.post("/api/approvals/xxx/resolve", json={"approved": True}), 404)
check("GET nonexistent → 404", client.get("/api/approvals/nope"), 404)

# All filter
r = client.get("/api/approvals?status=all")
check("GET ?status=all", r, 200)
assert r.json()["count"] == 2

# Config endpoint
check("GET /api/approvals/config", client.get("/api/approvals/config"), 200)

print("\n── Approvals: CLI Parity ──")
from typer.testing import CliRunner
from praisonaiui.cli import app as cli_app

runner = CliRunner()

# CLI list (against running server — will fail since no server, but verify Typer registration)
result = runner.invoke(cli_app, ["approval", "--help"])
check("CLI approval --help", type("R", (), {"status_code": 200 if result.exit_code == 0 else 500, "json": lambda: {}, "text": result.output})(), 200)
assert "list" in result.output
assert "pending" in result.output
assert "resolve" in result.output

print(f"\n{'='*50}")
print(f"  Approvals: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
