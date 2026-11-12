"""WS chat protocol (``/api/chat/ws``) — wire contract for the React chat.

Covers the WP3 server fixes:

* exactly one ``run_started`` per run, carrying ``run_id`` and the agent name
  the provider resolved;
* ``references`` frames carry ``query`` and ``references``;
* approval ``run_paused`` frames forward ``extra_data`` and lift the approval
  fields (id, tool_name, arguments, risk_level, tool_call_id) to the top
  level, keeping ``question``/``options`` for old clients;
* per-client ``subscribe`` scoping with legacy fan-out for clients that never
  subscribe;
* ``chat_abort`` only from a client that owns the run's session;
* cancelled replies persist with ``status: "cancelled"``;
* the SSE ``/run`` stream is unchanged by any of this.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable, Dict, List, Optional

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

# ── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Isolate data dir, datastore, chat manager and guardrails per test."""
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features import guardrails

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AIUI_DISABLE_PLUGIN_AUTOLOAD", "1")

    async def _no_guardrail(*_a, **_kw):
        return None

    monkeypatch.setattr(guardrails, "check_guardrails", _no_guardrail)

    store = MemoryDataStore()
    monkeypatch.setattr(server, "_datastore", store)

    prev_mgr = chat_mod._chat_manager
    chat_mod.set_chat_manager(chat_mod.ChatManager())
    yield store
    chat_mod._chat_manager = prev_mgr


def _use_provider(monkeypatch, provider: BaseProvider) -> None:
    import praisonaiui.server as server

    monkeypatch.setattr(server, "get_provider", lambda: provider)


def _app() -> Starlette:
    import praisonaiui.server as server
    from praisonaiui.features.chat import ChatFeature

    routes = list(ChatFeature().routes())
    routes.append(Route("/run", server.run_agent, methods=["POST"]))
    return Starlette(routes=routes)


def _read_until(ws, pred: Callable[[Dict[str, Any]], bool], limit: int = 200) -> List[Dict]:
    """Receive frames until *pred* matches; return every frame read."""
    frames: List[Dict[str, Any]] = []
    for _ in range(limit):
        frame = ws.receive_json()
        frames.append(frame)
        if pred(frame):
            return frames
    raise AssertionError(f"predicate never matched in {limit} frames: {frames!r}")


def _turn_done(session_id: str) -> Callable[[Dict[str, Any]], bool]:
    terminal = {"run_completed", "run_error", "run_cancelled"}
    return lambda f: f.get("type") in terminal and f.get("session_id") == session_id


# ── Fake providers ───────────────────────────────────────────────────


class ProtocolProvider(BaseProvider):
    """Yields the event mix the WS route has to translate."""

    def __init__(self, resolved_name: Optional[str] = "Resolved Agent", gate_id: Any = None):
        self.resolved_name = resolved_name
        self.gate_tool_call_id = gate_id

    def resolve_agent_name(self, agent_name=None, session_id=None):
        return self.resolved_name

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Provider Name")
        yield RunEvent(
            type=RunEventType.REFERENCES,
            query=message,
            references=[{"name": "doc.md", "content": "lorem", "chunk": 0}],
            time_ms=12.5,
        )
        yield RunEvent(
            type=RunEventType.TOOL_CALL_STARTED,
            name="shell",
            args={"cmd": "ls"},
            tool_call_id="tc_1",
        )
        gate: Dict[str, Any] = {
            "type": "approval_required",
            "id": "ap_1",
            "tool_name": "shell",
            "arguments": {"cmd": "ls"},
            "risk_level": "high",
        }
        if self.gate_tool_call_id:
            gate["tool_call_id"] = self.gate_tool_call_id
        yield RunEvent(type=RunEventType.RUN_PAUSED, extra_data=gate)
        yield RunEvent(
            type=RunEventType.RUN_PAUSED,
            extra_data={"question": "Pick one", "options": ["A", "B"]},
        )
        yield RunEvent(
            type=RunEventType.TOOL_CALL_COMPLETED,
            name="shell",
            tool_call_id="tc_1",
            result="ok",
        )
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="Done.")
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Done.")


