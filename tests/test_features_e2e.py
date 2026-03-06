"""End-to-end test for all 10 feature modules.

Tests every API endpoint for each feature through the Starlette TestClient.
"""

import json
import sys
import os

# Ensure we can import the package from source
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from starlette.testclient import TestClient
from praisonaiui.server import create_app

app = create_app()
client = TestClient(app)

passed = 0
failed = 0
errors = []


def check(name, response, expected_status=200, expected_keys=None):
    global passed, failed
    try:
        assert response.status_code == expected_status, \
            f"Expected {expected_status}, got {response.status_code}: {response.text[:200]}"
        data = response.json()
        if expected_keys:
            for key in expected_keys:
                assert key in data, f"Missing key '{key}' in response: {list(data.keys())}"
        passed += 1
        print(f"  ✓ {name}")
    except AssertionError as e:
        failed += 1
        errors.append(f"  ✗ {name}: {e}")
        print(f"  ✗ {name}: {e}")


# ═══════════════════════════════════════════════════════════════════════
# 1. FEATURES LISTING
# ═══════════════════════════════════════════════════════════════════════
print("\n── Features Listing ──")
r = client.get("/api/features")
check("GET /api/features", r, 200, ["features", "count"])
data = r.json()
feature_names = [f["name"] for f in data["features"]]
assert len(feature_names) == 10, f"Expected 10 features, got {len(feature_names)}: {feature_names}"
print(f"  ✓ All 10 features registered: {', '.join(feature_names)}")
passed += 1

# ═══════════════════════════════════════════════════════════════════════
# 2. APPROVALS — full lifecycle
# ═══════════════════════════════════════════════════════════════════════
print("\n── Approvals ──")
r = client.get("/api/approvals")
check("GET /api/approvals (empty)", r, 200, ["approvals", "count"])

r = client.post("/api/approvals", json={
    "tool_name": "execute_code", "arguments": {"code": "print('hi')"},
    "risk_level": "high", "agent_name": "TestAgent",
})
check("POST /api/approvals (create)", r, 201, ["id", "status"])
approval_id = r.json()["id"]

r = client.get(f"/api/approvals/{approval_id}")
check("GET /api/approvals/:id", r, 200, ["id", "tool_name", "status"])

r = client.get("/api/approvals?status=pending")
check("GET /api/approvals?status=pending", r, 200, ["approvals"])
assert r.json()["count"] == 1

r = client.post(f"/api/approvals/{approval_id}/resolve", json={"approved": True, "reason": "safe"})
check("POST /api/approvals/:id/resolve", r, 200, ["id", "status", "resolved_at"])
assert r.json()["status"] == "approved"

r = client.get("/api/approvals?status=resolved")
check("GET /api/approvals?status=resolved", r, 200, ["approvals"])
assert r.json()["count"] == 1

r = client.post("/api/approvals/nonexistent/resolve", json={"approved": True})
check("POST resolve nonexistent → 404", r, 404)

# ═══════════════════════════════════════════════════════════════════════
# 3. SCHEDULES — full lifecycle
# ═══════════════════════════════════════════════════════════════════════
print("\n── Schedules ──")
r = client.get("/api/schedules")
check("GET /api/schedules (empty)", r, 200, ["schedules", "count"])

r = client.post("/api/schedules", json={
    "name": "hourly-check", "message": "Run health check",
    "schedule": {"kind": "every", "every_seconds": 3600},
})
check("POST /api/schedules (create)", r, 201, ["id", "name", "schedule"])
job_id = r.json()["id"]

r = client.get(f"/api/schedules/{job_id}")
check("GET /api/schedules/:id", r, 200, ["id", "schedule"])

r = client.post(f"/api/schedules/{job_id}/toggle")
check("POST /api/schedules/:id/toggle", r, 200, ["id", "enabled"])
assert r.json()["enabled"] == False

r = client.post(f"/api/schedules/{job_id}/run")
check("POST /api/schedules/:id/run", r, 200, ["triggered", "last_run_at"])

r = client.delete(f"/api/schedules/{job_id}")
check("DELETE /api/schedules/:id", r, 200, ["deleted"])

r = client.delete("/api/schedules/nonexistent")
check("DELETE nonexistent → 404", r, 404)

# ═══════════════════════════════════════════════════════════════════════
# 4. MEMORY — full lifecycle
# ═══════════════════════════════════════════════════════════════════════
print("\n── Memory ──")
r = client.get("/api/memory")
check("GET /api/memory (empty)", r, 200, ["memories", "count"])

