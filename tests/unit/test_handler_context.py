"""Handler context (context.session, user_session, chat_context, run_sync, notify)
through the real chat path: _run_and_broadcast -> callback mode -> @aiui.reply."""

from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List

import pytest

import praisonaiui as aiui


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    import praisonaiui.context as context
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.providers import PraisonAIProvider

    store = MemoryDataStore()
    monkeypatch.setattr(server, "_datastore", store)
    monkeypatch.setattr(server, "get_provider", lambda: PraisonAIProvider())
    monkeypatch.setattr(server, "_callbacks", dict(server._callbacks))
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


def _scope(headers: Dict[str, str], *, query: str = "", kind: str = "websocket", state=None):
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return {"type": kind, "query_string": query.encode(), "headers": raw, "state": state or {}}


async def _turn(text: str, sid: str, *, scope=None, frame=None) -> None:
    from praisonaiui.context import session_from_scope
    from praisonaiui.features.chat import _run_and_broadcast

    session = session_from_scope(scope, sid, frame) if scope is not None else None
    await _run_and_broadcast(text, sid, None, chat_session=session)


def _texts(ws: _FakeWS, sid: str) -> List[str]:
    return [f.get("token", "") for f in ws if f.get("session_id") == sid and f.get("token")]


@pytest.mark.asyncio
async def test_session_carries_user_client_language_and_safe_headers(monkeypatch):
    from praisonaiui import auth

    monkeypatch.setitem(auth._users, "ann", {"id": "ann", "password_hash": "x", "team": "red"})
    seen: Dict[str, Any] = {}

    @aiui.reply
    async def go(msg):
        s = aiui.context.session
        seen.update(id=s.id, user=s.user, client=s.client_type, lang=s.language,
                    profile=s.chat_profile, current=aiui.current_user(), headers=s.headers)

    headers = {"Origin": "http://x", "Accept-Language": "de;q=0.5, fr-CA, en;q=0.8",
               "Authorization": "Bearer t", "Cookie": "c=1", "X-Api-Key": "k", "User-Agent": "ua"}
    _ws()
    await _turn("hi", "s1", scope=_scope(headers, state={"user_id": "ann"}),
                frame={"chat_profile": "fast"})
    user = {"id": "ann", "team": "red"}
    assert seen == {"id": "s1", "user": user, "client": "webapp", "lang": "fr-CA",
                    "profile": "fast", "current": user,  # aiui.current_user() works on the web
                    "headers": {"origin": "http://x", "accept-language": headers["Accept-Language"],
                                "user-agent": "ua"}}


def test_client_type_and_language_rules():
    from praisonaiui.context import language_from, session_from_scope

    def client(headers, query="", kind="websocket"):
        return session_from_scope(_scope(headers, query=query, kind=kind), "x").client_type

    assert client({}, "client=copilot") == "copilot"
    assert client({"X-Aiui-Client": "Kiosk"}) == "kiosk"
    assert client({}) == "api"
    assert client({}, "client=<script>") == "api"
    assert client({"sec-fetch-mode": "cors"}, kind="http") == "webapp"
    assert language_from("") is None
    assert language_from("*, ja;q=0.9") == "ja"


@pytest.mark.asyncio
async def test_bot_runs_get_the_platform_as_client_type():
    from praisonaiui.features.platform_adapters._base import channel_context
    from praisonaiui.providers import PraisonAIProvider

    seen = {}

    @aiui.reply
    async def go(msg):
        seen.update(client=aiui.context.session.client_type, user=aiui.context.session.user)

    async with channel_context({"id": "C1", "platform": "slack"}, {"id": "U1"}):
        async for _ in PraisonAIProvider().run("hi", session_id="slack-1"):
            pass
    assert seen == {"client": "slack", "user": {"id": "U1"}}


@pytest.mark.asyncio
async def test_outside_a_handler():
    assert aiui.context.session is None
    assert aiui.user_session.get("k", 1) == 1 and aiui.chat_context.get() == []
    assert await aiui.notify("hi") is False
    with pytest.raises(RuntimeError):
        aiui.user_session.set("k", 2)
    with pytest.raises(RuntimeError):
        aiui.chat_context.add("x")
    with pytest.raises(ValueError):
        await aiui.notify("hi", type="loud")
    with pytest.raises(ValueError):
        await aiui.notify("hi", duration=0)