class NoResolverProvider(BaseProvider):
    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Provider Name")
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Provider Name")
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="hi")
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="hi")


class EchoProvider(BaseProvider):
    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(type=RunEventType.RUN_CONTENT, token=f"echo {message}")
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content=f"echo {message}")


class SlowProvider(BaseProvider):
    """Streams a partial reply, then waits until cancelled."""

    def __init__(self) -> None:
        self.release = asyncio.Event()

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="partial ")
        await asyncio.sleep(30)
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="partial reply")


# ── run_started / references / run_paused ────────────────────────────


def test_ws_turn_has_one_run_started_with_resolved_agent(monkeypatch):
    _use_provider(monkeypatch, ProtocolProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "find docs", "session_id": "s-proto"})
        frames = _read_until(ws, _turn_done("s-proto"))

    started = [f for f in frames if f["type"] == "run_started"]
    assert len(started) == 1, started
    assert started[0]["agent_name"] == "Resolved Agent"
    run_id = started[0]["run_id"]
    assert run_id
    # Every run-scoped frame carries the same run_id.
    assert all(f.get("run_id") == run_id for f in frames if f["type"] != "run_started")
    assert frames[-1]["type"] == "run_completed"


def test_ws_references_payload(monkeypatch):
    _use_provider(monkeypatch, ProtocolProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "find docs", "session_id": "s-refs"})
        frames = _read_until(ws, _turn_done("s-refs"))

    refs = [f for f in frames if f["type"] == "references"]
    assert len(refs) == 1
    assert refs[0]["query"] == "find docs"
    assert refs[0]["references"] == [{"name": "doc.md", "content": "lorem", "chunk": 0}]
    assert refs[0]["time_ms"] == 12.5


def test_ws_approval_pause_lifts_fields_and_infers_tool_call_id(monkeypatch):
    _use_provider(monkeypatch, ProtocolProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "run ls", "session_id": "s-gate"})
        frames = _read_until(ws, _turn_done("s-gate"))

    paused = [f for f in frames if f["type"] == "run_paused"]
    gate = next(f for f in paused if f.get("pause_type") == "approval_required")
    # extra_data is forwarded (plus the inferred tool_call_id).
    assert gate["extra_data"]["type"] == "approval_required"
    assert gate["extra_data"]["id"] == "ap_1"
    assert gate["extra_data"]["tool_name"] == "shell"
    assert gate["extra_data"]["tool_call_id"] == "tc_1"
    # Approval fields at the top level.
    assert gate["id"] == "ap_1"
    assert gate["approval_id"] == "ap_1"
    assert gate["tool_name"] == "shell"
    assert gate["arguments"] == {"cmd": "ls"}
    assert gate["risk_level"] == "high"
    assert gate["tool_call_id"] == "tc_1"
    # Old clients still get an ask-shaped prompt.
    assert gate["question"] == "The agent needs your input"
    assert gate["options"] == []


def test_ws_approval_keeps_provider_tool_call_id(monkeypatch):
    _use_provider(monkeypatch, ProtocolProvider(gate_id="tc_from_provider"))
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "run ls", "session_id": "s-gate2"})
        frames = _read_until(ws, _turn_done("s-gate2"))

    gate = next(f for f in frames if f.get("pause_type") == "approval_required")
    assert gate["tool_call_id"] == "tc_from_provider"
    assert gate["extra_data"]["tool_call_id"] == "tc_from_provider"


def test_ws_ask_pause_keeps_question_and_options(monkeypatch):
    _use_provider(monkeypatch, ProtocolProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "ask me", "session_id": "s-ask"})
        frames = _read_until(ws, _turn_done("s-ask"))

    ask = next(f for f in frames if f["type"] == "run_paused" and f.get("pause_type") == "ask")
    assert ask["question"] == "Pick one"
    assert ask["options"] == ["A", "B"]
    assert ask["extra_data"] == {"question": "Pick one", "options": ["A", "B"]}
    assert "tool_name" not in ask and "id" not in ask


