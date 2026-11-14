"""WS chat protocol (``/api/chat/ws``) — wire contract for the React chat.

Covers the WP3 server fixes:

* exactly one ``run_started`` per run, carrying ``run_id`` and the agent name
  (from ``resolve_agent_name``, else the provider's own first
  ``run_started``, else the requested name); a later run_started only when
  the agent changes mid-run or its name arrives after the grace window;
* ``references`` frames carry ``query`` and ``references``;
* approval ``run_paused`` frames forward ``extra_data`` and lift the approval
  fields (id, tool_name, arguments, risk_level, tool_call_id) to the top
  level, keeping ``question``/``options`` for old clients;
* per-client ``subscribe`` scoping with legacy fan-out for clients that never
  subscribe;
* ``chat_abort`` / ``ask_response`` (and ``POST /api/chat/abort``) only from
  the connection that started a turn in the run's session, or from anyone
  when no connected client started one there (reconnect, HTTP); subscribing
  never grants control;
* the per-client caps drop the oldest entry, never the session in use;
* malformed frames get ``protocol_error`` and keep the socket open;
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


def test_ws_without_resolver_uses_provider_name_over_requested(monkeypatch, _isolated):
    # The provider reports who actually answers; the client's pick is only
    # the fallback. Still exactly one run_started.
    store = _isolated
    _use_provider(monkeypatch, NoResolverProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json(
            {"type": "chat", "content": "hi", "session_id": "s-nr", "agent_name": "Picked"}
        )
        frames = _read_until(ws, _turn_done("s-nr"))

    started = [f for f in frames if f["type"] == "run_started"]
    assert len(started) == 1, started
    assert started[0]["agent_name"] == "Provider Name"
    assert asyncio.run(store.get_messages("s-nr"))[-1]["agent_name"] == "Provider Name"


def test_ws_requested_agent_kept_when_provider_names_none(monkeypatch, _isolated):
    store = _isolated
    _use_provider(monkeypatch, EchoProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json(
            {"type": "chat", "content": "hi", "session_id": "s-req", "agent_name": "Picked"}
        )
        frames = _read_until(ws, _turn_done("s-req"))

    started = [f for f in frames if f["type"] == "run_started"]
    assert len(started) == 1, started
    assert started[0]["agent_name"] == "Picked"
    assert asyncio.run(store.get_messages("s-req"))[-1]["agent_name"] == "Picked"


def test_provider_named_agent_without_resolver(monkeypatch, _isolated):
    # Regression: providers without ``resolve_agent_name`` (the public
    # BaseProvider API, examples/python/07, the spike mock) name their agent
    # on their own run_started. That name must reach WS clients on the
    # single run_started and be persisted with the reply.
    store = _isolated
    _use_provider(monkeypatch, NoResolverProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "hi", "session_id": "s-pn"})
        frames = _read_until(ws, _turn_done("s-pn"))

    started = [f for f in frames if f["type"] == "run_started"]
    assert len(started) == 1, started
    assert started[0]["agent_name"] == "Provider Name"
    assert started[0]["run_id"] == frames[-1]["run_id"]
    msgs = asyncio.run(store.get_messages("s-pn"))
    assert msgs[-1]["role"] == "assistant"
    assert msgs[-1]["agent_name"] == "Provider Name"
    from praisonaiui.features.chat import get_chat_manager

    assert get_chat_manager()._history["s-pn"][-1].agent_name == "Provider Name"


class _NamedStreamProvider(BaseProvider):
    """Mimics PraisonAIProvider: run_started per LLM request and per agent hook."""

    def __init__(self, resolver_name: Optional[str] = None) -> None:
        self.resolver_name = resolver_name

    def resolve_agent_name(self, agent_name=None, session_id=None):
        return self.resolver_name

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Lead")
        yield RunEvent(type=RunEventType.RUN_STARTED)  # REQUEST_START, unnamed
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Lead")  # before_agent
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="a")
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Researcher")  # handoff
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Researcher")
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="b")
        yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Lead")  # back
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="ab")


@pytest.mark.parametrize("resolver_name", [None, "Lead"])
def test_mid_run_agent_switch_is_forwarded(monkeypatch, _isolated, resolver_name):
    # Regression: suppressing the provider's duplicate run_started also hid
    # sub-agent / handoff switches. Repeats and unnamed starts stay hidden;
    # a change of agent is forwarded with the same run_id.
    store = _isolated
    _use_provider(monkeypatch, _NamedStreamProvider(resolver_name))
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "go", "session_id": "s-sw"})
        frames = _read_until(ws, _turn_done("s-sw"))

    started = [f for f in frames if f["type"] == "run_started"]
    assert [f.get("agent_name") for f in started] == ["Lead", "Researcher", "Lead"]
    assert len({f["run_id"] for f in frames}) == 1
    order = [f["type"] if f["type"] != "run_started" else f["agent_name"] for f in frames]
    assert order == ["Lead", "run_content", "Researcher", "run_content", "Lead", "run_completed"]
    # The reply is persisted under the agent that started the turn.
    assert asyncio.run(store.get_messages("s-sw"))[-1]["agent_name"] == "Lead"


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


@pytest.mark.asyncio
async def test_slow_first_event_does_not_delay_run_started(monkeypatch, _isolated):
    import praisonaiui.server as server
    from praisonaiui.features import chat as chat_mod

    gen_closed = asyncio.Event()

    class SlowStart(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            try:
                await asyncio.sleep(30)
                yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Late")
            finally:
                gen_closed.set()

    monkeypatch.setattr(server, "get_provider", lambda: SlowStart())
    ws = _FakeWS()
    mgr = chat_mod.get_chat_manager()
    mgr.add_ws_client("c", ws)
    task = asyncio.ensure_future(chat_mod._run_and_broadcast("hi", "s-slowstart", None, None))
    await asyncio.sleep(chat_mod.FIRST_EVENT_GRACE_S + 0.25)
    started = [f for f in ws.frames if f["type"] == "run_started"]
    assert len(started) == 1 and "agent_name" not in started[0]
    run_id = started[0]["run_id"]
    assert (await mgr.abort_run(run_id))["status"] == "aborted"
    await asyncio.wait_for(task, 5)
    assert ws.frames[-1]["type"] == "run_cancelled"
    assert ws.frames[-1]["run_id"] == run_id
    # The provider's pending first step was cancelled, not leaked.
    await asyncio.wait_for(gen_closed.wait(), 5)
    assert mgr._active_runs == {} and mgr._run_sessions == {}


@pytest.mark.asyncio
async def test_aborted_during_grace_cancels_first_step(monkeypatch, _isolated):
    import praisonaiui.server as server
    from praisonaiui.features import chat as chat_mod

    monkeypatch.setattr(chat_mod, "FIRST_EVENT_GRACE_S", 30)
    gen_closed = asyncio.Event()

    class Hangs(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            try:
                await asyncio.sleep(60)
                yield RunEvent(type=RunEventType.RUN_STARTED)
            finally:
                gen_closed.set()

    monkeypatch.setattr(server, "get_provider", lambda: Hangs())
    ws = _FakeWS()
    mgr = chat_mod.get_chat_manager()
    mgr.add_ws_client("c", ws)
    task = asyncio.ensure_future(chat_mod._run_and_broadcast("hi", "s-hang", None, None))
    await asyncio.sleep(0.1)
    (run_id,) = list(mgr._active_runs)
    assert (await mgr.abort_run(run_id))["status"] == "aborted"
    await asyncio.wait_for(task, 5)
    await asyncio.wait_for(gen_closed.wait(), 5)
    assert [f["type"] for f in ws.frames] == ["run_cancelled"]
    assert mgr._active_runs == {} and mgr._run_sessions == {}


@pytest.mark.asyncio
async def test_late_provider_name_is_forwarded_once(monkeypatch, _isolated):
    import praisonaiui.server as server
    from praisonaiui.features import chat as chat_mod

    monkeypatch.setattr(chat_mod, "FIRST_EVENT_GRACE_S", 0.01)

    class LateName(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            await asyncio.sleep(0.2)
            yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Late")
            yield RunEvent(type=RunEventType.RUN_STARTED, agent_name="Late")
            yield RunEvent(type=RunEventType.RUN_CONTENT, token="x")
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content="x")

    monkeypatch.setattr(server, "get_provider", lambda: LateName())
    ws = _FakeWS()
    chat_mod.get_chat_manager().add_ws_client("c", ws)
    await _isolated.create_session("s-late")
    await chat_mod._run_and_broadcast("hi", "s-late", None, None)

    started = [f for f in ws.frames if f["type"] == "run_started"]
    # Announced on time without a name, then the name once it is known.
    assert [f.get("agent_name") for f in started] == [None, "Late"]
    assert started[0]["run_id"] == started[1]["run_id"]
    assert (await _isolated.get_messages("s-late"))[-1]["agent_name"] == "Late"


@pytest.mark.asyncio
async def test_provider_error_on_first_event_reports_run_error(monkeypatch, _isolated):
    import praisonaiui.server as server
    from praisonaiui.features import chat as chat_mod

    class FailsAtOnce(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            raise RuntimeError("provider down")
            yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(server, "get_provider", lambda: FailsAtOnce())
    ws = _FakeWS()
    mgr = chat_mod.get_chat_manager()
    mgr.add_ws_client("c", ws)
    await chat_mod._run_and_broadcast("hi", "s-fail", None, None)
    assert [f["type"] for f in ws.frames] == ["run_started", "run_error"]
    assert ws.frames[-1]["error"] == "provider down"
    assert ws.frames[-1]["run_id"] == ws.frames[0]["run_id"]
    assert mgr._active_runs == {} and mgr._run_sessions == {}


@pytest.mark.asyncio
async def test_empty_provider_run(monkeypatch, _isolated):
    import praisonaiui.server as server
    from praisonaiui.features import chat as chat_mod

    class Empty(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            return
            yield  # pragma: no cover

    monkeypatch.setattr(server, "get_provider", lambda: Empty())
    ws = _FakeWS()
    mgr = chat_mod.get_chat_manager()
    mgr.add_ws_client("c", ws)
    await chat_mod._run_and_broadcast("hi", "s-empty", None, None)
    assert [f["type"] for f in ws.frames] == ["run_started"]
    assert mgr._active_runs == {} and mgr._run_sessions == {}


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
    subs = mgr.subscribe("c", ids)
    assert len(subs) == MAX_SUBSCRIPTIONS_PER_CLIENT
    # The cap drops the least recent ids, never the newest ones.
    assert ids[-1] in subs and ids[0] not in subs
    mgr.subscribe("c", ["fresh"])
    assert mgr.client_owns_session("c", "fresh")
    assert not mgr.client_owns_session("c", ids[10])
    assert len(mgr._ws_subscriptions["c"]) == MAX_SUBSCRIPTIONS_PER_CLIENT
    # A single string is accepted as one id.
    mgr2 = ChatManager()
    assert mgr2.subscribe("c", "solo") == ["solo"]
    assert mgr2.subscribe("c", None) == ["solo"]


@pytest.mark.asyncio
async def test_scoped_sender_past_the_cap_still_gets_its_turn(monkeypatch):
    # Regression: past MAX sessions a scoped client's new sessions were not
    # recorded, so its own turn's events never reached it and it could not
    # stop the run.
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features.chat import MAX_SUBSCRIPTIONS_PER_CLIENT, ChatManager, _ws_abort

    mgr = ChatManager()
    ws = _FakeWS()
    mgr.add_ws_client("tab", ws)
    mgr.add_ws_client("other", _FakeWS())
    mgr.subscribe("tab", [])
    # The oldest session still has a run in progress: it is evicted last.
    mgr.note_client_session("tab", "s0")
    mgr._run_sessions["run-old"] = "s0"
    for i in range(1, MAX_SUBSCRIPTIONS_PER_CLIENT + 1):
        mgr.note_client_session("tab", f"s{i}")
    newest = f"s{MAX_SUBSCRIPTIONS_PER_CLIENT}"

    await mgr.broadcast(newest, {"type": "run_content", "session_id": newest})
    assert ws.frames == [{"type": "run_content", "session_id": newest}]
    assert mgr.client_owns_session("tab", newest)
    assert mgr.client_owns_session("tab", "s0")  # running: kept
    assert not mgr.client_owns_session("tab", "s1")  # oldest idle: dropped
    assert len(mgr._ws_sent_sessions["tab"]) == MAX_SUBSCRIPTIONS_PER_CLIENT

    async def _forever():
        await asyncio.sleep(30)

    task = asyncio.ensure_future(_forever())
    mgr._active_runs["run-new"] = task
    mgr._run_sessions["run-new"] = newest
    monkeypatch.setattr(chat_mod, "get_chat_manager", lambda: mgr)
    assert (await _ws_abort(mgr, "other", "run-new"))["status"] == "forbidden"
    assert (await _ws_abort(mgr, "tab", "run-new"))["status"] == "aborted"
    await asyncio.sleep(0)
    assert task.cancelled()


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

            # Subscribing grants delivery, never control (security review:
            # any client can subscribe to any session id it knows).
            other.send_json({"type": "subscribe", "session_ids": ["s-slow"]})
            _read_until(other, lambda f: f.get("type") == "subscribed")
            other.send_json({"type": "chat_abort", "run_id": run_id})
            reply = _read_until(other, lambda f: f.get("type") == "chat_abort_result")[-1]
            assert reply["status"] == "forbidden"
            # Nor can the REST endpoint be used to go around the rule.
            rest = client.post("/api/chat/abort", json={"run_id": run_id})
            assert rest.status_code == 403 and rest.json()["status"] == "forbidden"
            assert run_id in get_chat_manager()._active_runs

            owner.send_json({"type": "chat_abort", "run_id": run_id})
            reply = _read_until(owner, lambda f: f.get("type") == "chat_abort_result")[-1]
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


def test_legacy_observer_cannot_abort_a_connected_owners_run(monkeypatch):
    _use_provider(monkeypatch, SlowProvider())
    with TestClient(_app()) as client:
        with client.websocket_connect("/api/chat/ws") as owner, client.websocket_connect(
            "/api/chat/ws"
        ) as observer:
            owner.send_json({"type": "chat", "content": "long", "session_id": "s-lo"})
            run_id = _read_until(owner, lambda f: f.get("type") == "run_started")[-1]["run_id"]
            # The legacy observer sees the run (unscoped fan-out) ...
            seen = _read_until(observer, lambda f: f.get("type") == "run_started")
            assert seen[-1]["run_id"] == run_id
            # ... but may not stop it while its owner is connected.
            observer.send_json({"type": "chat_abort", "run_id": run_id})
            reply = _read_until(observer, lambda f: f.get("type") == "chat_abort_result")[-1]
            assert reply["status"] == "forbidden"
            owner.send_json({"type": "chat_abort", "run_id": run_id})
            reply = _read_until(owner, lambda f: f.get("type") == "chat_abort_result")[-1]
            assert reply["status"] == "aborted"


def test_reconnected_tab_can_stop_its_orphaned_run(monkeypatch):
    # Regression: a dashboard tab whose socket reconnected mid-run (a new
    # connection, so not the owner) could no longer Stop its own run.
    _use_provider(monkeypatch, SlowProvider())
    from praisonaiui.features.chat import get_chat_manager

    with TestClient(_app()) as client:
        with client.websocket_connect("/api/chat/ws") as first:
            first.send_json({"type": "chat", "content": "long", "session_id": "s-re"})
            run_id = _read_until(first, lambda f: f.get("type") == "run_started")[-1]["run_id"]
        # The first connection is gone; the run keeps going.
        assert run_id in get_chat_manager()._active_runs
        with client.websocket_connect("/api/chat/ws") as again:
            again.send_json({"type": "chat_abort", "run_id": run_id})
            reply = _read_until(again, lambda f: f.get("type") == "chat_abort_result")[-1]
            assert reply["status"] == "aborted"
            assert _read_until(again, _turn_done("s-re"))[-1]["type"] == "run_cancelled"


def test_http_started_run_can_be_stopped_over_ws(monkeypatch):
    # Regression: a turn sent via POST /api/chat/send (the HTTP fallback)
    # has no WS owner; it must stay stoppable over WS, as before.
    _use_provider(monkeypatch, SlowProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        resp = client.post("/api/chat/send", json={"content": "long", "session_id": "s-http"})
        assert resp.status_code == 200
        run_id = _read_until(ws, lambda f: f.get("type") == "run_started")[-1]["run_id"]
        ws.send_json({"type": "chat_abort", "run_id": run_id})
        reply = _read_until(ws, lambda f: f.get("type") == "chat_abort_result")[-1]
        assert reply["status"] == "aborted"
        _read_until(ws, _turn_done("s-http"))


class _AskProvider(SlowProvider):
    def __init__(self) -> None:
        super().__init__()
        self.answers: List[tuple] = []

    async def submit_ask_response(self, session_id, run_id, response):
        self.answers.append((session_id, run_id, response))


def test_http_abort_of_orphaned_or_http_run_still_works(monkeypatch):
    _use_provider(monkeypatch, SlowProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        client.post("/api/chat/send", json={"content": "long", "session_id": "s-h2"})
        run_id = _read_until(ws, lambda f: f.get("type") == "run_started")[-1]["run_id"]
        resp = client.post("/api/chat/abort", json={"run_id": run_id})
        assert resp.status_code == 200 and resp.json()["status"] == "aborted"
        _read_until(ws, _turn_done("s-h2"))
        assert client.post("/api/chat/abort", json=["x"]).status_code == 400


def test_subscribing_does_not_let_a_client_answer_another_tabs_ask(monkeypatch):
    provider = _AskProvider()
    _use_provider(monkeypatch, provider)
    with TestClient(_app()) as client:
        with client.websocket_connect("/api/chat/ws") as owner, client.websocket_connect(
            "/api/chat/ws"
        ) as other:
            owner.send_json({"type": "chat", "content": "long", "session_id": "s-ask3"})
            run_id = _read_until(owner, lambda f: f.get("type") == "run_started")[-1]["run_id"]
            other.send_json({"type": "subscribe", "session_ids": ["s-ask3"]})
            _read_until(other, lambda f: f.get("type") == "subscribed")
            other.send_json(
                {"type": "ask_response", "session_id": "s-ask3", "run_id": run_id, "response": "B"}
            )
            ack = _read_until(other, lambda f: f.get("type") == "ask_response_ack")[-1]
            assert ack["status"] == "forbidden"
            assert provider.answers == []


def test_ask_response_requires_session_ownership(monkeypatch):
    provider = _AskProvider()
    _use_provider(monkeypatch, provider)
    with TestClient(_app()) as client:
        with client.websocket_connect("/api/chat/ws") as owner, client.websocket_connect(
            "/api/chat/ws"
        ) as other:
            owner.send_json({"type": "chat", "content": "long", "session_id": "s-ask2"})
            run_id = _read_until(owner, lambda f: f.get("type") == "run_started")[-1]["run_id"]

            # Another connected client cannot answer it, even by naming its
            # own session alongside the live run id.
            for sid in ("s-ask2", "s-mine"):
                other.send_json(
                    {"type": "ask_response", "session_id": sid, "run_id": run_id, "response": "B"}
                )
                ack = _read_until(other, lambda f: f.get("type") == "ask_response_ack")[-1]
                assert ack["status"] == "forbidden"
            assert provider.answers == []

            owner.send_json(
                {"type": "ask_response", "session_id": "s-ask2", "run_id": run_id, "response": "A"}
            )
            ack = _read_until(owner, lambda f: f.get("type") == "ask_response_ack")[-1]
            assert ack["status"] == "received"
            assert provider.answers == [("s-ask2", run_id, "A")]

            # A session nobody connected owns can be answered (reconnect).
            other.send_json(
                {"type": "ask_response", "session_id": "s-free", "run_id": "", "response": 7}
            )
            ack = _read_until(other, lambda f: f.get("type") == "ask_response_ack")[-1]
            assert ack["status"] == "received"
            assert provider.answers[-1] == ("s-free", "", "7")

            owner.send_json({"type": "chat_abort", "run_id": run_id})
            _read_until(owner, _turn_done("s-ask2"))


def test_malformed_frames_keep_the_socket_open(monkeypatch):
    # Regression: a non-object or non-JSON frame closed the socket (and with
    # it every live turn of that client).
    _use_provider(monkeypatch, EchoProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        for bad in ("[1, 2]", "not json", "42", '"text"', "null"):
            ws.send_text(bad)
            frame = ws.receive_json()
            assert frame["type"] == "protocol_error", (bad, frame)
            assert frame["error"]
        ws.send_bytes(b"\xff\xfe")
        assert ws.receive_json()["type"] == "protocol_error"
        ws.send_bytes(b'{"type": "ping"}')
        assert ws.receive_json() == {"type": "pong"}
        ws.send_json({"type": "chat", "content": ["not", "a", "string"]})
        assert ws.receive_json()["type"] == "protocol_error"
        ws.send_json({"type": "chat_abort", "run_id": {"x": 1}})
        assert ws.receive_json()["status"] == "no_active_run"
        # A non-string session id gets a fresh one instead of breaking.
        ws.send_json({"type": "chat", "content": "hi", "session_id": 123})
        frames = _read_until(ws, lambda f: f.get("type") == "run_completed")
        sids = {f["session_id"] for f in frames}
        assert len(sids) == 1 and isinstance(sids.pop(), str)
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


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


def test_praisonai_provider_resolver_never_builds_an_agent(monkeypatch):
    # Regression: resolve_agent_name built the session's agent (tool
    # resolution, model client) on the event loop before run_started, which
    # held back the run id and the Stop button on a session's first turn.
    from types import SimpleNamespace

    import praisonaiui.server as server
    from praisonaiui.features import agents as agents_feature
    from praisonaiui.providers import PraisonAIProvider

    monkeypatch.setattr(server, "_callbacks", {})
    monkeypatch.setattr(server, "_agents", {})
    registry = SimpleNamespace(list_all=lambda: [{"name": "Researcher", "instructions": "x"}])
    monkeypatch.setattr(agents_feature, "get_agent_registry", lambda: registry)

    def _no_build(*_a, **_k):
        raise AssertionError("resolve_agent_name must not build an agent")

    provider = PraisonAIProvider()
    monkeypatch.setattr(provider, "_create_session_agent", _no_build)
    assert provider.resolve_agent_name(agent_name=None, session_id="s") == "Assistant"
    assert provider.resolve_agent_name(agent_name="Researcher", session_id="s") == "Researcher"
    assert provider.resolve_agent_name(agent_name="Nobody", session_id="s") == "Assistant"

    named = PraisonAIProvider(name="Bot")
    monkeypatch.setattr(named, "_create_session_agent", _no_build)
    assert named.resolve_agent_name(agent_name="Researcher", session_id="s") == "Bot"

    # An agent already cached for the session answers with its own name.
    provider._session_agents["s2:"] = SimpleNamespace(name="Cached")
    assert provider.resolve_agent_name(agent_name=None, session_id="s2") == "Cached"

    # Without praisonaiagents, run() echoes unnamed: keep the requested name.
    import importlib.util
    import sys

    monkeypatch.setitem(sys.modules, "praisonaiagents", None)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name, *a: None)
    assert provider.resolve_agent_name(agent_name=None, session_id="s3") is None
    assert provider.resolve_agent_name(agent_name="Asked", session_id="s3") == "Asked"


def test_praisonai_provider_predicted_name_matches_built_agent(monkeypatch):
    # The cheap prediction must name the agent exactly as the build does.
    import sys
    from types import ModuleType, SimpleNamespace

    import praisonaiui.server as server
    from praisonaiui.features import agents as agents_feature
    from praisonaiui.providers import PraisonAIProvider

    class FakeAgent:
        def __init__(self, **kwargs):
            self.name = kwargs.get("name")
            self.stream_emitter = None

    fake = ModuleType("praisonaiagents")
    fake.Agent = FakeAgent
    monkeypatch.setitem(sys.modules, "praisonaiagents", fake)
    monkeypatch.setitem(sys.modules, "praisonaiagents.tools", None)
    monkeypatch.setitem(sys.modules, "praisonai.tool_resolver", None)
    monkeypatch.setattr(server, "_callbacks", {})
    monkeypatch.setattr(server, "_agents", {})
    registry = SimpleNamespace(list_all=lambda: [{"name": "Researcher", "model": "m"}])
    monkeypatch.setattr(agents_feature, "get_agent_registry", lambda: registry)

    for kwargs, requested in [
        ({}, None),
        ({}, "Researcher"),
        ({}, "Nobody"),
        ({"name": "Bot"}, "Researcher"),
    ]:
        provider = PraisonAIProvider(**kwargs)
        predicted = provider.resolve_agent_name(agent_name=requested, session_id="s")
        built = provider._get_or_create_agent(requested, "s")
        assert predicted == built.name, (kwargs, requested)
        # Once built (cached), the resolver reports the cached agent.
        assert provider.resolve_agent_name(agent_name=requested, session_id="s") == built.name


# ── Round-1 robustness: turn correlation, run_status, error status, ─────
# ── regenerate, history paging ─────────────────────────────────────────


class _ErrorProvider(BaseProvider):
    """Streams part of a reply, then fails."""

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        for i in range(3):
            yield RunEvent(type=RunEventType.RUN_CONTENT, token=f"part{i} ")
        raise RuntimeError("provider exploded")


class _CountingEcho(BaseProvider):
    """Answers each message with a numbered echo; supports rewind_last_turn."""

    def __init__(self) -> None:
        self.calls = 0
        self.rewinds: List[tuple] = []

    def rewind_last_turn(self, agent_name=None, session_id=None):
        self.rewinds.append((session_id, agent_name))
        return True

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        self.calls += 1
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(type=RunEventType.RUN_CONTENT, token=f"answer {self.calls}")
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content=f"answer {self.calls}")


def test_two_clients_on_one_session_each_get_their_own_run_started(monkeypatch):
    """Tab B's chat while tab A's run streams: run_started echoes each
    sender's client_turn_id, so B can tell its run from A's."""
    _use_provider(monkeypatch, SlowProvider())
    with TestClient(_app()) as client:
        with client.websocket_connect("/api/chat/ws") as a, client.websocket_connect(
            "/api/chat/ws"
        ) as b:
            for ws in (a, b):
                ws.send_json({"type": "subscribe", "session_ids": ["s-two"]})
                _read_until(ws, lambda f: f.get("type") == "subscribed")
            a.send_json({"type": "chat", "content": "one", "session_id": "s-two", "client_turn_id": "ta"})
            run_a = _read_until(a, lambda f: f.get("type") == "run_started")[-1]
            assert run_a["client_turn_id"] == "ta"
            # B sees A's run (it watches the session) ...
            seen = _read_until(b, lambda f: f.get("type") == "run_started")[-1]
            assert seen["run_id"] == run_a["run_id"] and seen["client_turn_id"] == "ta"
            b.send_json({"type": "chat", "content": "two", "session_id": "s-two", "client_turn_id": "tb"})
            run_b = _read_until(
                b, lambda f: f.get("type") == "run_started" and f.get("client_turn_id") == "tb"
            )[-1]
            assert run_b["run_id"] != run_a["run_id"]
            # ... and B's Stop names its own run, which it may stop; A's it may not.
            b.send_json({"type": "chat_abort", "run_id": run_b["run_id"]})
            assert _read_until(b, lambda f: f.get("type") == "chat_abort_result")[-1]["status"] == "aborted"
            a.send_json({"type": "chat_abort", "run_id": run_a["run_id"]})
            assert _read_until(a, lambda f: f.get("type") == "chat_abort_result")[-1]["status"] == "aborted"


def test_every_event_of_a_run_carries_its_client_turn_id(monkeypatch):
    """A tab that joins mid-run never sees that run's run_started, so each
    event names its turn too."""
    _use_provider(monkeypatch, ProtocolProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "x", "session_id": "s-every", "client_turn_id": "t1"})
        frames = _read_until(ws, _turn_done("s-every"))
    run_frames = [f for f in frames if f.get("run_id")]
    assert len(run_frames) > 3
    assert all(f.get("client_turn_id") == "t1" for f in run_frames), run_frames


def test_client_turn_id_is_optional_and_bounded(monkeypatch):
    _use_provider(monkeypatch, EchoProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "x", "session_id": "s-ct"})
        started = _read_until(ws, lambda f: f.get("type") == "run_started")[-1]
        assert "client_turn_id" not in started
        _read_until(ws, _turn_done("s-ct"))
        ws.send_json({"type": "chat", "content": "y", "session_id": "s-ct", "client_turn_id": "z" * 500})
        started = _read_until(ws, lambda f: f.get("type") == "run_started")[-1]
        assert "client_turn_id" not in started


def test_run_status_reports_live_and_unknown_runs(monkeypatch):
    _use_provider(monkeypatch, SlowProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "long", "session_id": "s-rs"})
        run_id = _read_until(ws, lambda f: f.get("type") == "run_started")[-1]["run_id"]
        ws.send_json({"type": "run_status", "run_id": run_id})
        reply = _read_until(ws, lambda f: f.get("type") == "run_status")[-1]
        assert reply == {"type": "run_status", "run_id": run_id, "session_id": "s-rs", "active": True}
        ws.send_json({"type": "run_status", "run_id": "gone-with-old-process"})
        reply = _read_until(ws, lambda f: f.get("type") == "run_status")[-1]
        assert reply["active"] is False and reply["session_id"] is None
        ws.send_json({"type": "chat_abort", "run_id": run_id})
        _read_until(ws, _turn_done("s-rs"))


def test_ws_reply_cut_by_provider_error_is_saved_with_error_status(monkeypatch, _isolated):
    store = _isolated
    _use_provider(monkeypatch, _ErrorProvider())
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "error please", "session_id": "s-err"})
        assert _read_until(ws, _turn_done("s-err"))[-1]["type"] == "run_error"
        history = client.get("/api/chat/history/s-err").json()["messages"]
    reply = [m for m in history if m["role"] == "assistant"][-1]
    assert reply["content"] == "part0 part1 part2 "
    assert reply["status"] == "error" and reply["error"] == "provider exploded"
    assert asyncio.run(store.get_messages("s-err"))[-1]["status"] == "error"


def test_sse_reply_cut_by_provider_error_is_saved_with_error_status(monkeypatch, _isolated):
    store = _isolated
    _use_provider(monkeypatch, _ErrorProvider())
    with TestClient(_app()) as client:
        r = client.post("/run", json={"message": "error please", "session_id": "s-sse-err"})
        assert '"type": "error"' in r.text and '"type": "end"' in r.text
    saved = asyncio.run(store.get_messages("s-sse-err"))[-1]
    assert saved["role"] == "assistant" and saved["status"] == "error"
    assert saved["error"] == "provider exploded"


class _CancelledMidStream(BaseProvider):
    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="tok0 ")
        raise asyncio.CancelledError()


def test_sse_cancelled_reply_is_saved_with_cancelled_status(monkeypatch, _isolated):
    store = _isolated
    _use_provider(monkeypatch, _CancelledMidStream())
    with TestClient(_app()) as client:
        r = client.post("/run", json={"message": "stop me", "session_id": "s-sse-cx"})
        assert '"type": "run_cancelled"' in r.text
        for _ in range(50):
            msgs = asyncio.run(store.get_messages("s-sse-cx"))
            if msgs and msgs[-1]["role"] == "assistant":
                break
            client.get("/api/chat/history/s-sse-cx")  # let the persist task run
    saved = asyncio.run(store.get_messages("s-sse-cx"))[-1]
    assert saved["role"] == "assistant" and saved["status"] == "cancelled"
    assert saved["content"] == "tok0 "


def test_regenerate_replaces_the_answer_in_history(monkeypatch, _isolated):
    provider = _CountingEcho()
    _use_provider(monkeypatch, provider)
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "hello regen", "session_id": "s-rg"})
        _read_until(ws, _turn_done("s-rg"))
        ws.send_json({"type": "chat", "content": "hello regen", "session_id": "s-rg", "regenerate": True})
        _read_until(ws, _turn_done("s-rg"))
        history = client.get("/api/chat/history/s-rg").json()
    assert [(m["role"], m["content"]) for m in history["messages"]] == [
        ("user", "hello regen"),
        ("assistant", "answer 2"),
    ]
    assert history["total"] == 2 and history["has_more"] is False
    assert provider.rewinds == [("s-rg", None)]


def test_regenerate_of_a_question_that_is_not_the_last_is_a_normal_send(monkeypatch, _isolated):
    provider = _CountingEcho()
    _use_provider(monkeypatch, provider)
    with TestClient(_app()) as client, client.websocket_connect("/api/chat/ws") as ws:
        ws.send_json({"type": "chat", "content": "first", "session_id": "s-rg2"})
        _read_until(ws, _turn_done("s-rg2"))
        ws.send_json({"type": "chat", "content": "other", "session_id": "s-rg2", "regenerate": True})
        _read_until(ws, _turn_done("s-rg2"))
        history = client.get("/api/chat/history/s-rg2").json()["messages"]
    assert [m["content"] for m in history] == ["first", "answer 1", "other", "answer 2"]
    assert provider.rewinds == []


def test_history_pages_back_with_before(monkeypatch, _isolated):
    store = _isolated

    async def seed():
        await store.create_session("s-long")
        for i in range(61):
            await store.add_message("s-long", {"role": "user", "content": f"turn {i}"})
            await store.add_message("s-long", {"role": "assistant", "content": f"reply {i}"})

    asyncio.run(seed())
    with TestClient(_app()) as client:
        last = client.get("/api/chat/history/s-long").json()
        assert last["total"] == 122 and last["start"] == 72 and last["has_more"] is True
        assert last["messages"][0]["content"] == "turn 36"
        older = client.get(f"/api/chat/history/s-long?limit=50&before={last['start']}").json()
        assert older["start"] == 22 and older["messages"][-1]["content"] == "reply 35"
        first = client.get(f"/api/chat/history/s-long?limit=50&before={older['start']}").json()
        assert first["start"] == 0 and first["has_more"] is False
        assert first["messages"][0]["content"] == "turn 0"
        assert client.get("/api/chat/history/s-long?limit=bad").json()["start"] == 72


def test_visible_history_drops_replaced_answers():
    from praisonaiui.features.chat import visible_history

    msgs = [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a1"},
        {"role": "assistant", "content": "a2", "regenerates": True},
        {"role": "assistant", "content": "a3", "regenerates": True},
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "b1"},
    ]
    assert [m["content"] for m in visible_history(msgs)] == ["q", "a3", "q2", "b1"]


def test_praisonai_provider_rewind_last_turn_only_touches_session_agents():
    from praisonaiui.providers import PraisonAIProvider

    class _Agent:
        def __init__(self):
            self.chat_history = [
                {"role": "user", "content": "q1"},
                {"role": "assistant", "content": "a1"},
                {"role": "user", "content": "q2"},
                {"role": "assistant", "content": "a2"},
            ]

    p = PraisonAIProvider()
    agent = _Agent()
    p._session_agents["s1:"] = agent
    assert p.rewind_last_turn(session_id="s1") is True
    assert [m["content"] for m in agent.chat_history] == ["q1", "a1"]
    assert p.rewind_last_turn(session_id="unknown") is False
    shared = _Agent()
    p._agent = shared  # a pre-configured agent is never rewound
    assert p.rewind_last_turn(session_id="other") is False
    assert len(shared.chat_history) == 4