@pytest.mark.asyncio
async def test_concurrent_chats_never_see_each_others_data():
    @aiui.reply
    async def go(msg):
        aiui.user_session["name"] = msg.text
        aiui.user_session.set("turns", aiui.user_session.get("turns", 0) + 1)
        await asyncio.sleep(0.02)  # the other chat runs in between
        history = [m["content"] for m in aiui.chat_context.get() if m["role"] == "user"]
        await aiui.stream(f"{aiui.user_session['name']}|{aiui.user_session['turns']}|{history}")

    ws = _ws()
    await asyncio.gather(_turn("alice", "a"), _turn("bob", "b"))
    await asyncio.gather(_turn("alice2", "a"), _turn("bob2", "b"))

    assert _texts(ws, "a") == ["alice|1|['alice']", "alice2|2|['alice', 'alice2']"]
    assert _texts(ws, "b") == ["bob|1|['bob']", "bob2|2|['bob', 'bob2']"]


@pytest.mark.asyncio
async def test_chat_context_reloads_saved_history_and_records_replies(_isolated):
    store = _isolated
    await store.create_session("s9")
    await store.add_message("s9", {"role": "user", "content": "old question"})
    await store.add_message("s9", {"role": "assistant", "content": "old answer"})
    got: List[Any] = []

    @aiui.reply
    async def go(msg):
        got.append(aiui.chat_context.to_openai(system="Be brief."))
        await aiui.stream(f"re:{msg.text}")

    _ws()
    await _turn("q1", "s9")
    await _turn("q2", "s9")

    def m(role, content):
        return {"role": role, "content": content}

    assert got[0] == [m("system", "Be brief."), m("user", "old question"),
                      m("assistant", "old answer"), m("user", "q1")]
    assert got[1][-3:] == [m("user", "q1"), m("assistant", "re:q1"), m("user", "q2")]


def test_chat_context_edit_and_bounds():
    import contextvars

    import praisonaiui.context as context

    def body():
        context._session_var.set(context.ChatSession(id="e1"))
        cc = aiui.chat_context
        cc.add("hello", role="user")
        note = cc.add("note", role="system")
        assert len(cc.get()) == 2 and cc.remove(note) and not cc.remove(note)
        assert cc.to_openai(max_messages=1) == [{"role": "user", "content": "hello"}]
        cc.clear()
        assert cc.get() == []
        with pytest.raises(ValueError):
            cc.add({"role": "robot", "content": "x"})
        for i in range(context.MAX_HISTORY + 5):
            cc.add(str(i))
        assert len(cc.get()) == context.MAX_HISTORY

    contextvars.Context().run(body)


@pytest.mark.asyncio
async def test_profile_settings_and_env_stick_to_the_chat():
    seen: List[Any] = []
    keys = ("id", "chat_profile", "chat_settings", "env")

    @aiui.reply
    async def go(msg):
        seen.append({k: aiui.user_session.get(k) for k in keys})

    _ws()
    frame = {"chat_profile": "deep", "chat_settings": {"t": 0.2}, "env": {"REGION": "eu"}}
    await _turn("1", "p1", scope=_scope({}), frame=frame)
    await _turn("2", "p1", scope=_scope({}))
    await _turn("3", "p2", scope=_scope({}))
    assert seen[0] == seen[1] == {"id": "p1", **frame}
    assert seen[2] == {"id": "p2", "chat_profile": None, "chat_settings": {}, "env": {}}


@pytest.mark.asyncio
async def test_sync_worker_code_reaches_the_chat_through_run_sync():
    def blocking_tool(name: str) -> str:
        # Worker thread: talks to the UI and reads the chat's state.
        aiui.run_sync(aiui.stream(f"working for {name}"))
        return f"{aiui.context.session.id}:{aiui.user_session.get('who')}"

    pool = ThreadPoolExecutor(max_workers=1)  # a custom executor used to raise TypeError

    @aiui.reply
    async def go(msg):
        aiui.user_session["who"] = msg.text
        result = await aiui.make_async(blocking_tool, executor=pool)(msg.text)
        await aiui.stream(f"|{result}")

    ws = _ws()
    await _turn("zoe", "w1")
    pool.shutdown()
    assert "".join(_texts(ws, "w1")) == "working for zoe|w1:zoe"


@pytest.mark.asyncio
async def test_notify_reaches_the_client_and_is_not_saved(_isolated):
    @aiui.reply
    async def go(msg):
        assert await aiui.notify("Saved", type="success", duration=1500) is True
        await aiui.stream("done")

    await _isolated.create_session("t1")
    ws = _ws()
    await _turn("save it", "t1")
    toasts = [f for f in ws if f.get("type") == "toast"]
    assert [(t["message"], t["variant"], t["duration"]) for t in toasts] == [("Saved", "success", 1500)]
    assert toasts[0]["run_id"]
    saved = await _isolated.get_messages("t1")
    assert "Saved" not in str(saved) and "done" in str(saved)
