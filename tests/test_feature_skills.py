"""Per-feature test: Skills — API + CLI parity."""
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

print("\n── Skills: API Tests ──")

# Empty
check("GET /api/skills (empty)", client.get("/api/skills"), 200, ["skills", "count"])

# Register
r = client.post("/api/skills", json={"name": "web_search", "description": "Search engine", "version": "1.0.0"})
check("POST register", r, 201, ["id", "name", "status", "version"])
s1 = r.json()["id"]
assert r.json()["status"] == "active"

r = client.post("/api/skills", json={"name": "code_exec", "description": "Run Python", "version": "2.0.0"})
check("POST register (2nd)", r, 201)
s2 = r.json()["id"]

# List
r = client.get("/api/skills")
check("GET list (2 skills)", r, 200)
assert r.json()["count"] == 2

# Get by ID
check("GET /:id", client.get(f"/api/skills/{s1}"), 200, ["name", "version"])

# Status
r = client.get(f"/api/skills/{s1}/status")
check("GET /:id/status", r, 200, ["status", "version"])

# Discover
r = client.post("/api/skills/discover", json={})
check("POST discover", r, 200, ["discovered", "count"])

# Delete
check("DELETE /:id", client.delete(f"/api/skills/{s1}"), 200, ["deleted"])
r = client.get("/api/skills")
assert r.json()["count"] == 1

# 404
check("GET deleted → 404", client.get(f"/api/skills/{s1}"), 404)
check("DELETE nonexistent → 404", client.delete("/api/skills/xxx"), 404)

# Cleanup
client.delete(f"/api/skills/{s2}")

print("\n── Skills: CLI Parity ──")
from typer.testing import CliRunner
from praisonaiui.cli import app as cli_app
runner = CliRunner()

result = runner.invoke(cli_app, ["skills", "--help"])
check("CLI skills --help", type("R", (), {"status_code": 200 if result.exit_code == 0 else 500, "json": lambda: {}, "text": result.output})(), 200)
assert "list" in result.output
assert "status" in result.output
assert "discover" in result.output

print(f"\n{'='*50}")
print(f"  Skills: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