def test_ws_without_resolver_keeps_requested_agent_and_one_run_started(monkeypatch):
    _use_provider(monkeypatch, NoResolverProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json(
            {"type": "chat", "content": "hi", "session_id": "s-nr", "agent_name": "Picked"}
        )
        frames = _read_until(ws, _turn_done("s-nr"))

    started = [f for f in frames if f["type"] == "run_started"]
    assert len(started) == 1
    assert started[0]["agent_name"] == "Picked"


def test_ws_without_agent_omits_agent_name(monkeypatch):
    _use_provider(monkeypatch, EchoProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "hi", "session_id": "s-anon"})
        frames = _read_until(ws, _turn_done("s-anon"))

    started = [f for f in frames if f["type"] == "run_started"]
    assert len(started) == 1
    assert "agent_name" not in started[0]


def test_failing_resolver_falls_back_to_requested_name(monkeypatch):
    class Boom(EchoProvider):
        def resolve_agent_name(self, agent_name=None, session_id=None):
            raise RuntimeError("no agents")

    _use_provider(monkeypatch, Boom())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "hi", "session_id": "s-b", "agent_name": "X"})
        frames = _read_until(ws, _turn_done("s-b"))

    started = [f for f in frames if f["type"] == "run_started"]
    assert len(started) == 1 and started[0]["agent_name"] == "X"
    assert frames[-1]["type"] == "run_completed"


# ── Subscriptions ────────────────────────────────────────────────────


def test_subscribe_scopes_delivery_and_legacy_clients_get_everything(monkeypatch):
    _use_provider(monkeypatch, EchoProvider())
    with TestClient(_app()) as client:
        with client.websocket_connect("/api/chat/ws") as scoped, client.websocket_connect(
            "/api/chat/ws"
        ) as legacy:
            scoped.send_json({"type": "subscribe", "session_ids": []})
            assert scoped.receive_json() == {"type": "subscribed", "session_ids": []}

            # A turn in s-other by the legacy client: the scoped client must
            # not see it, the legacy client does.
            legacy.send_json({"type": "chat", "content": "one", "session_id": "s-other"})
            legacy_frames = _read_until(legacy, _turn_done("s-other"))
            assert {f["session_id"] for f in legacy_frames} == {"s-other"}

            # Now a turn by the scoped client in its own session.
            scoped.send_json({"type": "chat", "content": "two", "session_id": "s-mine"})
            scoped_frames = _read_until(scoped, _turn_done("s-mine"))
            assert {f["session_id"] for f in scoped_frames} == {"s-mine"}, scoped_frames

            # The legacy client still receives the scoped client's session.
            more = _read_until(legacy, _turn_done("s-mine"))
            assert {f["session_id"] for f in more} == {"s-mine"}

            # Subscribing to s-other opts the scoped client into it.
            scoped.send_json({"type": "subscribe", "session_ids": ["s-other"]})
            assert scoped.receive_json() == {"type": "subscribed", "session_ids": ["s-other"]}
            legacy.send_json({"type": "chat", "content": "three", "session_id": "s-other"})
            _read_until(legacy, _turn_done("s-other"))
            seen = _read_until(scoped, _turn_done("s-other"))
            assert {f["session_id"] for f in seen} == {"s-other"}

            # Unsubscribe: acknowledged with the remaining set.
            scoped.send_json({"type": "unsubscribe", "session_ids": ["s-other"]})
            assert scoped.receive_json() == {"type": "subscribed", "session_ids": []}

            # Ping still works and nothing from s-other leaks in between.
            legacy.send_json({"type": "chat", "content": "four", "session_id": "s-other"})
            _read_until(legacy, _turn_done("s-other"))
            scoped.send_json({"type": "ping"})
            assert scoped.receive_json() == {"type": "pong"}


class _FakeWS:
    def __init__(self) -> None:
        self.frames: List[Dict[str, Any]] = []

    async def send_text(self, data: str) -> None:
        self.frames.append(json.loads(data))


