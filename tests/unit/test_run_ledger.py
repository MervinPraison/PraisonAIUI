"""Run ledger (ADR 0003, Track D): run ids on usage, the chat event observer,
and the per-run record behind ``/api/runs``."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List
from unittest.mock import MagicMock

import pytest

from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

R = RunEventType


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Private data dir, datastore, chat manager, usage ring and ledger."""
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features import guardrails, usage

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("PRAISONAI_HOME", raising=False)

    async def _no_guardrail(*_a, **_kw):
        return None

    monkeypatch.setattr(guardrails, "check_guardrails", _no_guardrail)
    store = MemoryDataStore()
    monkeypatch.setattr(server, "_datastore", store)
    monkeypatch.setattr(usage, "_usage_records", type(usage._usage_records)(maxlen=10000))
    monkeypatch.setattr(usage, "_data_file", None)
    monkeypatch.setattr(chat_mod, "_event_observers", [])
    prev_mgr = chat_mod._chat_manager
    chat_mod.set_chat_manager(chat_mod.ChatManager())
    _reset_ledger()
    yield tmp_path
    _reset_ledger()
    chat_mod._chat_manager = prev_mgr


def _reset_ledger() -> None:
    import sys

    mod = sys.modules.get("praisonaiui.features.run_ledger")
    if mod is not None:
        mod.reset_run_ledger()


class _FakeWS:
    def __init__(self) -> None:
        self.frames: List[Dict[str, Any]] = []

    async def send_text(self, data: str) -> None:
        import json

        self.frames.append(json.loads(data))


def _use_provider(monkeypatch, provider: BaseProvider) -> None:
    import praisonaiui.server as server

    monkeypatch.setattr(server, "get_provider", lambda: provider)


class _Tracking(BaseProvider):
    """Reasoning, one tool call, text; tracks usage the way providers do."""

    def __init__(self, tokens=(100, 50), model="gpt-4o-mini", tag=True) -> None:
        self.tokens = tokens
        self.model = model
        self.tag = tag

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        from praisonaiui.features.usage import track_usage

        yield RunEvent(type=R.RUN_STARTED, agent_name="Researcher")
        yield RunEvent(type=R.REASONING_STARTED)
        yield RunEvent(type=R.REASONING_STEP, step="think")
        yield RunEvent(type=R.REASONING_COMPLETED)
        yield RunEvent(type=R.TOOL_CALL_STARTED, name="web_search", args={"query": "x"}, tool_call_id="tc1")
        yield RunEvent(type=R.TOOL_CALL_COMPLETED, name="web_search", result="ok", tool_call_id="tc1")
        yield RunEvent(type=R.RUN_CONTENT, token="Hello")
        yield RunEvent(type=R.RUN_COMPLETED, content="Hello")
        # Like PraisonAIProvider: usage is tracked after run_completed.
        kwargs = {} if self.tag else {"run_id": ""}
        track_usage(
            model=self.model,
            input_tokens=self.tokens[0],
            output_tokens=self.tokens[1],
            session_id=session_id,
            agent_name="Researcher",
            **kwargs,
        )


# ── run ids on usage records ─────────────────────────────────────────


def test_track_usage_takes_a_run_id_and_keeps_the_old_shape_without_one():
    from praisonaiui.features.usage import get_usage_records, track_usage

    plain = track_usage(model="gpt-4o", input_tokens=1, output_tokens=1, session_id="s")
    tagged = track_usage(model="gpt-4o", input_tokens=1, output_tokens=1, session_id="s", run_id="r1")
    assert "run_id" not in plain
    assert tagged["run_id"] == "r1"
    assert [r.get("run_id") for r in get_usage_records()] == [None, "r1"]
    assert get_usage_records(since=tagged["timestamp"]) == [tagged]


def test_track_usage_defaults_to_the_current_run():
    from praisonaiui.features.chat import current_run_id
    from praisonaiui.features.usage import track_usage

    token = current_run_id.set("r-ctx")
    try:
        assert track_usage(model="m", input_tokens=1)["run_id"] == "r-ctx"
        assert track_usage(model="m", input_tokens=1, run_id="explicit")["run_id"] == "explicit"
    finally:
        current_run_id.reset(token)
    assert "run_id" not in track_usage(model="m", input_tokens=1)


def test_usage_track_endpoint_accepts_a_run_id():
    from starlette.applications import Starlette
    from starlette.testclient import TestClient

    from praisonaiui.features.usage import UsageFeature

    client = TestClient(Starlette(routes=UsageFeature().routes()))
    r = client.post("/api/usage/track", json={"model": "m", "input_tokens": 3, "run_id": "r9"})
    assert r.status_code == 201 and r.json()["run_id"] == "r9"
    r = client.post("/api/usage/track", json={"model": "m", "input_tokens": 3, "run_id": 5})
    assert "run_id" not in r.json()


