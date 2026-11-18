"""How a ``@reply`` run ends: one terminal event, saved errors, real Stop.

Regressions covered (callback mode, ``PraisonAIProvider._run_callback_mode``,
driven through the WS chat path ``_run_and_broadcast``):

* a raising ``@reply`` sent ``run_error`` and then ``run_completed``; the
  client and the run ledger read the late ``run_completed`` as success, and
  the error was never saved, so a reload showed an unanswered question;
* the exception was swallowed without a log line;
* Stop (``abort_run``) answered "aborted" while the callback kept running;
* a reply quiet for 60 s failed with "Timeout" (hard-coded), the callback
  kept running, and ``run_completed`` still followed.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

import pytest

from praisonaiui.provider import RunEvent, RunEventType

TERMINAL = {"run_completed", "run_error", "run_cancelled"}


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.providers import PraisonAIProvider

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("AIUI_REPLY_IDLE_TIMEOUT", raising=False)
    store = MemoryDataStore()
    for sid in ("s1", "s2", "s3", "s4", "s5", "s6", "s7"):
        asyncio.run(store.create_session(sid))
    monkeypatch.setattr(server, "_datastore", store)
    monkeypatch.setattr(server, "get_provider", lambda: PraisonAIProvider())
    monkeypatch.setattr(server, "_callbacks", dict(server._callbacks))
    monkeypatch.setattr(chat_mod, "_event_observers", [])
    prev_mgr = chat_mod._chat_manager
    chat_mod.set_chat_manager(chat_mod.ChatManager())
    yield store
    chat_mod._chat_manager = prev_mgr


class _FakeWS:
    def __init__(self) -> None:
        self.frames: List[Dict[str, Any]] = []

    async def send_text(self, data: str) -> None:
        import json

        self.frames.append(json.loads(data))


def _set_reply(fn) -> None:
    import praisonaiui.server as server

    server._callbacks["reply"] = fn


def _ws():
    from praisonaiui.features.chat import get_chat_manager

    ws = _FakeWS()
    get_chat_manager().add_ws_client("c1", ws)
    return ws


def _terminals(ws: _FakeWS) -> List[Dict[str, Any]]:
    return [f for f in ws.frames if f.get("type") in TERMINAL]


async def _assistant(store, sid: str) -> List[Dict[str, Any]]:
    return [m for m in await store.get_messages(sid) if m.get("role") == "assistant"]


# ── A failed reply ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_raising_reply_ends_with_one_run_error_and_is_saved(_isolated, caplog):
    from praisonaiui.features.chat import _run_and_broadcast

    async def reply(msg):
        raise RuntimeError("kaboom")

    _set_reply(reply)
    ws = _ws()
    with caplog.at_level(logging.ERROR):
        await _run_and_broadcast("hi", "s1", None)

    terminals = _terminals(ws)
    assert [f["type"] for f in terminals] == ["run_error"], terminals
    assert terminals[0]["error"] == "kaboom"
    saved = await _assistant(_isolated, "s1")
    assert len(saved) == 1
    assert saved[0]["status"] == "error" and saved[0]["error"] == "kaboom"
    assert any("reply callback failed" in r.getMessage() for r in caplog.records)
    assert any(r.exc_info for r in caplog.records), "no traceback logged"


@pytest.mark.asyncio
async def test_partial_reply_then_error_is_saved_as_error(_isolated):
    from praisonaiui.features.chat import _run_and_broadcast

    async def reply(msg):
        await msg.stream("partial answer ")
        raise RuntimeError("half")

    _set_reply(reply)
    ws = _ws()
    await _run_and_broadcast("hi", "s2", None)

    assert [f["type"] for f in _terminals(ws)] == ["run_error"]
    (saved,) = await _assistant(_isolated, "s2")
    assert saved["content"] == "partial answer "
    assert saved["status"] == "error" and saved["error"] == "half"


@pytest.mark.asyncio
async def test_successful_reply_still_completes_once(_isolated):
    from praisonaiui.features.chat import _run_and_broadcast

    async def reply(msg):
        await msg.stream("all ")
        await msg.stream("good")

    _set_reply(reply)
    ws = _ws()
    await _run_and_broadcast("hi", "s3", None)

    terminals = _terminals(ws)
    assert [f["type"] for f in terminals] == ["run_completed"]
    assert terminals[0]["content"] == "all good"
    (saved,) = await _assistant(_isolated, "s3")
    assert saved["content"] == "all good" and "status" not in saved


@pytest.mark.asyncio
async def test_provider_terminal_after_run_error_is_not_forwarded(_isolated, monkeypatch):
    """Any provider: a run_completed after run_error is dropped, not sent."""
    import praisonaiui.server as server
    from praisonaiui.features.chat import _run_and_broadcast

    class _ErrThenDone:
        async def run(self, message, **kw):
            yield RunEvent(type=RunEventType.RUN_CONTENT, token="x")
            yield RunEvent(type=RunEventType.RUN_ERROR, error="bad")
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content="")

    monkeypatch.setattr(server, "get_provider", lambda: _ErrThenDone())
    ws = _ws()
    await _run_and_broadcast("hi", "s4", "A")

    assert [f["type"] for f in _terminals(ws)] == ["run_error"]
    (saved,) = await _assistant(_isolated, "s4")
    assert saved["status"] == "error" and saved["error"] == "bad"


def test_ledger_keeps_the_first_terminal_status():
    from praisonaiui.features.run_ledger import RunLedger

    ledger = RunLedger()
    for ev in (
        {"type": "run_started", "run_id": "r1"},
        {"type": "run_error", "run_id": "r1", "error": "boom"},
        {"type": "run_completed", "run_id": "r1", "content": ""},
    ):
        ledger.observe("s1", ev)
    (run,) = [r for r in ledger.runs() if r["id"] == "r1"]
    assert run["status"] == "failed"
    assert run["error"] == "boom"


# ── Stop cancels the callback ────────────────────────────────────────


@pytest.mark.asyncio
async def test_abort_cancels_the_reply_callback(_isolated):
    from praisonaiui.features.chat import _run_and_broadcast, get_chat_manager

    state = {"ticks": 0, "cancelled": False}

    async def reply(msg):
        try:
            while True:
                state["ticks"] += 1
                await msg.stream(f"t{state['ticks']} ")
                await asyncio.sleep(0.01)
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    _set_reply(reply)
    ws = _ws()
    mgr = get_chat_manager()
    run = asyncio.create_task(_run_and_broadcast("go", "s5", None))
    for _ in range(300):
        if mgr._active_runs and state["ticks"] >= 3:
            break
        await asyncio.sleep(0.01)
    run_id = next(iter(mgr._active_runs))

    assert (await mgr.abort_run(run_id))["status"] == "aborted"
    await asyncio.wait({run}, timeout=2)
    ticks = state["ticks"]
    await asyncio.sleep(0.15)

    assert state["cancelled"], "the @reply callback was never cancelled"
    assert state["ticks"] == ticks, "the @reply callback kept running after Stop"
    assert [f["type"] for f in _terminals(ws)] == ["run_cancelled"]
    (saved,) = await _assistant(_isolated, "s5")
    assert saved["status"] == "cancelled"


# ── Inactivity timeout ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_idle_timeout_cancels_the_callback_and_ends_once(_isolated, monkeypatch):
    from praisonaiui.features.chat import _run_and_broadcast

    monkeypatch.setenv("AIUI_REPLY_IDLE_TIMEOUT", "0.2")
    state = {"cancelled": False, "late": False}

    async def reply(msg):
        try:
            await asyncio.sleep(1.0)
            state["late"] = True
            await msg.stream("too late")
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    _set_reply(reply)
    ws = _ws()
    await _run_and_broadcast("hi", "s6", None)
    await asyncio.sleep(0.05)

    terminals = _terminals(ws)
    assert [f["type"] for f in terminals] == ["run_error"], terminals
    assert terminals[0]["error"].startswith("Timeout")
    assert state["cancelled"] and not state["late"]
    (saved,) = await _assistant(_isolated, "s6")
    assert saved["status"] == "error"


@pytest.mark.asyncio
async def test_quiet_reply_under_the_timeout_is_delivered(_isolated, monkeypatch):
    from praisonaiui.features.chat import _run_and_broadcast

    monkeypatch.setenv("AIUI_REPLY_IDLE_TIMEOUT", "1")

    async def reply(msg):
        await asyncio.sleep(0.3)
        await msg.stream("finished thinking")

    _set_reply(reply)
    ws = _ws()
    await _run_and_broadcast("hi", "s7", None)
    terminals = _terminals(ws)
    assert [f["type"] for f in terminals] == ["run_completed"]
    assert terminals[0]["content"] == "finished thinking"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(None, 600.0), ("", 600.0), ("90", 90.0), ("0", None), ("-1", None), ("soon", 600.0)],
)
def test_reply_idle_timeout_setting(monkeypatch, raw, expected):
    from praisonaiui.providers import reply_idle_timeout

    if raw is None:
        monkeypatch.delenv("AIUI_REPLY_IDLE_TIMEOUT", raising=False)
    else:
        monkeypatch.setenv("AIUI_REPLY_IDLE_TIMEOUT", raw)
    assert reply_idle_timeout() == expected
