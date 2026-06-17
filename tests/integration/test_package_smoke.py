"""Automated package-alignment smoke tests (plan checklist)."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def dashboard_client():
    import praisonaiui as aiui
    import praisonaiui.server as server
    from praisonaiui.features import jobs as jobs_mod

    server.reset_state()
    jobs_mod._job_store = jobs_mod.SimpleJobStore()
    aiui.set_style("dashboard")
    aiui.set_dashboard(modules=["jobs", "auth", "api"], sidebar=True)
    aiui.set_jobs_api(api_base="/api/jobs", backend="aiui")
    app = server.create_app()
    return TestClient(app)


@pytest.fixture
def plugins_dir() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "src"
        / "praisonaiui"
        / "templates"
        / "frontend"
        / "plugins"
    )


class TestPackageSmoke:
    """Checklist from praisonai-package-integration smoke section."""

    def test_health_endpoint(self, dashboard_client):
        resp = dashboard_client.get("/health")
        assert resp.status_code == 200
        assert resp.json().get("status") == "ok"

    def test_ui_config_dashboard(self, dashboard_client):
        resp = dashboard_client.get("/ui-config.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("style") == "dashboard"
        assert data.get("jobs", {}).get("apiBase") == "/api/jobs"
        dash = data.get("dashboard") or {}
        assert "jobs" in (dash.get("modules") or [])

    def test_plugins_json_modules(self, dashboard_client):
        resp = dashboard_client.get("/plugins/plugins.json")
        assert resp.status_code == 200
        plugins = resp.json().get("plugins") or []
        assert "dashboard" in plugins
        assert "jobs" in plugins
        assert "auth" in plugins
        assert "api" in plugins

    def test_sessions_list(self, dashboard_client):
        resp = dashboard_client.get("/sessions")
        assert resp.status_code == 200
        assert "sessions" in resp.json()

    def test_agents_definitions(self, dashboard_client):
        resp = dashboard_client.get("/api/agents/definitions")
        assert resp.status_code == 200
        assert "agents" in resp.json()

    def test_jobs_submit_and_list(self, dashboard_client):
        submit = dashboard_client.post("/api/jobs", json={"prompt": "smoke test job"})
        assert submit.status_code == 202
        job_id = submit.json()["job_id"]

        listing = dashboard_client.get("/api/jobs")
        assert listing.status_code == 200
        jobs = listing.json().get("jobs") or []
        assert any(j.get("id") == job_id or j.get("job_id") == job_id for j in jobs)

    def test_explorer_probe_endpoints(self, dashboard_client):
        for path in ("/health", "/ui-config.json", "/plugins/plugins.json", "/api/dashboard/plugins"):
            resp = dashboard_client.get(path)
            assert resp.status_code == 200, path

    def test_auth_api_plugin_assets(self, plugins_dir):
        for rel in ("auth.js", "api.js", "views/auth.js", "views/api.js", "views/explorer.js"):
            assert (plugins_dir / rel).is_file(), rel

    def test_run_endpoint_available(self, dashboard_client):
        """Chat path exists (streaming requires a live provider)."""
        resp = dashboard_client.post("/run", json={"message": "hi", "session_id": "smoke"})
        assert resp.status_code in (200, 422, 500)
