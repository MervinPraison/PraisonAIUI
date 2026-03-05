"""Per-feature test: Workflows — API + CLI parity."""
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

print("\n── Workflows: API Tests ──")

# Empty
check("GET /api/workflows (empty)", client.get("/api/workflows"), 200, ["workflows", "count"])
check("GET /api/workflows/runs (empty)", client.get("/api/workflows/runs"), 200, ["runs", "count"])

# Create pipeline
r = client.post("/api/workflows", json={
    "name": "ci-pipeline", "description": "Build, test, deploy",
    "pattern": "pipeline", "steps": ["lint", "test", "build", "deploy"],
})
check("POST create (pipeline)", r, 201, ["id", "name", "pattern", "steps"])
wf1 = r.json()["id"]
assert r.json()["pattern"] == "pipeline"

# Create parallel
r = client.post("/api/workflows", json={
    "name": "data-ingest", "description": "Parallel data loading",
    "pattern": "parallel", "steps": ["csv_load", "json_load", "api_load"],
})
check("POST create (parallel)", r, 201)
wf2 = r.json()["id"]

# List (2)
r = client.get("/api/workflows")
check("GET list (2)", r, 200)
assert r.json()["count"] == 2

# Get by ID
check("GET /:id", client.get(f"/api/workflows/{wf1}"), 200, ["name", "steps", "pattern"])

# Run workflow
r = client.post(f"/api/workflows/{wf1}/run", json={"input": {"env": "staging", "branch": "main"}})
check("POST run", r, 200, ["id", "status", "output", "workflow_id"])
run1 = r.json()["id"]
assert r.json()["status"] == "completed"
assert r.json()["workflow_id"] == wf1

# Run again
r = client.post(f"/api/workflows/{wf1}/run", json={"input": {"env": "prod"}})
check("POST run (2nd)", r, 200)
run2 = r.json()["id"]

# Run workflow 2
r = client.post(f"/api/workflows/{wf2}/run", json={})
check("POST run (parallel wf)", r, 200)
run3 = r.json()["id"]

# Status
r = client.get(f"/api/workflows/{wf1}/status")
check("GET /:id/status", r, 200, ["workflow_id", "total_runs", "last_run"])
assert r.json()["total_runs"] == 2

# All runs
r = client.get("/api/workflows/runs")
check("GET /runs (3 total)", r, 200)
assert r.json()["count"] == 3

# Get specific run
check("GET /runs/:id", client.get(f"/api/workflows/runs/{run1}"), 200, ["id", "status", "workflow_id"])

# Run nonexistent → 404
check("POST run nonexistent → 404", client.post("/api/workflows/xxx/run", json={}), 404)

# Delete
check("DELETE /:id", client.delete(f"/api/workflows/{wf1}"), 200, ["deleted"])
r = client.get("/api/workflows")
assert r.json()["count"] == 1

# 404
check("GET deleted → 404", client.get(f"/api/workflows/{wf1}"), 404)
check("DELETE nonexistent → 404", client.delete("/api/workflows/xxx"), 404)

# Run nonexistent (after a run already exists in history)
r = client.get(f"/api/workflows/runs/{run1}")
check("GET run from deleted workflow still in history", r, 200)

# Cleanup
client.delete(f"/api/workflows/{wf2}")

print("\n── Workflows: CLI Parity ──")
from typer.testing import CliRunner
from praisonaiui.cli import app as cli_app
runner = CliRunner()

result = runner.invoke(cli_app, ["workflows", "--help"])
check("CLI workflows --help", type("R", (), {"status_code": 200 if result.exit_code == 0 else 500, "json": lambda: {}, "text": result.output})(), 200)
assert "list" in result.output
assert "run" in result.output
assert "status" in result.output
assert "runs" in result.output

print(f"\n{'='*50}")
print(f"  Workflows: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
