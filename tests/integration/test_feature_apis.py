"""Integration tests for feature APIs — memory, skills, schedules, guardrails, channels.

Run with:
    pytest tests/integration/test_feature_apis.py -v
"""

from __future__ import annotations

import json
import time
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_feature_state():
    """Reset in-memory feature state before each test."""
    # Clear channels
    try:
        from praisonaiui.features.channels import _channels, _live_bots
        _channels.clear()
        _live_bots.clear()
    except ImportError:
        pass
    # Clear schedules
    try:
        from praisonaiui.features.schedules import _run_history, _get_schedule_store
        _run_history.clear()
    except ImportError:
        pass
    # Clear guardrails
    try:
        from praisonaiui.features.guardrails import _guardrail_manager, get_guardrail_manager
    except ImportError:
        pass
    yield


@pytest.fixture
def client():
    """HTTP test client against a bare app."""
    app = create_app()
    return TestClient(app)


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------


class TestMemoryAPI:
    """Tests for the /api/memory endpoint."""

    def test_memory_status(self, client):
        """GET /api/memory/status returns health info."""
        r = client.get("/api/memory/status")
        assert r.status_code == 200
        data = r.json()
        assert "status" in data

    def test_memory_search_empty(self, client):
        """GET /api/memory should return empty or list format with no data."""
        r = client.get("/api/memory")
        assert r.status_code == 200
        data = r.json()
        # Should have a list/memories key or an empty result
        assert isinstance(data, (list, dict))


# ---------------------------------------------------------------------------
# Skills (Tools)
# ---------------------------------------------------------------------------


class TestSkillsAPI:
    """Tests for the /api/skills endpoint."""

    def test_list_skills(self, client):
        """GET /api/skills should return a list of available tools."""
        r = client.get("/api/skills")
        assert r.status_code == 200
        data = r.json()
        assert "skills" in data or "tools" in data or isinstance(data, list)

    def test_skills_categories(self, client):
        """GET /api/skills/categories should return category groupings."""
        r = client.get("/api/skills/categories")
        if r.status_code == 200:
            data = r.json()
            assert isinstance(data, dict) or isinstance(data, list)


# ---------------------------------------------------------------------------
# Schedules (Cron)
# ---------------------------------------------------------------------------


class TestSchedulesAPI:
    """Tests for the /api/schedules endpoints."""

    def test_list_empty(self, client):
        """GET /api/schedules returns empty list initially."""
        r = client.get("/api/schedules")
        assert r.status_code == 200
        data = r.json()
        assert "schedules" in data
        assert "count" in data

    def test_add_schedule(self, client):
        """POST /api/schedules creates a new scheduled job."""
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
        """POST + DELETE should remove the job."""
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
        """GET /api/schedules/history returns empty list initially."""
        r = client.get("/api/schedules/history")
        assert r.status_code == 200
        assert r.json()["history"] == []

    def test_toggle_schedule(self, client):
        """POST toggle flips the enabled state."""
        r = client.post("/api/schedules", json={
            "name": "Toggle Test",
            "message": "hello",
            "schedule": {"kind": "every", "every_seconds": 60},
        })
        job_id = r.json()["id"]

        r2 = client.post(f"/api/schedules/{job_id}/toggle")
        assert r2.status_code == 200
        toggled = r2.json()
        assert toggled.get("enabled") is False


# ---------------------------------------------------------------------------
# Guardrails
# ---------------------------------------------------------------------------


class TestGuardrailsAPI:
    """Tests for the /api/guardrails endpoints."""

    def test_list_guardrails(self, client):
        """GET /api/guardrails returns list format."""
        r = client.get("/api/guardrails")
        assert r.status_code == 200
        data = r.json()
        assert "guardrails" in data
        assert "count" in data

    def test_guardrails_status(self, client):
        """GET /api/guardrails/status returns health info."""
        r = client.get("/api/guardrails/status")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"

    def test_register_guardrail_requires_description(self, client):
        """POST without description should fail."""
        r = client.post("/api/guardrails/register", json={
            "type": "llm",
        })
        assert r.status_code == 400
        assert "description" in r.json()["error"]

    def test_register_guardrail_with_description(self, client):
        """POST with description should register successfully."""
        r = client.post("/api/guardrails/register", json={
            "type": "llm",
            "description": "Output must not contain profanity",
        })
        assert r.status_code == 200
        data = r.json()
        assert "registered" in data
        assert data["info"]["description"] == "Output must not contain profanity"

    def test_violations_empty(self, client):
        """GET /api/guardrails/violations returns empty list initially."""
        r = client.get("/api/guardrails/violations")
        assert r.status_code == 200
        data = r.json()
        assert data["violations"] == []
        assert data["count"] == 0


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


class TestChannelsAPI:
    """Tests for the /api/channels endpoints."""

    def test_list_empty(self, client):
        """GET /api/channels returns empty list initially."""
        r = client.get("/api/channels")
        assert r.status_code == 200
        data = r.json()
        assert data["channels"] == []
        assert data["count"] == 0

    def test_platforms(self, client):
        """GET /api/channels/platforms returns supported list."""
        r = client.get("/api/channels/platforms")
        assert r.status_code == 200
        data = r.json()
        assert "telegram" in data["platforms"]
        assert "discord" in data["platforms"]
        assert "slack" in data["platforms"]

    def test_add_unsupported_platform(self, client):
        """POST with unsupported platform should fail."""
        r = client.post("/api/channels", json={
            "platform": "fax",
            "config": {"bot_token": "test"},
        })
        assert r.status_code == 400
        assert "Unsupported" in r.json()["error"]

    def test_add_channel_creates_entry(self, client):
        """POST with valid platform creates a channel entry."""
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
        """POST + DELETE removes the channel."""
        r = client.post("/api/channels", json={
            "name": "To Remove",
            "platform": "discord",
            "config": {"bot_token": "fake"},
        })
        ch_id = r.json()["id"]

        r2 = client.delete(f"/api/channels/{ch_id}")
        assert r2.status_code == 200
        assert r2.json()["deleted"] == ch_id


# ---------------------------------------------------------------------------
# Pages / Sidebar
# ---------------------------------------------------------------------------


class TestPagesAPI:
    """Tests for the /api/pages endpoint (sidebar groups)."""

    def test_pages_returns_builtin(self, client):
        """GET /api/pages should include builtin pages with groups."""
        r = client.get("/api/pages")
        assert r.status_code == 200
        data = r.json()
        pages = data.get("pages", data)
        assert isinstance(pages, list)
        # Should have at least some builtin pages
        assert len(pages) > 0
        # All pages should have group assignment
        for p in pages:
            assert "group" in p, f"Page {p.get('id')} missing group"

    def test_cron_in_agent_group(self, client):
        """Cron page should be in the Agent group."""
        r = client.get("/api/pages")
        pages = r.json().get("pages", r.json())
        cron = next((p for p in pages if p["id"] == "cron"), None)
        if cron:
            assert cron["group"] == "Agent", f"Cron is in '{cron['group']}', expected 'Agent'"

    def test_eval_in_control_group(self, client):
        """Eval page should be in the Control group."""
        r = client.get("/api/pages")
        pages = r.json().get("pages", r.json())
        ev = next((p for p in pages if p["id"] == "eval"), None)
        if ev:
            assert ev["group"] == "Control", f"Eval is in '{ev['group']}', expected 'Control'"
