"""Per-feature test: Surfaces (A2UI canvas) — API + CLI parity."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from starlette.testclient import TestClient

from praisonaiui.features.surfaces import SurfaceStore, set_surface_store
from praisonaiui.server import create_app

store = SurfaceStore()
set_surface_store(store)
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
        failed += 1
        errors.append(f"  ✗ {name}: {e}")
        print(f"  ✗ {name}: {e}")


print("\n── Surfaces: API Tests ──")

check("GET /api/surfaces (empty)", client.get("/api/surfaces"), 200, ["surfaces"])
assert client.get("/api/surfaces").json()["surfaces"] == []

check("GET /api/surfaces/main (missing → empty)", client.get("/api/surfaces/main"), 200, ["id", "messages"])
empty = client.get("/api/surfaces/main").json()
assert empty["messages"] == []
assert empty["id"] == "main"

msg = {
    "messages": [
        {
            "version": "v0.9",
            "updateComponents": {
                "components": [
                    {"component": "Button", "text": {"literal": "Submit"}},
                ]
            },
        }
    ]
}
check("POST /api/surfaces/main/messages", client.post("/api/surfaces/main/messages", json=msg), 200, ["id"])
assert client.post("/api/surfaces/main/messages", json=msg).json()["message_count"] >= 1

check("GET /api/surfaces/main (after push)", client.get("/api/surfaces/main"), 200, ["messages"])
assert len(client.get("/api/surfaces/main").json()["messages"]) >= 1

check("GET /api/surfaces (listed)", client.get("/api/surfaces"), 200)
assert len(client.get("/api/surfaces").json()["surfaces"]) >= 1

check(
    "POST /api/surfaces/main/action",
    client.post(
        "/api/surfaces/main/action",
        json={"action": "click", "component_id": "btn1", "data": {}},
    ),
    200,
    ["status"],
)

check("DELETE /api/surfaces/main", client.delete("/api/surfaces/main"), 200, ["status"])
check("DELETE missing → 404", client.delete("/api/surfaces/nope"), 404)

check("GET /api/surfaces/main (after delete → empty)", client.get("/api/surfaces/main"), 200)
assert client.get("/api/surfaces/main").json()["messages"] == []

print("\n── Surfaces: CLI Parity ──")
from typer.testing import CliRunner

from praisonaiui.cli import app as cli_app

runner = CliRunner()

result = runner.invoke(cli_app, ["surface", "--help"])
check(
    "CLI surface --help",
    type(
        "R",
        (),
        {"status_code": 200 if result.exit_code == 0 else 500, "json": lambda: {}, "text": result.output},
    )(),
    200,
)
for cmd in ("list", "get", "push", "clear", "status"):
    assert cmd in result.output, f"Missing subcommand '{cmd}' in help"

print(f"\n{'=' * 50}")
print(f"  Surfaces: {passed} passed, {failed} failed")
print(f"{'=' * 50}")
if errors:
    for e in errors:
        print(e)
    sys.exit(1)
