"""Per-feature test: Config Runtime — API + CLI parity."""
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

print("\n── Config Runtime: API Tests ──")

# Empty
r = client.get("/api/config/runtime")
check("GET runtime (empty)", r, 200, ["config"])
assert r.json()["config"] == {}

# History empty
r = client.get("/api/config/runtime/history")
check("GET history (empty)", r, 200, ["history", "count"])
assert r.json()["count"] == 0

# PATCH — set multiple keys
r = client.request("PATCH", "/api/config/runtime", json={"model": "gpt-4o", "temperature": "0.7", "max_tokens": "4096"})
check("PATCH set 3 keys", r, 200, ["config", "applied"])
assert r.json()["applied"] == 3
assert r.json()["config"]["model"] == "gpt-4o"

# GET single key
r = client.get("/api/config/runtime/model")
check("GET /model", r, 200, ["key", "value"])
assert r.json()["value"] == "gpt-4o"

r = client.get("/api/config/runtime/temperature")
check("GET /temperature", r, 200)
assert r.json()["value"] == "0.7"

# GET nonexistent
check("GET nonexistent → 404", client.get("/api/config/runtime/nonexistent"), 404)

# PUT single key
r = client.put("/api/config/runtime/temperature", json={"value": "0.9"})
check("PUT /temperature", r, 200, ["key", "value"])
assert r.json()["value"] == "0.9"

# Verify update
r = client.get("/api/config/runtime/temperature")
assert r.json()["value"] == "0.9"

# PATCH — update existing + add new
r = client.request("PATCH", "/api/config/runtime", json={"model": "gpt-4o-mini", "top_p": "0.95"})
check("PATCH update + add", r, 200)
assert r.json()["config"]["model"] == "gpt-4o-mini"
assert r.json()["config"]["top_p"] == "0.95"

# History should have entries
r = client.get("/api/config/runtime/history")
check("GET history (has entries)", r, 200)
assert r.json()["count"] >= 4

# History with limit
r = client.get("/api/config/runtime/history?limit=2")
check("GET history (limit=2)", r, 200)
assert len(r.json()["history"]) == 2

# DELETE key
check("DELETE /model", client.delete("/api/config/runtime/model"), 200, ["deleted"])
check("GET deleted → 404", client.get("/api/config/runtime/model"), 404)

# DELETE nonexistent
check("DELETE nonexistent → 404", client.delete("/api/config/runtime/nonexistent"), 404)

# PUT replace all
r = client.put("/api/config/runtime", json={"single_key": "test_value"})
check("PUT replace all", r, 200, ["config"])
assert r.json()["config"] == {"single_key": "test_value"}

# Verify only one key
r = client.get("/api/config/runtime")
assert len(r.json()["config"]) == 1

# Full GET
r = client.get("/api/config/runtime")
check("GET all config", r, 200, ["config"])

print("\n── Config Runtime: CLI Parity ──")
from typer.testing import CliRunner
from praisonaiui.cli import app as cli_app
runner = CliRunner()

result = runner.invoke(cli_app, ["config", "--help"])
check("CLI config --help", type("R", (), {"status_code": 200 if result.exit_code == 0 else 500, "json": lambda: {}, "text": result.output})(), 200)
assert "get" in result.output
assert "set" in result.output
assert "list" in result.output
assert "history" in result.output

print(f"\n{'='*50}")
print(f"  Config Runtime: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
