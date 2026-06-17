"""Dashboard module and jobs config tests."""

from __future__ import annotations

import pytest


@pytest.fixture
def dashboard_source():
    path = (
        __import__("pathlib").Path(__file__).resolve().parents[2]
        / "src"
        / "praisonaiui"
        / "templates"
        / "frontend"
        / "plugins"
        / "dashboard.js"
    )
    return path.read_text(encoding="utf-8")


@pytest.fixture
def jobs_source():
    path = (
        __import__("pathlib").Path(__file__).resolve().parents[2]
        / "src"
        / "praisonaiui"
        / "templates"
        / "frontend"
        / "plugins"
        / "jobs.js"
    )
    return path.read_text(encoding="utf-8")


def test_builtin_views_include_auth_and_api(dashboard_source):
    assert "auth:" in dashboard_source
    assert "api:" in dashboard_source
    assert "/plugins/views/auth.js" in dashboard_source
    assert "/plugins/views/api.js" in dashboard_source


def test_jobs_js_reads_ui_config(jobs_source):
    assert "loadJobsConfig" in jobs_source
    assert "/ui-config.json" in jobs_source
    assert "jobsUrl" in jobs_source
    assert "normalizeJob" in jobs_source


def test_view_wrappers_delegate(dashboard_source):
    """Views should exist in BUILTIN_VIEWS for modular pages."""
    for page_id in ("agents", "sessions", "schedules", "config", "channels", "logs", "usage", "jobs"):
        assert page_id in dashboard_source or f"'{page_id}'" in dashboard_source


def test_plugins_config_includes_auth_api_modules():
    """Optional dashboard modules appear in dynamic plugins.json."""
    from starlette.testclient import TestClient

    import praisonaiui as aiui
    import praisonaiui.server as server

    server.reset_state()
    aiui.set_style("dashboard")
    aiui.set_dashboard(modules=["jobs", "auth", "api"])
    app = server.create_app()
    client = TestClient(app)
    resp = client.get("/plugins/plugins.json")
    assert resp.status_code == 200
    plugins = resp.json().get("plugins") or []
    assert "jobs" in plugins
    assert "auth" in plugins
    assert "api" in plugins
