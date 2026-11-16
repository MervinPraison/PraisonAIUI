"""The schedules API behind the React Cron page: create keeps the agent, PUT
edits the schedule, and Run now is recorded on the stored job."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui import config_store
from praisonaiui.features import schedules


@pytest.fixture
def client(tmp_path, monkeypatch):
    store = config_store.YAMLConfigStore(tmp_path / "config.yaml")
    monkeypatch.setattr(config_store, "_config_store", store)
    monkeypatch.setattr(schedules, "_schedule_store", schedules._InMemoryScheduleStore())
    monkeypatch.setattr(schedules, "_ensure_scheduler_started", lambda: None)
    agent = SimpleNamespace(chat=lambda message: f"done: {message}")
    found = AsyncMock(return_value=(agent, None, None))
    monkeypatch.setattr(schedules, "_get_agent_for_execution", found)
    return TestClient(Starlette(routes=schedules.SchedulesFeature().routes()))


def test_create_edit_and_run_now(client):
    body = {"name": "Brief", "message": "hi", "agent_name": "Writer", "schedule": "0 9 * * *"}
    jid = client.post("/api/schedules", json=body).json()["id"]
    listed = client.get("/api/schedules").json()
    assert isinstance(listed["cron_available"], bool)
    assert listed["schedules"][0]["agent_name"] == "Writer"
    assert listed["schedules"][0]["schedule"]["cron_expr"] == "0 9 * * *"

    every = {"kind": "every", "every_seconds": 300}
    client.put(f"/api/schedules/{jid}", json={"schedule": every, "agent_name": "Coder"})
    job = client.get(f"/api/schedules/{jid}").json()
    assert (job["schedule"]["kind"], job["schedule"]["every_seconds"]) == ("every", 300)
    assert job["agent_name"] == "Coder"

    run = client.post(f"/api/schedules/{jid}/run").json()
    job = client.get(f"/api/schedules/{jid}").json()
    assert (run["status"], job["last_run_at"]) == ("succeeded", run["last_run_at"])
    assert (job["run_count"], job["last_status"]) == (1, "succeeded")
    assert client.get("/api/schedules/history").json()["history"][0]["job_id"] == jid
