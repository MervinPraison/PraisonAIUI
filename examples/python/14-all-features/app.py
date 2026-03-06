"""Example 14: All Features Demo — Comprehensive API test suite.

Demonstrates ALL 16 PraisonAIUI features with real API calls.
Run: PYTHONPATH=src python examples/python/14-all-features/app.py
"""

import sys
import os

# Add paths for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from starlette.testclient import TestClient
from praisonaiui.server import create_app


def test_all_features():
    """Test all 16 feature APIs with real data."""
    client = TestClient(create_app())
    
    results = []
    
    print("=" * 60)
    print("PraisonAIUI — ALL 16 FEATURES INTEGRATION TEST")
    print("=" * 60)
    print()
    
    # 1. Channels
    print("1. CHANNELS")
    r = client.get("/api/channels")
    channels = r.json().get("channels", [])
    print(f"   GET /api/channels: {r.status_code} — {len(channels)} channels")
    r = client.post("/api/channels", json={"name": "test-channel", "platform": "slack"})
    print(f"   POST /api/channels: {r.status_code}")
    results.append(("Channels", r.status_code in (200, 201)))
    
    # 2. Nodes
    print("\n2. NODES")
    r = client.get("/api/nodes")
    nodes = r.json().get("nodes", [])
    print(f"   GET /api/nodes: {r.status_code} — {len(nodes)} nodes")
    results.append(("Nodes", r.status_code == 200))
    
    # 3. Schedules
    print("\n3. SCHEDULES")
    r = client.get("/api/schedules")
    schedules = r.json().get("schedules", [])
    print(f"   GET /api/schedules: {r.status_code} — {len(schedules)} schedules")
    r = client.post("/api/schedules", json={
        "name": "test-schedule",
        "schedule": {"kind": "every", "every_seconds": 300},
        "message": "Test task"
    })
    print(f"   POST /api/schedules: {r.status_code}")
    results.append(("Schedules", r.status_code == 201))
    
    # 4. Skills
    print("\n4. SKILLS")
    r = client.get("/api/skills")
    skills = r.json().get("skills", [])
    print(f"   GET /api/skills: {r.status_code} — {len(skills)} skills")
    results.append(("Skills", r.status_code == 200))
    
    # 5. Jobs
    print("\n5. JOBS")
    r = client.get("/api/jobs")
    jobs = r.json().get("jobs", [])
    print(f"   GET /api/jobs: {r.status_code} — {len(jobs)} jobs")
    r = client.post("/api/jobs", json={"prompt": "Test prompt", "config": {}})
    job_id = r.json().get("job_id")
    print(f"   POST /api/jobs: {r.status_code} — job_id={job_id}")
    r = client.get("/api/jobs/stats")
    print(f"   GET /api/jobs/stats: {r.status_code}")
    results.append(("Jobs", r.status_code == 200))
    
    # 6. Usage
    print("\n6. USAGE")
    r = client.get("/api/usage")
    total = r.json().get("total_requests", 0)
    print(f"   GET /api/usage: {r.status_code} — {total} requests tracked")
    r = client.post("/api/usage/track", json={
        "model": "gpt-4o-mini", "input_tokens": 100, "output_tokens": 50
    })
    print(f"   POST /api/usage/track: {r.status_code}")
    results.append(("Usage", r.status_code == 201))
    
    # 7. Approvals
    print("\n7. APPROVALS")
    r = client.get("/api/approvals")
    approvals = r.json().get("approvals", [])
    print(f"   GET /api/approvals: {r.status_code} — {len(approvals)} pending")
    r = client.get("/api/approvals/policies")
    print(f"   GET /api/approvals/policies: {r.status_code}")
    results.append(("Approvals", r.status_code == 200))
    
    # 8. Agents
    print("\n8. AGENTS")
    r = client.get("/api/agents/definitions")
    agents = r.json().get("agents", [])
    print(f"   GET /api/agents/definitions: {r.status_code} — {len(agents)} agents")
    r = client.post("/api/agents/definitions", json={
        "name": "Test Agent",
        "instructions": "You are a test assistant",
        "model": "gpt-4o-mini"
    })
    agent_id = r.json().get("id")
    print(f"   POST /api/agents/definitions: {r.status_code} — id={agent_id}")
    results.append(("Agents", r.status_code == 201))
    
    # 9. Config
    print("\n9. CONFIG")
    r = client.get("/api/config/schema")
    has_schema = "schema" in r.json()
    print(f"   GET /api/config/schema: {r.status_code} — has_schema={has_schema}")
    r = client.get("/api/config/defaults")
    print(f"   GET /api/config/defaults: {r.status_code}")
    results.append(("Config", r.status_code == 200))
    
    # 10. Auth
    print("\n10. AUTH")
    r = client.get("/api/auth/status")
    mode = r.json().get("mode")
    print(f"   GET /api/auth/status: {r.status_code} — mode={mode}")
    results.append(("Auth", r.status_code == 200))
    
    # 11. OpenAI API
    print("\n11. OPENAI API")
    r = client.get("/v1/models")
    models = r.json().get("data", [])
    print(f"   GET /v1/models: {r.status_code} — {len(models)} models")
    results.append(("OpenAI API", r.status_code == 200))
    
    # 12. Logs
    print("\n12. LOGS")
    r = client.get("/api/logs/levels")
    levels = r.json().get("levels", [])
    print(f"   GET /api/logs/levels: {r.status_code} — {len(levels)} levels")
    results.append(("Logs", r.status_code == 200))
    
    # 13. Sessions
    print("\n13. SESSIONS")
    r = client.post("/api/sessions/test-session/state", json={"state": {"key": "value"}})
    print(f"   POST /api/sessions/test-session/state: {r.status_code}")
    r = client.get("/api/sessions/test-session/state")
    state = r.json().get("state", {})
    print(f"   GET /api/sessions/test-session/state: {r.status_code} — {state}")
    results.append(("Sessions", r.status_code == 200 and state.get("key") == "value"))
    
    # 14. Memory
    print("\n14. MEMORY")
    r = client.get("/api/memory")
    memories = r.json() if r.status_code == 200 else []
    print(f"   GET /api/memory: {r.status_code} — {len(memories) if isinstance(memories, list) else 'N/A'} memories")
    results.append(("Memory", r.status_code == 200))
    
    # 15. Hooks
    print("\n15. HOOKS")
    r = client.get("/api/hooks")
    hooks = r.json().get("hooks", [])
    print(f"   GET /api/hooks: {r.status_code} — {len(hooks)} hooks")
    results.append(("Hooks", r.status_code == 200))
    
    # 16. Workflows
    print("\n16. WORKFLOWS")
    r = client.get("/api/workflows")
    workflows = r.json().get("workflows", [])
    print(f"   GET /api/workflows: {r.status_code} — {len(workflows)} workflows")
    results.append(("Workflows", r.status_code == 200))
    
    # Summary
    print("\n" + "=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)
    passed = sum(1 for _, p in results if p)
    for name, p in results:
        status = "✅ PASS" if p else "❌ FAIL"
        print(f"  {name:15} {status}")
    print()
    print(f"Total: {passed}/{len(results)} features passed")
    print("=" * 60)
    
    return passed == len(results)


def test_real_agent_execution():
    """Test real agent execution with LLM call."""
    print("\n" + "=" * 60)
    print("REAL AGENTIC TEST — LLM Execution")
    print("=" * 60)
    
    client = TestClient(create_app())
    
    # Create agent
    r = client.post("/api/agents/definitions", json={
        "name": "Real Test Agent",
        "instructions": "You are a helpful assistant. Be brief.",
        "model": "gpt-4o-mini"
    })
    agent_id = r.json().get("id")
    print(f"\n1. Created agent: {agent_id}")
    
    # Execute agent
    print("2. Executing agent (real LLM call)...")
    r = client.post(f"/api/agents/run/{agent_id}", json={
        "prompt": "Say 'Hello World' in exactly 2 words"
    }, timeout=30)
    
    if r.status_code == 200:
        result = r.json().get("result", "")
        print(f"   ✅ Response: {result[:100]}")
        return True
    else:
        print(f"   ❌ Error: {r.json()}")
        return False


if __name__ == "__main__":
    all_passed = test_all_features()
    agent_passed = test_real_agent_execution()
    
    print("\n" + "=" * 60)
    if all_passed and agent_passed:
        print("✅ ALL TESTS PASSED — 0 GAPS")
    else:
        print("⚠️ SOME TESTS FAILED")
    print("=" * 60)
    
    sys.exit(0 if all_passed and agent_passed else 1)
