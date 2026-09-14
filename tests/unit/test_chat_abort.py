"""Tests for chat run abort / cancellation (issue #274).

Regression coverage for the wiring bug where ``ChatManager._active_runs`` was
never populated, so ``abort_run`` (Stop button / ``POST /api/chat/abort`` /
``chat_abort`` WS) always returned ``no_active_run`` even while a run was
streaming.
"""

from __future__ import annotations

import asyncio

import pytest

from praisonaiui.provider import RunEvent, RunEventType

# ── Unit: abort_run against the _active_runs registry ────────────────


@pytest.mark.asyncio
async def test_abort_cancels_active_run():
    from praisonaiui.features.chat import ChatManager

    mgr = ChatManager()
    run_id = "test-run"

    async def slow_run():
        await asyncio.sleep(60)

    task = asyncio.create_task(slow_run())
    mgr._active_runs[run_id] = task

    result = await mgr.abort_run(run_id)

    assert result["status"] == "aborted"
    assert result["run_id"] == run_id
    # Give the event loop a tick to process the cancellation.
    await asyncio.sleep(0)
    assert task.cancelled() or task.done()
    # Registry entry removed on abort.
    assert run_id not in mgr._active_runs


@pytest.mark.asyncio
async def test_abort_unknown_run_returns_no_active_run():
    from praisonaiui.features.chat import ChatManager

    mgr = ChatManager()
    result = await mgr.abort_run("does-not-exist")
    assert result["status"] == "no_active_run"
    assert result["run_id"] == "does-not-exist"


# ── Integration: _run_and_broadcast registers + aborts cleanly ───────


class _FakeWS:
    """Collects broadcast frames pushed by ChatManager.broadcast."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_text(self, data: str) -> None:
        import json

        self.messages.append(json.loads(data))


class _SlowProvider:
    """Streams a couple of tokens then hangs, keeping the run active."""

    async def run(self, content, *, session_id=None, agent_name=None, **kwargs):
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="hello ")
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="world")
        # Simulate a long generation so the run stays registered.
        await asyncio.sleep(60)
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="hello world")


class _FakeDatastore:
    async def add_message(self, *args, **kwargs):
        return None


@pytest.mark.asyncio
async def test_run_and_broadcast_registers_and_aborts(monkeypatch):
    import praisonaiui.server as server
    from praisonaiui.features.chat import ChatManager, _run_and_broadcast, set_chat_manager

    mgr = ChatManager()
    set_chat_manager(mgr)
    ws = _FakeWS()
    mgr.add_ws_client("c1", ws)

    monkeypatch.setattr(server, "get_provider", lambda: _SlowProvider())
    monkeypatch.setattr(server, "_datastore", _FakeDatastore())

    task = asyncio.create_task(_run_and_broadcast("hi", "sess-1", "Agent", None))

    # Wait until the run is registered (populated by _run_and_broadcast).
    for _ in range(100):
        if mgr._active_runs:
            break
        await asyncio.sleep(0.01)
    assert mgr._active_runs, "run was never registered in _active_runs"

    run_id = next(iter(mgr._active_runs))

    # Frontend contract: a run_started frame is broadcast with the run_id.
    started = [m for m in ws.messages if m.get("type") == "run_started"]
    assert started and started[0]["run_id"] == run_id

    # Abort the active run.
    result = await mgr.abort_run(run_id)
    assert result["status"] == "aborted"

    # Let the cancellation propagate and _run_and_broadcast finish.
    await asyncio.sleep(0.05)

    # Clients receive a run_cancelled frame, and the registry is cleaned up.
    cancelled = [m for m in ws.messages if m.get("type") == "run_cancelled"]
    assert cancelled and cancelled[0]["run_id"] == run_id
    assert run_id not in mgr._active_runs
    assert task.done()


@pytest.mark.asyncio
async def test_run_and_broadcast_cleans_up_on_normal_completion(monkeypatch):
    import praisonaiui.server as server
    from praisonaiui.features.chat import ChatManager, _run_and_broadcast, set_chat_manager

    class _QuickProvider:
        async def run(self, content, *, session_id=None, agent_name=None, **kwargs):
            yield RunEvent(type=RunEventType.RUN_CONTENT, token="done")
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content="done")

    mgr = ChatManager()
    set_chat_manager(mgr)
    monkeypatch.setattr(server, "get_provider", lambda: _QuickProvider())
    monkeypatch.setattr(server, "_datastore", _FakeDatastore())

    await _run_and_broadcast("hi", "sess-2", None, None)

    # No leftover registry entries after a normal run.
    assert mgr._active_runs == {}