r = client.post("/api/memory", json={
    "text": "The user prefers dark mode", "memory_type": "long",
})
check("POST /api/memory (add)", r, 201, ["id", "text", "memory_type"])
mem_id = r.json()["id"]

r = client.post("/api/memory", json={
    "text": "User asked about Python", "memory_type": "short",
})
check("POST /api/memory (add short)", r, 201)

r = client.get(f"/api/memory/{mem_id}")
check("GET /api/memory/:id", r, 200, ["id", "text"])

r = client.post("/api/memory/search", json={"query": "dark mode", "limit": 5})
check("POST /api/memory/search", r, 200, ["results", "count"])
assert r.json()["count"] == 1

r = client.get("/api/memory?type=long")
check("GET /api/memory?type=long", r, 200, ["memories"])
assert r.json()["count"] == 1

r = client.delete(f"/api/memory/{mem_id}")
check("DELETE /api/memory/:id", r, 200, ["deleted"])

r = client.delete("/api/memory?type=all")
check("DELETE /api/memory (clear all)", r, 200, ["cleared"])

# ═══════════════════════════════════════════════════════════════════════
# 5. EXTENDED SESSIONS — state, context, labels, reset
# ═══════════════════════════════════════════════════════════════════════
print("\n── Extended Sessions ──")
sid = "test-session-001"

r = client.get(f"/api/sessions/{sid}/state")
check("GET /api/sessions/:id/state (empty)", r, 200, ["session_id", "state"])

r = client.post(f"/api/sessions/{sid}/state", json={"state": {"mood": "happy", "level": 5}})
check("POST /api/sessions/:id/state (save)", r, 200, ["session_id", "state"])
assert r.json()["state"]["mood"] == "happy"

r = client.get(f"/api/sessions/{sid}/state")
check("GET /api/sessions/:id/state (saved)", r, 200)
assert r.json()["state"]["mood"] == "happy"

r = client.post(f"/api/sessions/{sid}/context", json={"query": "What's the user mood?"})
check("POST /api/sessions/:id/context", r, 200, ["session_id", "context"])

r = client.post(f"/api/sessions/{sid}/labels", json={"labels": ["important", "vip"]})
check("POST /api/sessions/:id/labels", r, 200, ["labels"])
assert r.json()["labels"] == ["important", "vip"]

r = client.get(f"/api/sessions/{sid}/labels")
check("GET /api/sessions/:id/labels", r, 200, ["labels"])

r = client.get(f"/api/sessions/{sid}/usage")
check("GET /api/sessions/:id/usage", r, 200, ["session_id", "usage"])

r = client.post(f"/api/sessions/{sid}/compact")
check("POST /api/sessions/:id/compact", r, 200, ["compacted"])

r = client.post(f"/api/sessions/{sid}/reset", json={"mode": "clear"})
check("POST /api/sessions/:id/reset", r, 200, ["reset_mode"])

# ═══════════════════════════════════════════════════════════════════════
# 6. SKILLS — register, list, status, discover
# ═══════════════════════════════════════════════════════════════════════
print("\n── Skills ──")
r = client.get("/api/skills")
check("GET /api/skills (empty)", r, 200, ["skills", "count"])

r = client.post("/api/skills", json={
    "name": "web_search", "description": "Search the web", "version": "2.0.0",
})
check("POST /api/skills (register)", r, 201, ["id", "name", "status"])
skill_id = r.json()["id"]

r = client.get(f"/api/skills/{skill_id}")
check("GET /api/skills/:id", r, 200, ["name", "version"])

r = client.get(f"/api/skills/{skill_id}/status")
check("GET /api/skills/:id/status", r, 200, ["status", "version"])

r = client.post("/api/skills/discover", json={})
check("POST /api/skills/discover", r, 200, ["discovered", "count"])

r = client.delete(f"/api/skills/{skill_id}")
check("DELETE /api/skills/:id", r, 200, ["deleted"])

# ═══════════════════════════════════════════════════════════════════════
# 7. HOOKS — register, list, trigger, log
# ═══════════════════════════════════════════════════════════════════════
print("\n── Hooks ──")
r = client.get("/api/hooks")
check("GET /api/hooks (empty)", r, 200, ["hooks", "count"])

r = client.post("/api/hooks", json={
    "name": "on_tool_call", "event": "tool_call", "type": "pre",
})
check("POST /api/hooks (register)", r, 201, ["id", "name", "event"])
hook_id = r.json()["id"]

r = client.get(f"/api/hooks/{hook_id}")
check("GET /api/hooks/:id", r, 200, ["name", "event"])

