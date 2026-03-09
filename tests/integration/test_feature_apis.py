"""Comprehensive integration tests for ALL PraisonAIUI feature APIs.

Covers: health, features, agents, approvals, auth, channels, config_runtime,
eval, guardrails, hooks, i18n, jobs, knowledge, logs, marketplace, memory,
nodes, pages, protocol, schedules, security, sessions, skills, telemetry,
theme, tracing, usage, workflows — plus persistence across restart.

Run with:
    PYTHONPATH=src python3 -m pytest tests/integration/test_feature_apis.py -v -o "addopts=" --timeout=30
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _isolate_persistence(tmp_path, monkeypatch):
    """Redirect unified config.yaml to a temp dir and reset in-memory state."""
    # Point the config store to a temp config.yaml
    import praisonaiui.config_store as cs
    store = cs.YAMLConfigStore(tmp_path / "config.yaml")
    cs.set_config_store(store)

    # Clear channels
    try:
        from praisonaiui.features.channels import _channels, _live_bots
        _channels.clear()
        _live_bots.clear()
    except ImportError:
        pass
    # Clear schedules
    try:
        from praisonaiui.features.schedules import _run_history
        _run_history.clear()
    except ImportError:
        pass
    # Clear config runtime
    try:
        from praisonaiui.features.config_runtime import _runtime_config, _config_history
        _runtime_config.clear()
        _config_history.clear()
    except ImportError:
        pass
    yield


@pytest.fixture
def client():
    """HTTP test client against a bare app."""
    app = create_app()
    return TestClient(app)


# ===========================================================================
# Health & System
# ===========================================================================


class TestHealth:
    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestFeaturesAPI:
    def test_list_features(self, client):
        r = client.get("/api/features")
        assert r.status_code == 200
        data = r.json()
        features = data.get("features", data)
        assert isinstance(features, (list, dict))
        # Should have many features registered
        count = len(features) if isinstance(features, list) else len(features.keys())
        assert count >= 10


# ===========================================================================
# Config Runtime
# ===========================================================================


class TestConfigRuntimeAPI:
    def test_get_empty(self, client):
        r = client.get("/api/config/runtime")
        assert r.status_code == 200
        data = r.json()
        assert "config" in data
        # Gateway info should be present
        assert "gateway" in data["config"]

    def test_patch_and_read(self, client):
        r = client.patch("/api/config/runtime", json={"model": "gpt-4o"})
        assert r.status_code == 200
        assert r.json()["applied"] == 1
        assert r.json()["config"]["model"] == "gpt-4o"

        r2 = client.get("/api/config/runtime")
        assert r2.json()["config"]["model"] == "gpt-4o"

    def test_put_replaces_all(self, client):
        client.patch("/api/config/runtime", json={"a": 1, "b": 2})
        r = client.put("/api/config/runtime", json={"x": 10})
        assert r.status_code == 200
        config = r.json()["config"]
        assert "x" in config
        assert "a" not in config

    def test_set_key_and_get_key(self, client):
        r = client.put("/api/config/runtime/mykey", json={"value": "hello"})
        assert r.status_code == 200
        assert r.json()["value"] == "hello"

        r2 = client.get("/api/config/runtime/mykey")
        assert r2.status_code == 200
        assert r2.json()["value"] == "hello"

    def test_get_missing_key(self, client):
        r = client.get("/api/config/runtime/nonexistent")
        assert r.status_code == 404

    def test_delete_key(self, client):
        client.put("/api/config/runtime/to_del", json={"value": 42})
        r = client.delete("/api/config/runtime/to_del")
        assert r.status_code == 200
        assert r.json()["deleted"] == "to_del"

        r2 = client.get("/api/config/runtime/to_del")
        assert r2.status_code == 404

    def test_delete_missing_key(self, client):
        r = client.delete("/api/config/runtime/ghost")
        assert r.status_code == 404

    def test_history(self, client):
        client.patch("/api/config/runtime", json={"foo": "bar"})
        r = client.get("/api/config/runtime/history")
        assert r.status_code == 200
        assert r.json()["count"] >= 1

    def test_schema(self, client):
        r = client.get("/api/config/schema")
        assert r.status_code == 200
        assert "schema" in r.json()
        assert "properties" in r.json()["schema"]

    def test_validate_valid(self, client):
        r = client.post("/api/config/validate", json={
            "config": {"model": {"name": "gpt-4o", "temperature": 0.7}}
        })
        assert r.status_code == 200
        assert r.json()["valid"] is True

    def test_validate_invalid(self, client):
        r = client.post("/api/config/validate", json={
            "config": {"model": {"temperature": "not_a_number"}}
        })
        assert r.status_code == 200
        assert r.json()["valid"] is False
        assert len(r.json()["errors"]) > 0

    def test_apply(self, client):
        r = client.post("/api/config/apply", json={
            "config": {"model": {"name": "gpt-4o-mini", "temperature": 0.5}}
        })
        assert r.status_code == 200
        assert r.json()["applied"] is True

    def test_defaults(self, client):
        r = client.get("/api/config/defaults")
        assert r.status_code == 200
        defaults = r.json()["defaults"]
        assert "model" in defaults or "server" in defaults


# ===========================================================================
# Agents
# ===========================================================================


class TestAgentsAPI:
    def test_list_agents(self, client):
        r = client.get("/api/agents/definitions")
        assert r.status_code == 200

    def test_models(self, client):
        r = client.get("/api/agents/models")
        assert r.status_code == 200
        data = r.json()
        assert "models" in data or isinstance(data, list)

    def test_create_agent(self, client):
        r = client.post("/api/agents/definitions", json={
            "name": "Test Agent",
            "instructions": "You are a test agent.",
            "model": "gpt-4o-mini",
        })
        assert r.status_code in (200, 201)
        data = r.json()
        assert "id" in data or "name" in data

    def test_get_missing_agent(self, client):
        r = client.get("/api/agents/definitions/nonexistent_999")
        assert r.status_code == 404


# ===========================================================================
# Sessions
# ===========================================================================


class TestSessionsAPI:
    def test_list_sessions(self, client):
        r = client.get("/api/sessions")
        assert r.status_code == 200
        data = r.json()
        assert "sessions" in data or isinstance(data, list)

    def test_state_round_trip(self, client):
        sid = "test_session_001"
        r = client.post(f"/api/sessions/{sid}/state", json={"key": "val"})
        assert r.status_code == 200

        r2 = client.get(f"/api/sessions/{sid}/state")
        assert r2.status_code == 200


# ===========================================================================
# Eval
# ===========================================================================


class TestEvalAPI:
    def test_list_evals(self, client):
        r = client.get("/api/eval")
        assert r.status_code == 200

    def test_eval_status(self, client):
        r = client.get("/api/eval/status")
        assert r.status_code == 200

    def test_list_judges(self, client):
        r = client.get("/api/eval/judges")
        assert r.status_code == 200

    def test_scores(self, client):
        r = client.get("/api/eval/scores")
        assert r.status_code == 200


# ===========================================================================
# Workflows
# ===========================================================================


class TestWorkflowsAPI:
    def test_list_workflows(self, client):
        r = client.get("/api/workflows")
        assert r.status_code == 200

    def test_create_workflow(self, client):
        r = client.post("/api/workflows", json={
            "name": "Test Workflow",
            "steps": [{"action": "greet", "agent": "default"}],
        })
        assert r.status_code in (200, 201)
        data = r.json()
        assert "id" in data

    def test_list_runs_empty(self, client):
        r = client.get("/api/workflows/runs")
        assert r.status_code == 200


# ===========================================================================
# Jobs
# ===========================================================================


class TestJobsAPI:
    def test_list_jobs(self, client):
        r = client.get("/api/jobs")
        assert r.status_code == 200


# ===========================================================================
# Knowledge
# ===========================================================================


class TestKnowledgeAPI:
    def test_list_knowledge(self, client):
        r = client.get("/api/knowledge")
        assert r.status_code == 200

    def test_knowledge_status(self, client):
        r = client.get("/api/knowledge/status")
        assert r.status_code == 200


# ===========================================================================
# Logs
# ===========================================================================


class TestLogsAPI:
    def test_levels(self, client):
        r = client.get("/api/logs/levels")
        assert r.status_code == 200

    def test_stats(self, client):
        r = client.get("/api/logs/stats")
        assert r.status_code == 200

    def test_clear(self, client):
        r = client.post("/api/logs/clear")
        assert r.status_code == 200


# ===========================================================================
# Usage
# ===========================================================================


class TestUsageAPI:
    def test_summary(self, client):
        r = client.get("/api/usage/summary")
        assert r.status_code == 200

    def test_details(self, client):
        r = client.get("/api/usage/details")
        assert r.status_code == 200

    def test_models(self, client):
        r = client.get("/api/usage/models")
        assert r.status_code == 200

    def test_sessions(self, client):
        r = client.get("/api/usage/sessions")
        assert r.status_code == 200

    def test_agents(self, client):
        r = client.get("/api/usage/agents")
        assert r.status_code == 200

    def test_timeseries(self, client):
        r = client.get("/api/usage/timeseries")
        assert r.status_code == 200

    def test_costs(self, client):
        r = client.get("/api/usage/costs")
        assert r.status_code == 200

    def test_track(self, client):
        r = client.post("/api/usage/track", json={
            "model": "gpt-4o-mini",
            "input_tokens": 100,
            "output_tokens": 50,
        })
        assert r.status_code in (200, 201)


# ===========================================================================
# Theme
# ===========================================================================


class TestThemeAPI:
    def test_get_theme(self, client):
        r = client.get("/api/theme")
        assert r.status_code == 200
        data = r.json()
        assert "theme" in data or "name" in data

    def test_set_theme(self, client):
        r = client.put("/api/theme", json={"theme": "dark"})
        assert r.status_code == 200


# ===========================================================================
# i18n
# ===========================================================================


class TestI18nAPI:
    def test_locales(self, client):
        r = client.get("/api/i18n/locales")
        assert r.status_code == 200

    def test_get_locale(self, client):
        r = client.get("/api/i18n/locale")
        assert r.status_code == 200


# ===========================================================================
# Hooks
# ===========================================================================


class TestHooksAPI:
    def test_list_hooks(self, client):
        r = client.get("/api/hooks")
        assert r.status_code == 200


# ===========================================================================
# Approvals
# ===========================================================================


class TestApprovalsAPI:
    def test_list_approvals(self, client):
        r = client.get("/api/approvals")
        assert r.status_code == 200



# ===========================================================================
# Nodes
# ===========================================================================


class TestNodesAPI:
    def test_list_nodes(self, client):
        r = client.get("/api/nodes")
        assert r.status_code == 200



# ===========================================================================
# Auth
# ===========================================================================


class TestAuthAPI:
    def test_auth_status(self, client):
        r = client.get("/api/auth/status")
        assert r.status_code == 200


# ===========================================================================
# Security
# ===========================================================================


class TestSecurityAPI:
    def test_overview(self, client):
        r = client.get("/api/security")
        assert r.status_code == 200

    def test_status(self, client):
        r = client.get("/api/security/status")
        assert r.status_code == 200

    def test_audit(self, client):
        r = client.get("/api/security/audit")
        assert r.status_code == 200

    def test_get_config(self, client):
        r = client.get("/api/security/config")
        assert r.status_code == 200


# ===========================================================================
# Telemetry
# ===========================================================================


class TestTelemetryAPI:
    def test_telemetry_status(self, client):
        r = client.get("/api/telemetry/status")
        assert r.status_code == 200


# ===========================================================================
# Tracing
# ===========================================================================


class TestTracingAPI:
    def test_list_traces(self, client):
        r = client.get("/api/tracing")
        assert r.status_code == 200

    def test_tracing_status(self, client):
        r = client.get("/api/tracing/status")
        assert r.status_code == 200


# ===========================================================================
# Protocol
# ===========================================================================


class TestProtocolAPI:
    def test_protocol_info(self, client):
        r = client.get("/api/protocol")
        assert r.status_code == 200
        data = r.json()
        assert "version" in data or "protocol" in data


# ===========================================================================
# Marketplace
# ===========================================================================


class TestMarketplaceAPI:
    def test_list_marketplace(self, client):
        r = client.get("/api/marketplace")
        assert r.status_code == 200


# ===========================================================================
# Memory (from original tests, kept for completeness)
# ===========================================================================


class TestMemoryAPI:
    def test_memory_status(self, client):
        r = client.get("/api/memory/status")
        assert r.status_code == 200
        assert "status" in r.json()

    def test_memory_list(self, client):
        r = client.get("/api/memory")
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))


# ===========================================================================
# Skills (from original tests, kept for completeness)
# ===========================================================================


class TestSkillsAPI:
    def test_list_skills(self, client):
        r = client.get("/api/skills")
        assert r.status_code == 200
        data = r.json()
        assert "skills" in data or "tools" in data or isinstance(data, list)

    def test_skills_categories(self, client):
        r = client.get("/api/skills/categories")
        if r.status_code == 200:
            assert isinstance(r.json(), (dict, list))


# ===========================================================================
# Schedules (expanded)
# ===========================================================================


class TestSchedulesAPI:
    def test_list_empty(self, client):
        r = client.get("/api/schedules")
        assert r.status_code == 200
        data = r.json()
        assert "schedules" in data
        assert "count" in data

    def test_add_schedule(self, client):
        r = client.post("/api/schedules", json={
            "name": "Test Cron",
            "message": "Say hello",
            "schedule": {"kind": "every", "every_seconds": 300},
        })
        assert r.status_code == 201
        data = r.json()
        assert "id" in data
        assert data["name"] == "Test Cron"
        assert data["enabled"] is True

        # Verify it shows in the list
        r2 = client.get("/api/schedules")
        assert r2.json()["count"] >= 1

    def test_delete_schedule(self, client):
        r = client.post("/api/schedules", json={
            "name": "To Delete",
            "message": "test",
            "schedule": {"kind": "every", "every_seconds": 60},
        })
        job_id = r.json()["id"]
        r2 = client.delete(f"/api/schedules/{job_id}")
        assert r2.status_code == 200
        assert r2.json()["deleted"] == job_id

    def test_history_empty(self, client):
        r = client.get("/api/schedules/history")
        assert r.status_code == 200
        assert r.json()["history"] == []

    def test_toggle_schedule(self, client):
        r = client.post("/api/schedules", json={
            "name": "Toggle Test",
            "message": "hello",
            "schedule": {"kind": "every", "every_seconds": 60},
        })
        job_id = r.json()["id"]
        r2 = client.post(f"/api/schedules/{job_id}/toggle")
        assert r2.status_code == 200
        assert r2.json().get("enabled") is False


# ===========================================================================
# Guardrails (expanded)
# ===========================================================================


class TestGuardrailsAPI:
    def test_list_guardrails(self, client):
        r = client.get("/api/guardrails")
        assert r.status_code == 200
        data = r.json()
        assert "guardrails" in data
        assert "count" in data

    def test_guardrails_status(self, client):
        r = client.get("/api/guardrails/status")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_register_requires_description(self, client):
        r = client.post("/api/guardrails/register", json={"type": "llm"})
        assert r.status_code == 400
        assert "description" in r.json()["error"]

    def test_register_with_description(self, client):
        r = client.post("/api/guardrails/register", json={
            "type": "llm",
            "description": "Output must not contain profanity",
        })
        assert r.status_code == 200
        data = r.json()
        assert "registered" in data
        assert data["info"]["description"] == "Output must not contain profanity"

    def test_violations_empty(self, client):
        r = client.get("/api/guardrails/violations")
        assert r.status_code == 200
        assert r.json()["violations"] == []
        assert r.json()["count"] == 0


# ===========================================================================
# Channels (expanded)
# ===========================================================================


class TestChannelsAPI:
    def test_list_empty(self, client):
        r = client.get("/api/channels")
        assert r.status_code == 200
        data = r.json()
        assert data["channels"] == []
        assert data["count"] == 0

    def test_platforms(self, client):
        r = client.get("/api/channels/platforms")
        assert r.status_code == 200
        data = r.json()
        assert "telegram" in data["platforms"]
        assert "discord" in data["platforms"]
        assert "slack" in data["platforms"]

    def test_add_unsupported_platform(self, client):
        r = client.post("/api/channels", json={
            "platform": "fax",
            "config": {"bot_token": "test"},
        })
        assert r.status_code == 400
        assert "Unsupported" in r.json()["error"]

    def test_add_channel(self, client):
        r = client.post("/api/channels", json={
            "name": "Test Bot",
            "platform": "telegram",
            "config": {"bot_token": "fake123"},
        })
        assert r.status_code == 201
        data = r.json()
        assert data["platform"] == "telegram"
        assert data["name"] == "Test Bot"
        assert "id" in data

    def test_delete_channel(self, client):
        r = client.post("/api/channels", json={
            "name": "To Remove",
            "platform": "discord",
            "config": {"bot_token": "fake"},
        })
        ch_id = r.json()["id"]
        r2 = client.delete(f"/api/channels/{ch_id}")
        assert r2.status_code == 200
        assert r2.json()["deleted"] == ch_id


# ===========================================================================
# Pages / Sidebar
# ===========================================================================


class TestPagesAPI:
    def test_pages_returns_builtin(self, client):
        r = client.get("/api/pages")
        assert r.status_code == 200
        pages = r.json().get("pages", r.json())
        assert isinstance(pages, list)
        assert len(pages) > 0
        for p in pages:
            assert "group" in p, f"Page {p.get('id')} missing group"

    def test_cron_in_agent_group(self, client):
        r = client.get("/api/pages")
        pages = r.json().get("pages", r.json())
        cron = next((p for p in pages if p["id"] == "cron"), None)
        if cron:
            assert cron["group"] == "Agent"

    def test_eval_in_control_group(self, client):
        r = client.get("/api/pages")
        pages = r.json().get("pages", r.json())
        ev = next((p for p in pages if p["id"] == "eval"), None)
        if ev:
            assert ev["group"] == "Control"


# ===========================================================================
# Persistence across restart
# ===========================================================================


class TestPersistence:
    """Verify settings survive a simulated server restart via unified config.yaml."""

    def test_config_survives_restart(self, client, tmp_path, monkeypatch):
        """PATCH config → clear in-memory → reload from unified YAML → verify."""
        client.patch("/api/config/runtime", json={"persist_test": "yes"})

        # Simulate restart: clear in-memory state
        from praisonaiui.features.config_runtime import _runtime_config
        _runtime_config.clear()

        # Reload from unified config.yaml
        import praisonaiui.config_store as cs
        store = cs.get_config_store()
        store.reload()
        restored = store.get_section("runtime_config")
        assert restored.get("persist_test") == "yes"

    def test_guardrails_survive_restart(self, client, tmp_path, monkeypatch):
        """Register guardrail → clear → reload → verify."""
        client.post("/api/guardrails/register", json={
            "type": "llm",
            "description": "Must be polite",
        })

        # Simulate restart: new manager reads from unified config.yaml
        from praisonaiui.features.guardrails import SimpleGuardrailManager
        fresh = SimpleGuardrailManager()
        guardrails = fresh.list_guardrails()
        assert any("Must be polite" in g.get("description", "") for g in guardrails)

    def test_channels_survive_restart(self, client, tmp_path, monkeypatch):
        """Add channel → clear → reload from unified YAML → verify."""
        r = client.post("/api/channels", json={
            "name": "Persist Bot",
            "platform": "telegram",
            "config": {"bot_token": "persist_test"},
        })
        ch_id = r.json()["id"]

        # Simulate restart
        from praisonaiui.features.channels import _channels
        _channels.clear()

        import praisonaiui.config_store as cs
        store = cs.get_config_store()
        store.reload()
        ch_data = store.get_section("channels")
        assert ch_id in ch_data
        assert ch_data[ch_id]["name"] == "Persist Bot"
        # Runtime fields should NOT be in the YAML
        assert "running" not in ch_data[ch_id]

    def test_schedules_survive_restart(self, client, tmp_path, monkeypatch):
        """Add schedule → clear → reload → verify."""
        r = client.post("/api/schedules", json={
            "name": "Persistent Job",
            "message": "persist test",
            "schedule": {"kind": "every", "every_seconds": 120},
        })
        job_id = r.json()["id"]

        # Simulate restart: new store reads from unified config.yaml
        from praisonaiui.features.schedules import _InMemoryScheduleStore
        fresh = _InMemoryScheduleStore()
        jobs = fresh.list()
        assert any(j.get("id") == job_id or j.get("name") == "Persistent Job" for j in jobs)

    def test_all_sections_in_single_file(self, client, tmp_path):
        """Verify all features write to the SAME config.yaml file."""
        # Create data in multiple features
        client.patch("/api/config/runtime", json={"unified": True})
        client.post("/api/channels", json={
            "name": "Ch1", "platform": "telegram",
            "config": {"bot_token": "t"},
        })
        client.post("/api/guardrails/register", json={
            "type": "llm", "description": "be nice",
        })

        # Read the single config.yaml from the store's actual path
        import yaml
        import praisonaiui.config_store as cs
        config_path = cs.get_config_store().path
        assert config_path.exists(), "config.yaml should exist"
        with open(config_path) as f:
            data = yaml.safe_load(f)

        # All sections should be present in the single file
        assert "runtime_config" in data
        assert data["runtime_config"]["unified"] is True
        assert "channels" in data
        assert len(data["channels"]) >= 1
        assert "guardrails" in data
        assert "registry" in data["guardrails"]