class _DeadWS:
    async def send_text(self, data: str) -> None:
        raise RuntimeError("socket closed")


@pytest.mark.asyncio
async def test_broadcast_filtering_unit():
    from praisonaiui.features.chat import ChatManager

    mgr = ChatManager()
    legacy, scoped, dead = _FakeWS(), _FakeWS(), _DeadWS()
    mgr.add_ws_client("legacy", legacy)
    mgr.add_ws_client("scoped", scoped)
    mgr.add_ws_client("dead", dead)
    assert mgr.subscribe("scoped", ["s1", "", 42, "x" * 1000]) == ["s1"]
    assert mgr.is_scoped("scoped") and not mgr.is_scoped("legacy")

    await mgr.broadcast("s1", {"type": "a", "session_id": "s1"})
    await mgr.broadcast("s2", {"type": "b", "session_id": "s2"})
    await mgr.broadcast("", {"type": "global"})

    assert [f["type"] for f in legacy.frames] == ["a", "b", "global"]
    assert [f["type"] for f in scoped.frames] == ["a", "global"]
    # A client whose send fails is dropped entirely, including its scoping.
    assert "dead" not in mgr._ws_clients

    mgr.note_client_session("scoped", "s2")
    await mgr.broadcast("s2", {"type": "c", "session_id": "s2"})
    assert [f["type"] for f in scoped.frames] == ["a", "global", "c"]
    assert mgr.client_owns_session("scoped", "s2")
    assert mgr.client_owns_session("scoped", "s1")
    assert not mgr.client_owns_session("legacy", "s1")

    mgr.remove_ws_client("scoped")
    assert "scoped" not in mgr._ws_subscriptions
    assert "scoped" not in mgr._ws_sent_sessions


def test_subscription_cap():
    from praisonaiui.features.chat import MAX_SUBSCRIPTIONS_PER_CLIENT, ChatManager

    mgr = ChatManager()
    ids = [f"s{i}" for i in range(MAX_SUBSCRIPTIONS_PER_CLIENT + 10)]
    assert len(mgr.subscribe("c", ids)) == MAX_SUBSCRIPTIONS_PER_CLIENT
    # A single string is accepted as one id.
    mgr2 = ChatManager()
    assert mgr2.subscribe("c", "solo") == ["solo"]
    assert mgr2.subscribe("c", None) == ["solo"]


# ── chat_abort ownership + cancelled status ──────────────────────────


def test_chat_abort_requires_session_ownership_and_persists_cancelled(monkeypatch, _isolated):
    store = _isolated
    _use_provider(monkeypatch, SlowProvider())
    with TestClient(_app()) as client:
        with client.websocket_connect("/api/chat/ws") as owner, client.websocket_connect(
            "/api/chat/ws"
        ) as other:
            owner.send_json({"type": "subscribe", "session_ids": []})
            owner.receive_json()
            owner.send_json({"type": "chat", "content": "long job", "session_id": "s-slow"})
            frames = _read_until(
                owner, lambda f: f.get("type") == "run_content" and f.get("token")
            )
            run_id = next(f["run_id"] for f in frames if f["type"] == "run_started")

            # A client that neither started nor subscribed to s-slow cannot stop it.
            other.send_json({"type": "chat_abort", "run_id": run_id})
            reply = _read_until(other, lambda f: f.get("type") == "chat_abort_result")[-1]
            assert reply["status"] == "forbidden"
            assert reply["run_id"] == run_id
            from praisonaiui.features.chat import get_chat_manager

            assert run_id in get_chat_manager()._active_runs

            # Unknown run ids answer no_active_run, as before.
            other.send_json({"type": "chat_abort", "run_id": "nope"})
            reply = _read_until(other, lambda f: f.get("type") == "chat_abort_result")[-1]
            assert reply == {"type": "chat_abort_result", "status": "no_active_run", "run_id": "nope"}

            # Subscribing grants ownership.
            other.send_json({"type": "subscribe", "session_ids": ["s-slow"]})
            _read_until(other, lambda f: f.get("type") == "subscribed")
            other.send_json({"type": "chat_abort", "run_id": run_id})
            reply = _read_until(other, lambda f: f.get("type") == "chat_abort_result")[-1]
            assert reply["status"] == "aborted"

            cancelled = _read_until(owner, _turn_done("s-slow"))[-1]
            assert cancelled["type"] == "run_cancelled"
            assert cancelled["run_id"] == run_id

        history = client.get("/api/chat/history/s-slow").json()["messages"]

    assistant = [m for m in history if m["role"] == "assistant"]
    assert len(assistant) == 1
    assert assistant[0]["content"] == "partial "
    assert assistant[0]["status"] == "cancelled"
    assert asyncio.run(store.get_messages("s-slow"))[-1]["status"] == "cancelled"


