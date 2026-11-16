"""Cron schedules run: croniter is a core dependency the scheduler uses, and
Stop works (it raised KeyError on ``stopped_at``)."""

import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui import config_store
from praisonaiui.features import schedules

ROOT = Path(__file__).resolve().parents[2]


def utc(*args) -> float:
    return datetime(*args, tzinfo=timezone.utc).timestamp()


def test_croniter_is_a_core_dependency():
    text = (ROOT / "pyproject.toml").read_text()
    deps = re.search(r"^dependencies = \[(.*?)^\]", text, re.M | re.S).group(1)
    assert re.search(r'^\s*"croniter[>=~]', deps, re.M)


def test_a_daily_cron_schedule_computes_its_next_run_and_falls_due(monkeypatch):
    assert schedules._next_cron_run("0 9 * * *", utc(2026, 11, 15, 10)) == utc(2026, 11, 16, 9)
    assert schedules._next_cron_run("not cron", utc(2026, 11, 15)) is None
    job = {"enabled": True, "schedule": {"kind": "cron", "cron_expr": "0 9 * * *"}}
    job["last_run_at"] = utc(2026, 11, 15, 10)
    monkeypatch.setattr(schedules.time, "time", lambda: utc(2026, 11, 16, 8, 59))
    assert not schedules._is_job_due(job)
    monkeypatch.setattr(schedules.time, "time", lambda: utc(2026, 11, 16, 9, 0, 5))
    assert schedules._is_job_due(job)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(
        config_store, "_config_store", config_store.YAMLConfigStore(tmp_path / "c.yaml")
    )
    monkeypatch.setattr(schedules, "_schedule_store", schedules._InMemoryScheduleStore())
    monkeypatch.setattr(schedules, "_ensure_scheduler_started", lambda: None)
    return TestClient(Starlette(routes=schedules.SchedulesFeature().routes()))


def test_stop_disables_the_job_and_stats_give_the_next_cron_run(client):
    body = {"name": "brief", "message": "hi", "schedule": "0 9 * * *"}
    jid = client.post("/api/schedules", json=body).json()["id"]
    assert client.get(f"/api/schedules/{jid}/stats").json()["next_run_at"] is not None

    stopped = client.post(f"/api/schedules/{jid}/stop")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "stopped"
    assert isinstance(stopped.json()["stopped_at"], float)
    assert client.get(f"/api/schedules/{jid}").json()["enabled"] is False
