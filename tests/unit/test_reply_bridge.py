"""The reply bridge: what a ``@aiui.reply`` handler sends reaches the chat.

* every message the handler sends (``aiui.Message(...).send()``,
  ``aiui.say``) is its own on the wire: its text carries a ``message_id``,
  a non-streamed message shows at once (WS ``run_content`` with ``content``),
  and the saved reply keeps the messages apart (``segments``);
* the final ``send()`` of a streamed message never repeats its text;
* typed elements (``add_image`` and the rest) and actions are delivered;
  ``update``, ``remove`` and ``Action.remove`` reach the chat as their own
  events, not as empty text.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import praisonaiui as aiui
from praisonaiui.provider import ReplyText, RunEventType


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features import guardrails

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")

    async def _no_guardrail(*_a, **_kw):
        return None

    monkeypatch.setattr(guardrails, "check_guardrails", _no_guardrail)
    monkeypatch.setattr(server, "_datastore", MemoryDataStore())
    monkeypatch.setattr(server, "_callbacks", dict(server._callbacks))
    prev = chat_mod._chat_manager
    chat_mod.set_chat_manager(chat_mod.ChatManager())
    yield
    chat_mod._chat_manager = prev


def _use_reply(monkeypatch, fn) -> None:
    import praisonaiui.server as server
    from praisonaiui.providers import PraisonAIProvider

    aiui.reply(fn)
    provider = PraisonAIProvider()
    monkeypatch.setattr(server, "get_provider", lambda: provider)


def _app() -> Starlette:
    import praisonaiui.server as server
    from praisonaiui.features.chat import ChatFeature

    routes = list(ChatFeature().routes())
    routes.append(Route("/run", server.run_agent, methods=["POST"]))
    return Starlette(routes=routes)


def _ws_turn(client: TestClient, session_id: str) -> List[Dict[str, Any]]:
    frames: List[Dict[str, Any]] = []
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "hi", "session_id": session_id})
        for _ in range(200):
            frame = ws.receive_json()
            frames.append(frame)
            if frame.get("type") in ("run_completed", "run_error", "run_cancelled"):
                return frames
    raise AssertionError(frames)


async def _several_messages(message):
    await aiui.Message(content="first message").send()
    await aiui.Message(content="second message", author="Helper").send()
    streamed = aiui.Message(content="")
    await streamed.stream_token("Hel")
    await streamed.stream_token("lo")
    await streamed.send()  # finalize: must not repeat "Hello"
    await aiui.say("said")


def _contents(frames: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [f for f in frames if f.get("type") == "run_content"]


def test_each_message_is_its_own_on_the_ws_and_shows_at_once(monkeypatch):
    _use_reply(monkeypatch, _several_messages)
    with TestClient(_app()) as client:
        frames = _ws_turn(client, "s-multi")
        content = _contents(frames)
        whole = [f for f in content if "content" in f]
        assert [f["content"] for f in whole] == ["first message", "second message", "said"]
        assert whole[1]["author"] == "Helper" and "author" not in whole[0]
        tokens = [f for f in content if "token" in f]
        assert "".join(f["token"] for f in tokens) == "Hello"
        ids = [whole[0]["message_id"], whole[1]["message_id"], tokens[0]["message_id"], whole[2]["message_id"]]
        assert len(set(ids)) == 4 and all(ids)
        assert {f["message_id"] for f in tokens} == {tokens[0]["message_id"]}
        done = frames[-1]
        assert done["type"] == "run_completed"
        assert done["content"] == "first message\n\nsecond message\n\nHello\n\nsaid"

        saved = client.get("/api/chat/history/s-multi").json()["messages"][-1]
        assert saved["content"] == done["content"]
        assert [s["text"] for s in saved["segments"]] == ["first message", "second message", "Hello", "said"]
        assert saved["segments"][1]["author"] == "Helper"


def test_sse_run_completed_does_not_repeat_a_streamed_message(monkeypatch):
    import json

    async def streamed(message):
        msg = aiui.Message(content="", streaming=True)
        await msg.send()
        await msg.stream_token("Hello")
        await msg.send()

    _use_reply(monkeypatch, streamed)
    with TestClient(_app()) as client:
        body = client.post("/run", json={"message": "hi", "session_id": "s-sse"}).text
        events = [json.loads(line[5:]) for line in body.splitlines() if line.startswith("data:")]
        (done,) = [e for e in events if e.get("type") == "run_completed"]
        assert done["content"] == "Hello"
        streamed_text = "".join(e.get("token", "") for e in events if e.get("type") == "run_content")
        assert streamed_text == "Hello"


async def _collect(fn: Callable) -> List[Any]:
    """The RunEvents callback mode makes of *fn*."""
    from praisonaiui.callbacks import _set_context
    from praisonaiui.providers import PraisonAIProvider

    async def wrapped(msg):
        _set_context(msg)
        await fn(msg)

    return [e async for e in PraisonAIProvider()._run_callback_mode("hi", wrapped, "s-x", None)]


@pytest.mark.asyncio
async def test_typed_elements_actions_update_and_remove_are_delivered():
    async def handler(_msg):
        msg = aiui.Message(content="Look:")
        msg.add_image(url="https://example.com/a.png", alt="A")
        msg.add_action(name="ok", label="OK", payload={"n": 1})
        await msg.send()
        await msg.update("Look again:")
        await msg.actions[0].remove()
        gone = aiui.Message(content="gone soon")
        await gone.send()
        await gone.remove()

    events = await _collect(handler)
    by_type: Dict[RunEventType, List[Any]] = {}
    for e in events:
        by_type.setdefault(e.type, []).append(e)
    first_id = by_type[RunEventType.RUN_CONTENT][0].message_id

    (element,) = {e.extra_data["element"]["url"]: e for e in by_type[RunEventType.MESSAGE_ELEMENT]}.values()
    assert element.message_id == first_id
    assert element.to_dict()["element"]["type"] == "image"
    assert element.to_dict()["element"]["alt"] == "A"

    (actions,) = by_type[RunEventType.MESSAGE_ACTIONS][:1]
    assert actions.message_id == first_id
    assert actions.extra_data["actions"][0]["name"] == "ok"
    assert actions.extra_data["actions"][0]["payload"] == {"n": 1}

    (update,) = by_type[RunEventType.MESSAGE_UPDATE]
    assert (update.message_id, update.content) == (first_id, "Look again:")
    (removed_action,) = by_type[RunEventType.ACTION_REMOVE]
    assert removed_action.extra_data["action_id"] == actions.extra_data["actions"][0]["id"]
    (removed,) = by_type[RunEventType.MESSAGE_REMOVE]
    assert removed.message_id == by_type[RunEventType.RUN_CONTENT][-1].message_id
    # Nothing turned into empty text, and the removed message left the reply.
    assert all(e.extra_data is None for e in by_type[RunEventType.RUN_CONTENT])
    assert events[-1].type == RunEventType.RUN_COMPLETED
    assert events[-1].content == "Look again:"


def test_ws_forwards_elements_actions_and_toast(monkeypatch):
    async def handler(_msg):
        await aiui.notify("Saved", type="success")
        msg = aiui.Message(content="Here")
        msg.add_image(url="https://example.com/b.png")
        msg.add_action(name="go", label="Go")
        await msg.send()

    _use_reply(monkeypatch, handler)
    with TestClient(_app()) as client:
        frames = _ws_turn(client, "s-els")
        mid = next(f["message_id"] for f in _contents(frames) if f.get("content") == "Here")
        (toast,) = [f for f in frames if f["type"] == "toast"]
        assert (toast["message"], toast["variant"]) == ("Saved", "success")
        (el,) = [f for f in frames if f["type"] == "message_element"]
        assert el["message_id"] == mid and el["element"]["url"] == "https://example.com/b.png"
        (acts,) = [f for f in frames if f["type"] == "message_actions"]
        assert acts["message_id"] == mid and acts["actions"][0]["label"] == "Go"


def test_reply_text_keeps_messages_apart():
    reply = ReplyText()
    a = reply.token("Hel")
    assert reply.token("lo") == a  # one anonymous stream
    assert reply.message("m2", "Two") is True
    b = reply.token("x")  # tokens after another message start a new one
    assert b != a
    assert reply.message("m2", "Two") is False  # the same text again changes nothing
    assert reply.text == "Hello\n\nTwo\n\nx"
    reply.remove("m2")
    assert reply.text == "Hello\n\nx"
    assert [s["text"] for s in reply.segments()] == ["Hello", "x"]
    single = ReplyText()
    single.token("only")
    assert single.segments() == []  # one plain message: nothing extra to save


def test_replay_does_not_merge_tokens_of_different_messages():
    from praisonaiui.features.chat import ChatManager

    mgr = ChatManager()
    mgr.start_run_replay("r1", "q", None)
    for mid, tok in (("a", "1"), ("a", "2"), ("b", "3")):
        mgr.record_run_event("r1", {"type": "run_content", "run_id": "r1", "token": tok, "message_id": mid})
    events = mgr._run_replay["r1"]["events"]
    assert [(e["message_id"], e["token"]) for e in events] == [("a", "12"), ("b", "3")]
