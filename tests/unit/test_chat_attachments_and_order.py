"""Attachments on every transport, and answers saved after their questions.

Regressions covered:

* ``POST /run`` (the chat's fallback when the WebSocket cannot open) ignored
  ``attachment_ids``: the reply never saw the file while the UI showed it.
* An image sent to a ``@reply`` app was dropped: the callback had no way to
  see it (``message.attachments`` did not exist).
* Two runs in one session (a reload mid-reply, a second tab) saved history
  as Q1, Q2, A2, A1, because a reply is saved when its run ends.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from praisonaiui.provider import BaseProvider, RunEvent, RunEventType


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import attachments as att_mod
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features import guardrails

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))

    async def _no_guardrail(*_a, **_kw):
        return None

    monkeypatch.setattr(guardrails, "check_guardrails", _no_guardrail)
    monkeypatch.setattr(server, "_datastore", MemoryDataStore())
    monkeypatch.setattr(server, "_callbacks", dict(server._callbacks))
    monkeypatch.setattr(
        att_mod, "_attachment_manager", att_mod.AttachmentManager(storage_dir=str(tmp_path / "att"))
    )
    prev = chat_mod._chat_manager
    chat_mod.set_chat_manager(chat_mod.ChatManager())
    yield
    chat_mod._chat_manager = prev


def _upload(data: bytes, name: str, content_type: str) -> str:
    from praisonaiui.features.attachments import get_attachment_manager

    return get_attachment_manager().upload(data, name, content_type)["id"]


def _app() -> Starlette:
    import praisonaiui.server as server
    from praisonaiui.features.chat import ChatFeature

    routes = list(ChatFeature().routes())
    routes.append(Route("/run", server.run_agent, methods=["POST"]))
    return Starlette(routes=routes)


class _Recorder(BaseProvider):
    """Records what each run was given."""

    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        self.calls.append({"message": message, **kw})
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="A")
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="ok")
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="ok")


# ── /run reads attachment_ids ────────────────────────────────────────


def test_http_run_includes_attached_text_and_images(monkeypatch):
    import praisonaiui.server as server

    rec = _Recorder()
    monkeypatch.setattr(server, "get_provider", lambda: rec)
    note = _upload(b"hello file body", "note.txt", "text/plain")
    image = _upload(b"\x89PNG\r\n", "chart.png", "image/png")

    with TestClient(_app()) as client:
        r = client.post(
            "/run",
            json={"message": "summarize the file", "session_id": "s-http", "attachment_ids": [note, image]},
        )
        assert r.status_code == 200
        history = client.get("/api/chat/history/s-http").json()["messages"]

    (call,) = rec.calls
    assert "--- Attached File: note.txt ---" in call["message"]
    assert "hello file body" in call["message"]
    assert call["message"].endswith("summarize the file")
    assert len(call["attachments"]) == 1 and call["attachments"][0].endswith(".png")
    (question,) = [m for m in history if m["role"] == "user"]
    assert [a["name"] for a in question["attachments"]] == ["note.txt", "chart.png"]
    # The /run reply is tied to its question, as over the WebSocket.
    (answer,) = [m for m in history if m["role"] == "assistant"]
    assert question["turn_id"] and answer["reply_to"] == question["turn_id"]


# ── @reply sees message.attachments ──────────────────────────────────


def _reply_seeing_files(seen: list):
    async def on_reply(message):
        seen.append(list(message.attachments))
        await message.stream("done")

    return on_reply


def test_reply_callback_sees_an_image_over_the_websocket(monkeypatch):
    import praisonaiui.server as server
    from praisonaiui.providers import PraisonAIProvider

    seen: list = []
    server._callbacks["reply"] = _reply_seeing_files(seen)
    monkeypatch.setattr(server, "get_provider", lambda: PraisonAIProvider())
    image = _upload(b"\x89PNG\r\n", "chart.png", "image/png")

    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json(
            {"type": "chat", "content": "describe img", "session_id": "s-img", "attachment_ids": [image]}
        )
        for _ in range(50):
            if ws.receive_json().get("type") in ("run_completed", "run_error"):
                break

    (files,) = seen
    assert [(f["id"], f["name"], f["content_type"]) for f in files] == [(image, "chart.png", "image/png")]
    assert files[0]["path"].endswith(".png")


def test_reply_callback_sees_files_over_http_run(monkeypatch):
    import praisonaiui.server as server
    from praisonaiui.providers import PraisonAIProvider

    seen: list = []
    server._callbacks["reply"] = _reply_seeing_files(seen)
    monkeypatch.setattr(server, "get_provider", lambda: PraisonAIProvider())
    image = _upload(b"\x89PNG\r\n", "chart.png", "image/png")

    with TestClient(_app()) as client:
        client.post("/run", json={"message": "x", "session_id": "s-h", "attachment_ids": [image]})

    assert [f["name"] for f in seen[0]] == ["chart.png"]


def test_message_context_has_no_files_by_default():
    from praisonaiui.server import MessageContext

    assert MessageContext("hi").attachments == []


# ── Answers after their own questions ────────────────────────────────


class _SlowThenQuick(BaseProvider):
    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="A")
        if "slow" in message:
            await asyncio.sleep(0.4)
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content=f"answer to {message}")


def test_concurrent_runs_in_one_session_save_answers_after_their_questions(monkeypatch):
    import praisonaiui.server as server

    monkeypatch.setattr(server, "get_provider", lambda: _SlowThenQuick())
    terminal = {"run_completed", "run_error", "run_cancelled"}
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "slow one", "session_id": "s-two"})
        ws.send_json({"type": "chat", "content": "quick two", "session_id": "s-two"})
        done = 0
        for _ in range(50):
            if ws.receive_json().get("type") in terminal:
                done += 1
                if done == 2:
                    break
        history = client.get("/api/chat/history/s-two").json()["messages"]

    assert [(m["role"], m["content"]) for m in history] == [
        ("user", "slow one"),
        ("assistant", "answer to slow one"),
        ("user", "quick two"),
        ("assistant", "answer to quick two"),
    ]


def test_visible_history_order_and_regenerate():
    from praisonaiui.features.chat import visible_history

    saved = [
        {"role": "user", "content": "old q"},  # older history: no turn ids
        {"role": "assistant", "content": "old a"},
        {"role": "user", "content": "q1", "turn_id": "t1"},
        {"role": "user", "content": "q2", "turn_id": "t2"},
        {"role": "assistant", "content": "a2", "reply_to": "t2"},
        {"role": "assistant", "content": "a1", "reply_to": "t1"},
        {"role": "assistant", "content": "a2 again", "reply_to": "t2", "regenerates": True},
    ]
    assert [m["content"] for m in visible_history(saved)] == [
        "old q",
        "old a",
        "q1",
        "a1",
        "q2",
        "a2 again",
    ]
