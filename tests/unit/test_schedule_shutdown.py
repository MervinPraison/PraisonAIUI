"""A scheduled job stuck on a model call must not hold loop shutdown.

The auto-run used ``asyncio.to_thread``; closing the loop (``asyncio.run``,
each TestClient request, server shutdown) then joined the default executor
for up to 300 s, which hung the pytest gate after its summary.
"""

from __future__ import annotations

import asyncio
import threading
import time

import pytest

from praisonaiui.features import schedules


class _BlockingAgent:
    def __init__(self, release: threading.Event):
        self.release = release
        self.started = threading.Event()

    def chat(self, message):
        self.started.set()
        self.release.wait(30)
        return f"done: {message}"


@pytest.fixture
def blocking_agent(monkeypatch):
    release = threading.Event()
    agent = _BlockingAgent(release)

    async def _fake_get_agent(job_id, agent_name=None, session_id=None):
        return agent, None, None

    monkeypatch.setattr(schedules, "_get_agent_for_execution", _fake_get_agent)
    monkeypatch.setattr(schedules, "_get_schedule_store", lambda: object())
    yield agent
    release.set()


def test_loop_close_does_not_wait_for_a_stuck_job(blocking_agent):
    job = {"id": "j1", "name": "stuck", "message": "hi"}

    async def main():
        asyncio.get_running_loop().create_task(schedules._execute_job("j1", job))
        for _ in range(100):
            if blocking_agent.started.is_set():
                break
            await asyncio.sleep(0.01)

    t0 = time.monotonic()
    done = threading.Event()

    def _run():
        asyncio.run(main())
        done.set()

    threading.Thread(target=_run, daemon=True).start()
    assert done.wait(10), "asyncio.run() blocked on the scheduled job's thread"
    assert blocking_agent.started.is_set()
    assert time.monotonic() - t0 < 10


def test_daemon_call_returns_value_and_raises():
    async def main():
        ok = await schedules._call_in_daemon_thread(lambda x: x * 2, 21)

        def boom():
            raise ValueError("bad")

        with pytest.raises(ValueError):
            await schedules._call_in_daemon_thread(boom)
        return ok

    assert asyncio.run(main()) == 42