def test_owner_can_abort_its_own_run(monkeypatch):
    _use_provider(monkeypatch, SlowProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "long", "session_id": "s-own"})
        frames = _read_until(ws, lambda f: f.get("type") == "run_started")
        ws.send_json({"type": "chat_abort", "run_id": frames[-1]["run_id"]})
        rest = _read_until(ws, lambda f: f.get("type") == "chat_abort_result")
        assert rest[-1]["status"] == "aborted"
        _read_until(ws, _turn_done("s-own"))


def test_completed_reply_has_no_status(monkeypatch, _isolated):
    store = _isolated
    _use_provider(monkeypatch, EchoProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "hi", "session_id": "s-ok"})
        _read_until(ws, _turn_done("s-ok"))
    msgs = asyncio.run(store.get_messages("s-ok"))
    assert msgs[-1]["role"] == "assistant"
    assert "status" not in msgs[-1]


@pytest.mark.asyncio
async def test_provider_run_cancelled_marks_message_cancelled(monkeypatch, _isolated):
    import praisonaiui.server as server
    from praisonaiui.features.chat import _run_and_broadcast, get_chat_manager

    class CancelsItself(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            yield RunEvent(type=RunEventType.RUN_CONTENT, token="half")
            yield RunEvent(type=RunEventType.RUN_CANCELLED)
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content="half")

    monkeypatch.setattr(server, "get_provider", lambda: CancelsItself())
    ws = _FakeWS()
    mgr = get_chat_manager()
    mgr.add_ws_client("c", ws)
    await _isolated.create_session("s-pc")
    await _run_and_broadcast("hi", "s-pc", None, None)

    assert [f["type"] for f in ws.frames].count("run_started") == 1
    msgs = await _isolated.get_messages("s-pc")
    assert msgs[-1]["status"] == "cancelled"
    assert mgr._history["s-pc"][-1].to_dict()["status"] == "cancelled"
    assert mgr._run_sessions == {}


# ── SSE /run is unchanged ────────────────────────────────────────────


def test_sse_run_stream_unchanged(monkeypatch):
    from praisonaiui.features import knowledge

    def _no_knowledge():
        raise RuntimeError("knowledge disabled in test")

    monkeypatch.setattr(knowledge, "get_knowledge_manager", _no_knowledge)
    _use_provider(monkeypatch, ProtocolProvider())
    with TestClient(_app()) as client:
        resp = client.post("/run", json={"message": "find docs", "session_id": "s-sse"})
        assert resp.status_code == 200
        frames = [
            json.loads(line[5:].strip())
            for line in resp.text.splitlines()
            if line.startswith("data:")
        ]

    types = [f["type"] for f in frames]
    assert types[0] == "session"
    # SSE forwards the provider's own run_started untouched (no run_id added).
    started = [f for f in frames if f["type"] == "run_started"]
    assert len(started) == 1
    assert started[0]["agent_name"] == "Provider Name"
    assert "run_id" not in started[0]
    refs = next(f for f in frames if f["type"] == "references")
    assert refs["query"] == "find docs" and refs["references"][0]["name"] == "doc.md"
    gate = next(
        f
        for f in frames
        if f["type"] == "run_paused" and (f.get("extra_data") or {}).get("type") == "approval_required"
    )
    # The SSE shape is RunEvent.to_dict(): approval data lives in extra_data
    # only; the WS-only top-level fields are not added here.
    assert gate["extra_data"]["id"] == "ap_1"
    assert "pause_type" not in gate and "tool_name" not in gate
    assert "run_completed" in types


