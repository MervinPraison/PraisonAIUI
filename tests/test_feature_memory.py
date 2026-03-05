"""Per-feature test: Memory — API + CLI parity."""
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

print("\n── Memory: API Tests ──")

# Empty
check("GET /api/memory (empty)", client.get("/api/memory"), 200, ["memories", "count"])

# Add long-term memory
r = client.post("/api/memory", json={"text": "User prefers dark mode", "memory_type": "long"})
check("POST add (long)", r, 201, ["id", "text", "memory_type"])
m1 = r.json()["id"]

# Add short-term memory
r = client.post("/api/memory", json={"text": "Currently discussing Python", "memory_type": "short"})
check("POST add (short)", r, 201)
m2 = r.json()["id"]

# Add entity memory
r = client.post("/api/memory", json={"text": "John is a software engineer", "memory_type": "entity"})
check("POST add (entity)", r, 201)
m3 = r.json()["id"]

# List all (3)
r = client.get("/api/memory")
check("GET list all", r, 200)
assert r.json()["count"] == 3

# Filter by type
r = client.get("/api/memory?type=long")
check("GET ?type=long", r, 200)
assert r.json()["count"] == 1
assert r.json()["memories"][0]["text"] == "User prefers dark mode"

r = client.get("/api/memory?type=short")
check("GET ?type=short", r, 200)
assert r.json()["count"] == 1

# Get by ID
check("GET /:id", client.get(f"/api/memory/{m1}"), 200, ["id", "text", "memory_type"])

# Search
r = client.post("/api/memory/search", json={"query": "dark mode", "limit": 10})
check("POST search (match)", r, 200, ["results", "count"])
assert r.json()["count"] == 1

r = client.post("/api/memory/search", json={"query": "nonexistent thing"})
check("POST search (no match)", r, 200)
assert r.json()["count"] == 0

# Search with type filter
r = client.post("/api/memory/search", json={"query": "Python", "memory_type": "short"})
check("POST search (type filter)", r, 200)
assert r.json()["count"] == 1

# Delete single
check("DELETE /:id", client.delete(f"/api/memory/{m1}"), 200, ["deleted"])
r = client.get("/api/memory")
assert r.json()["count"] == 2

# 404
check("GET deleted → 404", client.get(f"/api/memory/{m1}"), 404)
check("DELETE nonexistent → 404", client.delete("/api/memory/xxx"), 404)

# Clear all
check("DELETE clear all", client.delete("/api/memory?type=all"), 200, ["cleared"])
r = client.get("/api/memory")
assert r.json()["count"] == 0

print("\n── Memory: CLI Parity ──")
from typer.testing import CliRunner
from praisonaiui.cli import app as cli_app
runner = CliRunner()

result = runner.invoke(cli_app, ["memory", "--help"])
check("CLI memory --help", type("R", (), {"status_code": 200 if result.exit_code == 0 else 500, "json": lambda: {}, "text": result.output})(), 200)
assert "list" in result.output
assert "add" in result.output
assert "search" in result.output
assert "clear" in result.output
assert "status" in result.output

print(f"\n{'='*50}")
print(f"  Memory: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
