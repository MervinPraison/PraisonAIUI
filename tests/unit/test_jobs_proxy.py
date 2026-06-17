"""Tests for optional /api/jobs → external /api/v1/runs proxy."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def proxy_client():
    import praisonaiui as aiui
    import praisonaiui.server as server

    server.reset_state()
    aiui.set_style("dashboard")
    aiui.set_jobs_proxy("http://jobs-upstream:9000")
    app = server.create_app()
    return TestClient(app)


def test_proxy_forwards_list_and_normalises_ids(proxy_client):
    upstream_json = {
        "jobs": [{"job_id": "run_abc", "status": "queued", "prompt": "x"}],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"content-type": "application/json"}
    mock_resp.json.return_value = upstream_json
    mock_resp.content = b""

    mock_client = AsyncMock()
    mock_client.request = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("praisonaiui.jobs_proxy.httpx.AsyncClient", return_value=mock_client):
        resp = proxy_client.get("/api/jobs")

    assert resp.status_code == 200
    job = resp.json()["jobs"][0]
    assert job["id"] == "run_abc"
    assert job["job_id"] == "run_abc"

    mock_client.request.assert_awaited_once()
    call_args = mock_client.request.await_args
    assert call_args[0][0] == "GET"
    assert call_args[0][1] == "http://jobs-upstream:9000/api/v1/runs"


def test_proxy_maps_subpaths(proxy_client):
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    mock_resp.headers = {"content-type": "application/json"}
    mock_resp.json.return_value = {"detail": "not found"}
    mock_resp.content = b""

    mock_client = AsyncMock()
    mock_client.request = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("praisonaiui.jobs_proxy.httpx.AsyncClient", return_value=mock_client):
        resp = proxy_client.get("/api/jobs/run_xyz/status")

    assert resp.status_code == 404
    assert mock_client.request.await_args[0][1] == "http://jobs-upstream:9000/api/v1/runs/run_xyz/status"


def test_no_proxy_routes_when_unset():
    import praisonaiui.server as server

    server.reset_state()
    app = server.create_app()
    client = TestClient(app)

    resp = client.post("/api/jobs", json={"prompt": "local"})
    assert resp.status_code == 202