r = client.post(f"/api/hooks/{hook_id}/trigger", json={"data": {"tool": "test"}})
check("POST /api/hooks/:id/trigger", r, 200, ["hook_id", "result"])

r = client.get("/api/hooks/log")
check("GET /api/hooks/log", r, 200, ["log", "count"])
assert r.json()["count"] >= 1

r = client.delete(f"/api/hooks/{hook_id}")
check("DELETE /api/hooks/:id", r, 200, ["deleted"])

# ═══════════════════════════════════════════════════════════════════════
# 8. WORKFLOWS — create, list, run, status, runs
# ═══════════════════════════════════════════════════════════════════════
print("\n── Workflows ──")
r = client.get("/api/workflows")
check("GET /api/workflows (empty)", r, 200, ["workflows", "count"])

r = client.post("/api/workflows", json={
    "name": "deploy-pipeline", "description": "Build, test, deploy",
    "pattern": "pipeline", "steps": ["build", "test", "deploy"],
})
check("POST /api/workflows (create)", r, 201, ["id", "name", "pattern"])
wf_id = r.json()["id"]

r = client.get(f"/api/workflows/{wf_id}")
check("GET /api/workflows/:id", r, 200, ["name", "steps"])

r = client.post(f"/api/workflows/{wf_id}/run", json={"input": {"env": "staging"}})
check("POST /api/workflows/:id/run", r, 200, ["id", "status", "output"])
run_id = r.json()["id"]

r = client.get(f"/api/workflows/{wf_id}/status")
check("GET /api/workflows/:id/status", r, 200, ["total_runs", "last_run"])

r = client.get("/api/workflows/runs")
check("GET /api/workflows/runs", r, 200, ["runs", "count"])
assert r.json()["count"] >= 1

r = client.get(f"/api/workflows/runs/{run_id}")
check("GET /api/workflows/runs/:run_id", r, 200, ["id", "status"])

r = client.delete(f"/api/workflows/{wf_id}")
check("DELETE /api/workflows/:id", r, 200, ["deleted"])

# ═══════════════════════════════════════════════════════════════════════
# 9. CONFIG RUNTIME — get, set, patch, history
# ═══════════════════════════════════════════════════════════════════════
print("\n── Config Runtime ──")
r = client.get("/api/config/runtime")
check("GET /api/config/runtime (empty)", r, 200, ["config"])

import urllib.request
# PATCH requires special handling with TestClient
r = client.request("PATCH", "/api/config/runtime", json={"model": "gpt-4o", "temperature": "0.7"})
check("PATCH /api/config/runtime", r, 200, ["config", "applied"])
assert r.json()["applied"] == 2

r = client.get("/api/config/runtime/model")
check("GET /api/config/runtime/model", r, 200, ["key", "value"])
assert r.json()["value"] == "gpt-4o"

r = client.put("/api/config/runtime/temperature", json={"value": "0.9"})
check("PUT /api/config/runtime/temperature", r, 200, ["key", "value"])

r = client.get("/api/config/runtime/history")
check("GET /api/config/runtime/history", r, 200, ["history", "count"])
assert r.json()["count"] >= 2

r = client.delete("/api/config/runtime/model")
check("DELETE /api/config/runtime/model", r, 200, ["deleted"])

r = client.get("/api/config/runtime/model")
check("GET deleted key → 404", r, 404)

# ═══════════════════════════════════════════════════════════════════════
# 10. EXISTING ROUTES STILL WORK
# ═══════════════════════════════════════════════════════════════════════
print("\n── Existing Routes ──")
r = client.get("/health")
check("GET /health", r, 200, ["status"])

r = client.get("/api/overview")
check("GET /api/overview", r, 200, ["status", "version"])

r = client.get("/api/provider")
check("GET /api/provider", r, 200, ["name"])

r = client.get("/api/pages")
check("GET /api/pages", r, 200, ["pages"])

r = client.get("/agents")
check("GET /agents", r, 200, ["agents"])

r = client.get("/sessions")
check("GET /sessions", r, 200)

r = client.get("/api/logs")
check("GET /api/logs", r, 200)

r = client.get("/api/usage")
check("GET /api/usage", r, 200)

r = client.get("/api/debug")
check("GET /api/debug", r, 200)


# ═══════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════
print(f"\n{'═' * 60}")
print(f"  RESULTS: {passed} passed, {failed} failed")
print(f"{'═' * 60}")
if errors:
    print("\nFAILURES:")
    for e in errors:
        print(e)
    sys.exit(1)
else:
    print("\n✓ All tests passed!")
    sys.exit(0)