@pytest.mark.asyncio
async def test_run_sets_current_run_id_for_the_provider(monkeypatch, _isolated):
    from praisonaiui.features import chat as chat_mod

    seen: List[Any] = []

    class Peek(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            seen.append(chat_mod.current_run_id.get())
            yield RunEvent(type=R.RUN_COMPLETED, content="x")

    _use_provider(monkeypatch, Peek())
    ws = _FakeWS()
    chat_mod.get_chat_manager().add_ws_client("c", ws)
    await chat_mod._run_and_broadcast("hi", "s1", None, None)
    run_id = ws.frames[0]["run_id"]
    assert seen == [run_id]
    assert chat_mod.current_run_id.get() is None  # reset after the run


@pytest.mark.asyncio
async def test_praisonai_provider_passes_the_run_id_to_track_usage(monkeypatch):
    pytest.importorskip("praisonaiagents.streaming")
    from praisonaiui.features import usage
    from praisonaiui.features.chat import current_run_id
    from praisonaiui.providers import PraisonAIProvider

    calls: List[Dict[str, Any]] = []
    monkeypatch.setattr(usage, "track_usage", lambda **kw: calls.append(kw))
    agent = MagicMock()
    agent.name = "assistant"
    agent.llm = "gpt-4o-mini"
    agent.memory = None
    agent.stream_emitter = MagicMock()
    agent.stream_emitter.get_metrics = MagicMock(return_value=None)

    async def achat(message, stream=True, **kwargs):
        return "Hello"

    agent.achat = achat
    token = current_run_id.set("r-provider")
    try:
        provider = PraisonAIProvider(agent=agent)
        [ev async for ev in provider._run_direct_mode("hi", session_id="s1", agent_name=None)]
    finally:
        current_run_id.reset(token)
    assert calls and calls[-1]["run_id"] == "r-provider"
    assert calls[-1]["session_id"] == "s1"


# ── the chat event observer ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_observer_sees_every_event_and_one_run_closed(monkeypatch, _isolated):
    from praisonaiui.features import chat as chat_mod

    seen: List[tuple] = []
    remove = chat_mod.add_event_observer(lambda sid, ev: seen.append((sid, dict(ev))))
    # the same function twice is registered once; the manager method is the same list
    assert chat_mod.ChatManager.add_event_observer(seen.append) and len(chat_mod._event_observers) == 2
    chat_mod._event_observers.remove(seen.append)

    _use_provider(monkeypatch, _Tracking())
    ws = _FakeWS()
    chat_mod.get_chat_manager().add_ws_client("c", ws)
    await chat_mod._run_and_broadcast("hi", "s1", None, None)

    types = [ev["type"] for _, ev in seen]
    assert types[:-1] == [f["type"] for f in ws.frames]  # the wire stream, unchanged
    assert types[-1] == "run_closed" and "run_closed" not in [f["type"] for f in ws.frames]
    closed = seen[-1][1]
    assert closed == {"type": "run_closed", "session_id": "s1", "run_id": ws.frames[0]["run_id"], "status": "completed"}
    assert all(sid == "s1" for sid, _ in seen)
    remove()
    remove()  # idempotent
    assert chat_mod._event_observers == []


@pytest.mark.asyncio
async def test_observers_run_without_clients_and_a_failing_one_is_isolated(monkeypatch, _isolated, caplog):
    from praisonaiui.features import chat as chat_mod

    def broken(sid, ev):
        raise RuntimeError("boom")

    seen: List[str] = []
    chat_mod.add_event_observer(broken)
    chat_mod.add_event_observer(lambda sid, ev: seen.append(ev["type"]))
    _use_provider(monkeypatch, _Tracking())
    await chat_mod._run_and_broadcast("hi", "s1", None, None)  # no WS client at all
    assert seen[0] == "run_started" and seen[-1] == "run_closed"
    assert "observer" in caplog.text


@pytest.mark.asyncio
async def test_observers_survive_a_new_chat_manager(monkeypatch, _isolated):
    from praisonaiui.features import chat as chat_mod

    seen: List[str] = []
    chat_mod.add_event_observer(lambda sid, ev: seen.append(ev["type"]))
    chat_mod.set_chat_manager(chat_mod.ChatManager())
    await chat_mod.get_chat_manager().broadcast("s", {"type": "x", "run_id": "r"})
    assert seen == ["x"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fail, status",
    [("error", "failed"), ("cancel", "cancelled")],
)
async def test_run_closed_status_on_error_and_cancel(monkeypatch, _isolated, fail, status):
    from praisonaiui.features import chat as chat_mod

    started = asyncio.Event()

    class Bad(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            yield RunEvent(type=R.RUN_CONTENT, token="a")
            started.set()
            if fail == "error":
                raise RuntimeError("down")
            await asyncio.sleep(10)
            yield RunEvent(type=R.RUN_COMPLETED, content="never")  # pragma: no cover

    closed: List[Dict[str, Any]] = []
    chat_mod.add_event_observer(lambda sid, ev: ev["type"] == "run_closed" and closed.append(ev))
    _use_provider(monkeypatch, Bad())
    task = asyncio.ensure_future(chat_mod._run_and_broadcast("hi", "s1", None, None))
    await started.wait()
    if fail == "cancel":
        await asyncio.sleep(0)
        task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert [c["status"] for c in closed] == [status]
