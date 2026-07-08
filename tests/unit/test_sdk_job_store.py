"""SDKJobStore integration tests (when praisonai is installed)."""

from __future__ import annotations

import asyncio
import importlib.util

import pytest
from starlette.testclient import TestClient


def _praisonai_jobs_available() -> bool:
    try:
        return importlib.util.find_spec("praisonai.jobs") is not None
    except ModuleNotFoundError:
        return False


@pytest.fixture
def simple_jobs_client():
    import praisonaiui.server as server
    from praisonaiui.features import jobs as jobs_mod

    server.reset_state()
    jobs_mod._job_store = jobs_mod.SimpleJobStore()
    app = server.create_app()
    return TestClient(app)


def test_jobs_submit_and_get(simple_jobs_client):
    client = simple_jobs_client
    resp = client.post("/api/jobs", json={"prompt": "hello test"})
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]

    detail = client.get(f"/api/jobs/{job_id}")
    assert detail.status_code == 200
    assert detail.json()["id"] == job_id


def _praisonai_jobs_available() -> bool:
    try:
        return __import__("importlib").util.find_spec("praisonai.jobs") is not None
    except ModuleNotFoundError:
        return False


@pytest.mark.skipif(
    not _praisonai_jobs_available(),
    reason="praisonai package not installed",
)
def test_sdk_job_store_roundtrip():
    import time

    from praisonaiui.features.jobs import SDKJobStore

    store = SDKJobStore()
    job_id = "run_test123"
    now = time.time()
    job = {
        "id": job_id,
        "status": "queued",
        "prompt": "sdk roundtrip",
        "created_at": now,
        "progress_percentage": 0.0,
    }

    async def run():
        await store.save_job_async(job)
        loaded = await store.get_job_async(job_id)
        assert loaded is not None
        assert loaded["prompt"] == "sdk roundtrip"
        assert loaded["id"] == job_id
        total = await store.count_jobs_async()
        assert total >= 1
        assert await store.delete_job_async(job_id) is True
        assert await store.get_job_async(job_id) is None

    asyncio.run(run())
