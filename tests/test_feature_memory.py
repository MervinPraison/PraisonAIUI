"""Per-feature test: Memory — Protocol compliance + API + CLI parity."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from starlette.testclient import TestClient

# Reset memory manager before creating app to ensure clean state
from praisonaiui.features import memory as memory_mod
memory_mod._memory_manager = None

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


# ── Protocol Compliance Tests ────────────────────────────────────────
print("\n── Memory: Protocol Tests ──")

from praisonaiui.features.memory import (
    MemoryProtocol, SimpleMemoryManager, SDKMemoryManager,
    get_memory_manager, set_memory_manager, PraisonAIMemory,
)
from abc import ABC

# MemoryProtocol is ABC
assert issubclass(MemoryProtocol, ABC), "MemoryProtocol must be ABC"
print("  ✓ MemoryProtocol is ABC")
passed += 1

# SimpleMemoryManager implements MemoryProtocol
mgr = SimpleMemoryManager()
assert isinstance(mgr, MemoryProtocol), "SimpleMemoryManager must implement MemoryProtocol"
print("  ✓ SimpleMemoryManager implements MemoryProtocol")
passed += 1

# SDKMemoryManager implements MemoryProtocol
sdk_mgr = SDKMemoryManager()
assert isinstance(sdk_mgr, MemoryProtocol), "SDKMemoryManager must implement MemoryProtocol"
print("  ✓ SDKMemoryManager implements MemoryProtocol")
passed += 1

# Test protocol methods exist
for method in ["store", "search", "list_all", "get", "delete", "clear", "get_context", "health"]:
    assert hasattr(mgr, method), f"Missing method: {method}"
print("  ✓ All protocol methods present")
passed += 1

# Test set/get manager swapping
original = get_memory_manager()
custom = SimpleMemoryManager()
set_memory_manager(custom)
assert get_memory_manager() is custom, "set_memory_manager must swap backend"
set_memory_manager(original)  # restore
print("  ✓ Manager swapping works")
passed += 1

# Test SimpleMemoryManager CRUD
mgr2 = SimpleMemoryManager()
entry = mgr2.store("test text", memory_type="long")
assert entry["text"] == "test text"
assert entry["memory_type"] == "long"
assert "id" in entry
assert mgr2.get(entry["id"]) is not None
results = mgr2.search("test")
assert len(results) == 1
assert mgr2.list_all() == [entry]
assert mgr2.delete(entry["id"]) is True
assert mgr2.get(entry["id"]) is None
print("  ✓ SimpleMemoryManager CRUD works")
passed += 1

# Test get_context
mgr3 = SimpleMemoryManager()
mgr3.store("user likes dark mode")
mgr3.store("user prefers python")
ctx = mgr3.get_context("dark")
assert "dark mode" in ctx
assert "Relevant memories" in ctx
print("  ✓ get_context returns formatted text")
passed += 1

# Test health
h = mgr3.health()
assert h["status"] == "ok"
assert h["provider"] == "SimpleMemoryManager"
assert h["total_memories"] == 2
print("  ✓ SimpleMemoryManager health works")
passed += 1

# SDKMemoryManager graceful degradation (praisonaiagents not in test env)
sdk_h = sdk_mgr.health()
assert sdk_h["provider"] == "SDKMemoryManager"
# It should be "degraded" since praisonaiagents likely not installed in test env
print(f"  ✓ SDKMemoryManager health: {sdk_h['status']}")
passed += 1

# SDKMemoryManager falls back to local index
sdk_entry = sdk_mgr.store("sdk test memory")
assert sdk_entry["text"] == "sdk test memory"
sdk_results = sdk_mgr.search("sdk test")
assert len(sdk_results) >= 1
print("  ✓ SDKMemoryManager local fallback works")
passed += 1


# ── API Tests ────────────────────────────────────────────────────────
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

# Context endpoint (NEW)
r = client.post("/api/memory/context", json={"query": "dark mode"})
check("POST /api/memory/context", r, 200, ["context"])
assert "dark mode" in r.json()["context"]

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


# ── CLI Parity ───────────────────────────────────────────────────────
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
assert "context" in result.output  # NEW command

print(f"\n{'='*50}")
print(f"  Memory: {passed} passed, {failed} failed")
print(f"{'='*50}")
if errors:
    for e in errors: print(e)
    sys.exit(1)
