"""Per-feature test: Hooks — API + CLI parity."""
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

print("\n── Hooks: API Tests ──")

# Empty
check("GET /api/hooks (empty)", client.get("/api/hooks"), 200, ["hooks", "count"])
check("GET /api/hooks/log (empty)", client.get("/api/hooks/log"), 200, ["log", "count"])

# Register pre-hook
r = client.post("/api/hooks", json={"name": "audit_tool", "event": "tool_call", "type": "pre"})
check("POST register (pre)", r, 201, ["id", "name", "event", "type"])
h1 = r.json()["id"]

# Register post-hook
r = client.post("/api/hooks", json={"name": "log_response", "event": "agent_response", "type": "post"})
check("POST register (post)", r, 201)
h2 = r.json()["id"]

# List
r = client.get("/api/hooks")
check("GET list (2 hooks)", r, 200)
assert r.json()["count"] == 2

# Get by ID
check("GET /:id", client.get(f"/api/hooks/{h1}"), 200, ["name", "event", "type"])

# Trigger
r = client.post(f"/api/hooks/{h1}/trigger", json={"data": {"tool": "code_exec", "args": {"x": 1}}})
check("POST trigger", r, 200, ["hook_id", "result"])

# Trigger second hook
r = client.post(f"/api/hooks/{h2}/trigger", json={"data": {"response": "done"}})
check("POST trigger (2nd)", r, 200)

# Log should have 2 entries
r = client.get("/api/hooks/log")
check("GET log (2 entries)", r, 200, ["log", "count"])
assert r.json()["count"] == 2

# Log with limit
r = client.get("/api/hooks/log?limit=1")
check("GET log (limit=1)", r, 200)
assert len(r.json()["log"]) == 1

# Trigger nonexistent → 404
check("POST trigger nonexistent → 404", client.post("/api/hooks/xxx/trigger", json={}), 404)

# Delete
check("DELETE /:id", client.delete(f"/api/hooks/{h1}"), 200, ["deleted"])
r = client.get("/api/hooks")
assert r.json()["count"] == 1

# 404
check("GET deleted → 404", client.get(f"/api/hooks/{h1}"), 404)
check("DELETE nonexistent → 404", client.delete("/api/hooks/xxx"), 404)

# Cleanup
client.delete(f"/api/hooks/{h2}")

print("\n── Hooks: CLI Parity ──")
from typer.testing import CliRunner
from praisonaiui.cli import app as cli_app
runner = CliRunner()

result = runner.invoke(cli_app, ["hooks", "--help"])
check("CLI hooks --help", type("R", (), {"status_code": 200 if result.exit_code == 0 else 500, "json": lambda: {}, "text": result.output})(), 200)
assert "list" in result.output
assert "trigger" in result.output
assert "log" in result.output

print(f"\n{'='*50}")
print(f"  Hooks: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
