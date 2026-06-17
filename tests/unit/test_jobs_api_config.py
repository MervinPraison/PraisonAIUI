"""Tests for jobs API configuration exposed via ui-config."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def client():
    import praisonaiui.server as server
    from praisonaiui.server import create_app, reset_state, set_jobs_api

    reset_state()
    set_jobs_api(api_base="/api/v1/runs", backend="praisonai")
    app = create_app()
    return TestClient(app)


def test_ui_config_includes_jobs_api(client):
    resp = client.get("/ui-config.json")
    assert resp.status_code == 200
    jobs = resp.json().get("jobs")
    assert jobs is not None
    assert jobs["apiBase"] == "/api/v1/runs"
    assert jobs["backend"] == "praisonai"


def test_set_jobs_backend_default():
    import praisonaiui.server as server

    server.set_jobs_api(api_base="/api/jobs", backend="aiui")
    server.set_jobs_backend("praisonai")
    assert server._jobs_api_config["apiBase"] == "/api/v1/runs"

    server.set_jobs_backend("aiui")
    assert server._jobs_api_config["apiBase"] == "/api/jobs"
    assert server._jobs_api_config["backend"] == "aiui"
