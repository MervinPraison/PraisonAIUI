"""Scheduled runs never overlap per job and are capped in total.

A job whose model call outlasted its interval (slow model, 429 retries)
started a new thread every 15 s tick. With many jobs the dashboard reached the
OS thread limit and stopped answering HTTP.
"""

from __future__ import annotations

import asyncio
import threading

import pytest

from praisonaiui.features import schedules


class _BlockingAgent:
    def __init__(self):
        self.release = threading.Event()
        self.lock = threading.Lock()
        self.running = 0
        self.peak = 0
        self.calls = 0

    def chat(self, message):
        with self.lock:
            self.calls += 1
            self.running += 1
            self.peak = max(self.peak, self.running)
        self.release.wait(30)
        with self.lock:
            self.running -= 1
        return "done"


@pytest.fixture
def agent(monkeypatch):
    agent = _BlockingAgent()

    async def _fake_get_agent(job_id, agent_name=None, session_id=None):
        return agent, None, None

    monkeypatch.setattr(schedules, "_get_agent_for_execution", _fake_get_agent)
    monkeypatch.setattr(schedules, "_get_schedule_store", lambda: object())
    monkeypatch.setattr(schedules, "_in_flight", set(), raising=False)
    yield agent
    agent.release.set()


async def _settle():
    for _ in range(50):
        await asyncio.sleep(0.01)


def test_a_running_job_is_not_started_again(agent):
    job = {"id": "j1", "name": "slow", "message": "hi"}

    async def main():
        assert schedules._start_job("j1", job) is True
        await _settle()
        assert schedules._start_job("j1", job) is False  # previous run still going
        assert agent.calls == 1
        agent.release.set()
        await _settle()
        assert "j1" not in schedules._in_flight
        assert schedules._start_job("j1", job) is True  # free again after it ends
        await _settle()

    asyncio.run(main())


def test_concurrent_runs_are_capped(agent):
    async def main():
        for i in range(10):
            schedules._start_job(f"j{i}", {"id": f"j{i}", "name": f"n{i}", "message": "hi"})
        await _settle()
        assert agent.running == schedules._MAX_CONCURRENT_RUNS
        agent.release.set()
        for _ in range(20):
            await _settle()
            if agent.calls == 10:
                break

    asyncio.run(main())
    assert agent.calls == 10
    assert agent.peak <= schedules._MAX_CONCURRENT_RUNS