# ── providers/__init__.py: tool_call_id on approvals, agent naming ───


def test_hook_approval_includes_tool_call_id_when_known(monkeypatch):
    from types import SimpleNamespace

    from praisonaiui import providers

    monkeypatch.setattr(providers, "_request_tool_approval", lambda **kw: "ap_9")

    with_id = SimpleNamespace(tool_name="execute_command", arguments={"c": 1}, tool_call_id="call_7")
    events = providers._hook_event_to_run_events("before_tool", with_id)
    gate = next(e for e in events if e.type == RunEventType.RUN_PAUSED)
    assert gate.extra_data["tool_call_id"] == "call_7"
    assert gate.extra_data["id"] == "ap_9"
    started = next(e for e in events if e.type == RunEventType.TOOL_CALL_STARTED)
    assert started.tool_call_id == "call_7"

    without_id = SimpleNamespace(tool_name="execute_command", arguments={"c": 1})
    events = providers._hook_event_to_run_events("before_tool", without_id)
    gate = next(e for e in events if e.type == RunEventType.RUN_PAUSED)
    assert "tool_call_id" not in gate.extra_data


def test_fill_approval_tool_call_id_from_pending_stream_call():
    from praisonaiui import providers

    pending = {
        "call_a": RunEvent(type=RunEventType.TOOL_CALL_STARTED, name="bash", tool_call_id="call_a"),
        "read_file": RunEvent(type=RunEventType.TOOL_CALL_STARTED, name="read_file"),
        "call_b": RunEvent(type=RunEventType.TOOL_CALL_STARTED, name="bash", tool_call_id="call_b"),
    }
    gate = RunEvent(
        type=RunEventType.RUN_PAUSED,
        extra_data={"type": "approval_required", "id": "ap", "tool_name": "bash"},
    )
    providers._fill_approval_tool_call_id(gate, pending)
    assert gate.extra_data["tool_call_id"] == "call_b"  # newest pending call

    known = RunEvent(
        type=RunEventType.RUN_PAUSED,
        extra_data={"type": "approval_required", "tool_name": "bash", "tool_call_id": "x"},
    )
    providers._fill_approval_tool_call_id(known, pending)
    assert known.extra_data["tool_call_id"] == "x"

    ask = RunEvent(type=RunEventType.RUN_PAUSED, extra_data={"question": "?"})
    providers._fill_approval_tool_call_id(ask, pending)
    assert "tool_call_id" not in ask.extra_data

    nameless = RunEvent(
        type=RunEventType.RUN_PAUSED,
        extra_data={"type": "approval_required", "tool_name": "read_file"},
    )
    providers._fill_approval_tool_call_id(nameless, pending)
    assert "tool_call_id" not in nameless.extra_data


def test_praisonai_provider_resolve_agent_name(monkeypatch):
    from types import SimpleNamespace

    import praisonaiui.server as server
    from praisonaiui.providers import PraisonAIProvider

    monkeypatch.setattr(server, "_callbacks", {})
    provider = PraisonAIProvider(agent=SimpleNamespace(name="Configured"))
    assert provider.resolve_agent_name(agent_name=None, session_id="s") == "Configured"
    assert provider.resolve_agent_name(agent_name="Asked", session_id="s") == "Configured"

    # Callback mode (@aiui.reply) answers with the requested name and never
    # builds an agent.
    monkeypatch.setattr(server, "_callbacks", {"reply": lambda msg: None})
    called = []
    monkeypatch.setattr(provider, "_get_or_create_agent", lambda *a, **k: called.append(1))
    assert provider.resolve_agent_name(agent_name="Asked", session_id="s") == "Asked"
    assert called == []
