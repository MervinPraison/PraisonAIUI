"""Per-feature test: Schedules — API + CLI parity."""
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

print("\n── Schedules: API Tests ──")

# Empty
check("GET /api/schedules (empty)", client.get("/api/schedules"), 200, ["schedules", "count"])

# Create interval job
r = client.post("/api/schedules", json={
    "name": "daily-report", "message": "Generate report",
    "schedule": {"kind": "every", "every_seconds": 86400},
})
check("POST create (interval)", r, 201, ["id", "name", "schedule", "enabled"])
jid = r.json()["id"]
assert r.json()["enabled"] == True

# Create cron job
r2 = client.post("/api/schedules", json={
    "name": "midnight-cleanup", "message": "Clean temp files",
    "schedule": {"kind": "cron", "cron_expression": "0 0 * * *"},
})
check("POST create (cron)", r2, 201)
jid2 = r2.json()["id"]

# List (should have 2)
r = client.get("/api/schedules")
check("GET list (2 jobs)", r, 200)
assert r.json()["count"] == 2

# Get by ID
check("GET /:id", client.get(f"/api/schedules/{jid}"), 200, ["id", "schedule"])

# Toggle off
r = client.post(f"/api/schedules/{jid}/toggle")
check("POST toggle (disable)", r, 200, ["id", "enabled"])
assert r.json()["enabled"] == False

# Toggle back on
r = client.post(f"/api/schedules/{jid}/toggle")
check("POST toggle (enable)", r, 200)
assert r.json()["enabled"] == True

# Run immediately
r = client.post(f"/api/schedules/{jid}/run")
check("POST run", r, 200, ["triggered", "last_run_at"])

# Delete
check("DELETE /:id", client.delete(f"/api/schedules/{jid}"), 200, ["deleted"])
check("DELETE second", client.delete(f"/api/schedules/{jid2}"), 200)

# 404
check("DELETE nonexistent → 404", client.delete("/api/schedules/xxx"), 404)
check("GET nonexistent → 404", client.get("/api/schedules/xxx"), 404)

print("\n── Schedules: CLI Parity ──")
from typer.testing import CliRunner
from praisonaiui.cli import app as cli_app
runner = CliRunner()

result = runner.invoke(cli_app, ["schedule", "--help"])
check("CLI schedule --help", type("R", (), {"status_code": 200 if result.exit_code == 0 else 500, "json": lambda: {}, "text": result.output})(), 200)
assert "list" in result.output
assert "add" in result.output
assert "remove" in result.output
assert "status" in result.output

print(f"\n{'='*50}")
print(f"  Schedules: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
