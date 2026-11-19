"""Chat lifecycle names (on_message, on_chat_start, on_chat_end, on_stop,
author_rename) through the real chat path, and the aiui.cache decorator."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Any, List

import pytest

import praisonaiui as aiui


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    import praisonaiui.context as context
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features import guardrails
    from praisonaiui.providers import PraisonAIProvider

    monkeypatch.setattr(guardrails, "check_guardrails", lambda *a, **k: asyncio.sleep(0))
    store = MemoryDataStore()
    monkeypatch.setattr(server, "_datastore", store)
    monkeypatch.setattr(server, "get_provider", lambda: PraisonAIProvider())
    monkeypatch.setattr(server, "_callbacks", {})
    monkeypatch.setattr(chat_mod, "_event_observers", [])
    monkeypatch.setattr(context, "_states", type(context._states)())
    prev_mgr = chat_mod._chat_manager
    chat_mod.set_chat_manager(chat_mod.ChatManager())
    yield store
    chat_mod._chat_manager = prev_mgr


class _FakeWS(list):  # a WS client that keeps the frames it is sent
    async def send_text(self, data: str) -> None:
        self.append(json.loads(data))


def _ws() -> _FakeWS:
    from praisonaiui.features.chat import get_chat_manager

    get_chat_manager().add_ws_client("c1", ws := _FakeWS())
    return ws


async def _turn(text: str, sid: str, agent: Any = None) -> None:
    from praisonaiui.context import ChatSession
    from praisonaiui.features.chat import _run_and_broadcast

    await _run_and_broadcast(text, sid, agent, chat_session=ChatSession(id=sid))


def _tokens(ws: _FakeWS, sid: str) -> List[str]:
    return [f.get("token") or f.get("content") or "" for f in ws
            if f.get("session_id") == sid and f.get("type") == "run_content"]


# ── names ────────────────────────────────────────────────────────────


def test_names_are_exported_and_share_their_handler_slots():
    import praisonaiui.server as server

    for name in ("on_message", "on_chat_start", "on_chat_end", "on_stop", "author_rename", "cache"):
        assert name in aiui.__all__ and callable(getattr(aiui, name))

    def stopped(): ...
    def ended(): ...

    assert aiui.on_stop(stopped) is stopped and aiui.on_chat_end(ended) is ended
    assert server._callbacks["cancel"].__wrapped__ is stopped
    assert server._callbacks["goodbye"].__wrapped__ is ended


@pytest.mark.asyncio
async def test_on_message_is_the_reply_handler():
    seen = []

    @aiui.on_message
    async def main(message):
        seen.append((message.content, aiui.context.session.id))
        await aiui.stream("ok")

    ws = _ws()
    await _turn("hello", "m1")
    assert seen == [("hello", "m1")] and _tokens(ws, "m1") == ["ok"]


# ── on_chat_start ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_start_runs_once_per_chat_before_the_first_reply():
    from praisonaiui.context import end_chat

    order: List[str] = []

    @aiui.on_chat_start
    async def start():
        order.append(f"start:{aiui.context.session.id}")
        aiui.user_session["agent"] = "built"
        await aiui.stream("Hi! ")

    @aiui.on_message
    async def main(message):
        order.append(f"reply:{aiui.user_session['agent']}")
        await aiui.stream("answer")

    ws = _ws()
    await _turn("q1", "a")
    await _turn("q2", "a")
    await _turn("q1", "b")
    assert order == ["start:a", "reply:built", "reply:built", "start:b", "reply:built"]
    assert _tokens(ws, "a")[:2] == ["Hi! ", "answer"]  # the greeting opens the first reply

    end_chat("a")  # after the chat ends, its next turn starts it again
    await _turn("q3", "a")
    assert order[-2:] == ["start:a", "reply:built"]


@pytest.mark.asyncio
async def test_chat_start_sync_handler_and_failure_is_retried():
    calls: List[int] = []

    @aiui.on_chat_start
    def start():  # a plain function works too
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("index missing")

    @aiui.on_message
    async def main(message):
        await aiui.stream("ok")

    ws = _ws()
    await _turn("q1", "f")
    errors = [f["error"] for f in ws if f.get("type") == "run_error"]
    assert errors == ["index missing"] and _tokens(ws, "f") == []
    await _turn("q2", "f")
    assert len(calls) == 2 and _tokens(ws, "f") == ["ok"]


# ── on_stop ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stop_runs_the_handler_as_the_stopped_chat():
    from praisonaiui.features.chat import get_chat_manager

    stopped: List[Any] = []
    started = asyncio.Event()

    @aiui.on_message
    async def main(message):
        aiui.user_session["job"] = "j-7"
        started.set()
        await asyncio.sleep(30)

    @aiui.on_stop
    def on_stop():
        stopped.append((aiui.context.session.id, aiui.user_session.get("job")))

    ws = _ws()
    run = asyncio.create_task(_turn("go", "s1"))
    await asyncio.wait_for(started.wait(), 2)
    run_id = next(f["run_id"] for f in ws if f.get("type") == "run_started")
    assert (await get_chat_manager().abort_run(run_id))["status"] == "aborted"
    await asyncio.wait_for(run, 5)
    assert stopped == [("s1", "j-7")]


# ── on_chat_end ──────────────────────────────────────────────────────


def test_chat_end_runs_when_the_last_connection_closes():
    from starlette.applications import Starlette
    from starlette.testclient import TestClient

    from praisonaiui.features.chat import ChatFeature

    ended: List[Any] = []
    done = threading.Event()
    starts: List[str] = []

    @aiui.on_chat_start
    def start():
        starts.append(aiui.context.session.id)

    @aiui.on_message
    async def main(message):
        aiui.user_session["temp"] = "/tmp/x"
        await aiui.stream("ok")

    @aiui.on_chat_end
    async def end():
        ended.append((aiui.context.session.id, aiui.user_session.get("temp")))
        done.set()

    with TestClient(Starlette(routes=list(ChatFeature().routes()))) as client:
        with client.websocket_connect("/api/chat/ws") as ws:
            ws.send_json({"type": "chat", "content": "hi", "session_id": "e1"})
            while ws.receive_json().get("type") != "run_completed":
                pass
            assert ended == []  # still connected
        assert done.wait(5)
        assert ended == [("e1", "/tmp/x")]
        with client.websocket_connect("/api/chat/ws") as ws:  # the chat starts again
            ws.send_json({"type": "chat", "content": "back", "session_id": "e1"})
            while ws.receive_json().get("type") != "run_completed":
                pass
    assert starts == ["e1", "e1"]


@pytest.mark.asyncio
async def test_chat_end_waits_for_a_running_reply_and_skips_connected_chats():
    from praisonaiui.features.chat import _end_chats, get_chat_manager

    mgr = get_chat_manager()
    log: List[str] = []
    release = asyncio.Event()

    @aiui.on_chat_end
    def end():
        log.append(f"end:{aiui.context.session.id}")

    async def reply():
        await release.wait()
        log.append("reply done")

    mgr._active_runs["r1"] = asyncio.create_task(reply())
    mgr._run_sessions["r1"] = "busy"
    mgr.add_ws_client("other", _FakeWS())
    mgr.note_client_session("other", "kept")

    ending = asyncio.create_task(_end_chats(mgr, ["busy", "kept"]))
    await asyncio.sleep(0.05)
    assert log == []
    release.set()
    await asyncio.wait_for(ending, 2)
    assert log == ["reply done", "end:busy"]


# ── author_rename ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_author_rename_applies_to_live_frames_and_saved_reply(_isolated):
    asked: List[str] = []

    @aiui.author_rename
    def rename(name: str) -> str:
        asked.append(name)
        return {"researcher": "Research assistant"}.get(name, name)

    @aiui.on_message
    async def main(message):
        await aiui.stream("a")
        await aiui.stream("b")

    ws = _ws()
    await _isolated.create_session("r1")
    await _turn("q", "r1", agent="researcher")
    names = {f["agent_name"] for f in ws if f.get("agent_name")}
    assert names == {"Research assistant"} and asked == ["researcher"]
    saved = await _isolated.get_messages("r1")
    assert [m.get("agent_name") for m in saved if m["role"] == "assistant"] == ["Research assistant"]


@pytest.mark.asyncio
async def test_author_rename_failure_keeps_the_name():
    @aiui.author_rename
    async def rename(name):
        raise ValueError("boom")

    ws = _ws()
    aiui.on_message(lambda message: None)
    await _turn("q", "r2", agent="writer")
    assert {f["agent_name"] for f in ws if f.get("agent_name")} == {"writer"}


# ── aiui.cache ───────────────────────────────────────────────────────


def test_cache_sync_keys_ttl_maxsize_and_clear(monkeypatch):
    import praisonaiui.utils as utils

    calls: List[Any] = []

    @aiui.cache
    def load(name, *, size=1):
        calls.append((name, size))
        return f"{name}:{size}"

    assert load("a") == load("a") == "a:1" and load("a", size=2) == "a:2"
    assert load(["x"]) == load(["x"])  # unhashable: keyed by repr
    assert len(calls) == 3 and load.__name__ == "load" and aiui.cache is utils.cache
    load.cache_clear()
    load("a")
    assert len(calls) == 4

    now = [100.0]
    monkeypatch.setattr(utils.time, "monotonic", lambda: now[0])
    hits: List[int] = []

    @aiui.cache(ttl=10, maxsize=2)
    def f(x):
        hits.append(x)
        return x

    f(1), f(2), f(1), f(3)  # 2 is the least recently used: dropped
    assert hits == [1, 2, 3]
    f(1), f(2)
    assert hits == [1, 2, 3, 2]
    now[0] += 11  # every entry expired
    f(1)
    assert hits == [1, 2, 3, 2, 1]

    with pytest.raises(ValueError):
        aiui.cache(ttl=0)
    with pytest.raises(ValueError):
        aiui.cache(maxsize=0)


def test_cache_sync_computes_once_across_threads_and_never_caches_errors():
    from concurrent.futures import ThreadPoolExecutor

    calls: List[int] = []

    @aiui.cache
    def slow(x):
        calls.append(x)
        time.sleep(0.1)
        return x * 2

    with ThreadPoolExecutor(8) as pool:
        assert list(pool.map(slow, [5] * 8)) == [10] * 8
    assert calls == [5]

    attempts: List[int] = []

    @aiui.cache
    def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("down")
        return "up"

    with pytest.raises(RuntimeError):
        flaky()
    assert flaky() == "up" and flaky() == "up" and len(attempts) == 2


@pytest.mark.asyncio
async def test_cache_async_shares_one_computation():
    calls: List[str] = []
    gate = asyncio.Event()

    @aiui.cache
    async def build(name):
        calls.append(name)
        await gate.wait()
        return {"model": name}

    waiters = [asyncio.create_task(build("m")) for _ in range(5)]
    await asyncio.sleep(0.01)
    waiters[0].cancel()  # one caller gives up: the computation goes on
    gate.set()
    results = await asyncio.gather(*waiters[1:])
    assert calls == ["m"] and all(r is results[0] for r in results)
    assert await build("m") is results[0] and calls == ["m"]
    build.cache_clear()
    await build("m")
    assert calls == ["m", "m"]

    attempts: List[int] = []

    @aiui.cache
    async def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("down")
        return "up"

    with pytest.raises(RuntimeError):
        await flaky()
    assert await flaky() == "up" and await flaky() == "up" and len(attempts) == 2

