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


# ── the ledger ───────────────────────────────────────────────────────


def _ledger():
    from praisonaiui.features.run_ledger import get_run_ledger

    return get_run_ledger()


async def _one_run(monkeypatch, provider: BaseProvider, session: str = "s1") -> str:
    from praisonaiui.features import chat as chat_mod

    _use_provider(monkeypatch, provider)
    ws = _FakeWS()
    chat_mod.get_chat_manager().add_ws_client(f"c-{session}", ws)
    await chat_mod._run_and_broadcast("hi", session, None, None)
    chat_mod.get_chat_manager().remove_ws_client(f"c-{session}")
    return ws.frames[0]["run_id"]


@pytest.mark.asyncio
async def test_a_run_has_its_steps_and_the_tokens_and_cost_of_its_usage_records(monkeypatch):
    from praisonaiui.features.usage import get_usage_records, track_usage

    ledger = _ledger()
    run_id = await _one_run(monkeypatch, _Tracking(tokens=(1200, 300)))
    # another run's usage in the same session must not be counted
    track_usage(model="gpt-4o", input_tokens=9, output_tokens=9, session_id="s1", run_id="other")

    run = ledger.run(run_id)
    mine = [r for r in get_usage_records() if r.get("run_id") == run_id]
    assert len(mine) == 1
    assert run["tokensIn"] == 1200 and run["tokensOut"] == 300 and run["tokens"] == 1500
    assert run["cost"] == round(sum(r["cost"] for r in mine), 6) > 0
    assert run["model"] == "gpt-4o-mini" and run["approximate"] is False
    assert run["status"] == "completed" and run["agent"] == "Researcher"
    assert run["sessionId"] == "s1" and run["endedAt"] >= run["startedAt"]
    assert [(s["kind"], s["status"]) for s in run["steps"]] == [
        ("reasoning", "done"),
        ("tool", "done"),
        ("text", "done"),
    ]
    tool = run["steps"][1]
    assert tool["id"] == "tc1" and tool["toolName"] == "web_search"
    assert tool["label"]  # the server's description/label for the call
    assert run["stepCount"] == 3
    assert all(s["endedAt"] >= s["startedAt"] for s in run["steps"])


@pytest.mark.asyncio
async def test_untagged_usage_is_joined_by_session_and_time_window(monkeypatch):
    from praisonaiui.features.usage import track_usage

    ledger = _ledger()
    rec = track_usage(model="m", input_tokens=7, output_tokens=7, session_id="s1", run_id="")
    rec["timestamp"] -= 60  # well before the run
    run_id = await _one_run(monkeypatch, _Tracking(tokens=(40, 2), tag=False))
    track_usage(model="m", input_tokens=5, output_tokens=5, session_id="s2", run_id="")  # other session
    run = ledger.run(run_id)
    assert run["approximate"] is True
    assert (run["tokensIn"], run["tokensOut"]) == (40, 2)


@pytest.mark.asyncio
async def test_run_without_usage_has_no_tokens(monkeypatch):
    class Quiet(BaseProvider):
        async def run(self, message, *, session_id=None, agent_name=None, **kw):
            yield RunEvent(type=R.RUN_COMPLETED, content="x")

    ledger = _ledger()
    run_id = await _one_run(monkeypatch, Quiet())
    run = ledger.run(run_id)
    assert "tokens" not in run and "cost" not in run and run["steps"] == []


def _feed(ledger, run_id: str, *events: Dict[str, Any], session: str = "s1") -> None:
    for ev in events:
        ledger.observe(session, {"run_id": run_id, "session_id": session, **ev})


def test_approval_gate_puts_the_run_and_its_agent_in_waiting():
    ledger = _ledger()
    _feed(
        ledger,
        "r1",
        {"type": "run_started", "agent_name": "Ops"},
        {"type": "tool_call_started", "name": "shell", "tool_call_id": "t1", "label": "Running a command"},
        {"type": "run_paused", "pause_type": "approval_required", "tool_name": "shell", "id": "ap1"},
    )
    run = ledger.run("r1")
    assert run["status"] == "waiting"
    assert run["steps"][-1]["kind"] == "approval" and run["steps"][-1]["status"] == "waiting"
    assert "shell" in run["steps"][-1]["label"]
    [ops] = ledger.agents()
    assert ops["name"] == "Ops" and ops["state"] == "waiting" and ops["elapsedMs"] >= 0
    _feed(ledger, "r1", {"type": "tool_call_completed", "name": "shell", "tool_call_id": "t1"})
    run = ledger.run("r1")
    assert run["status"] == "running"
    assert [s["status"] for s in run["steps"]] == ["done", "done"]
    assert ledger.agents()[0]["state"] == "running"


def test_ask_prompt_is_a_waiting_step_too():
    ledger = _ledger()
    _feed(ledger, "r1", {"type": "run_paused", "question": "Pick one"})
    assert ledger.run("r1")["steps"][0]["label"] == "Waiting for your answer"


def test_a_new_agent_mid_run_is_a_handoff_step():
    ledger = _ledger()
    _feed(
        ledger,
        "r1",
        {"type": "run_started", "agent_name": "Planner"},
        {"type": "run_content", "token": "a"},
        {"type": "run_started", "agent_name": "Coder"},
        {"type": "run_completed", "content": "a"},
    )
    run = ledger.run("r1")
    assert run["agent"] == "Coder"
    assert [(s["kind"], s["label"]) for s in run["steps"]] == [
        ("text", "Writing the answer"),
        ("handoff", "Handed off to Coder"),
    ]


def test_repeated_tool_start_updates_the_label_and_counts_once():
    ledger = _ledger()
    _feed(
        ledger,
        "r1",
        {"type": "tool_call_started", "name": "search", "tool_call_id": "t1", "label": "Searching"},
        {"type": "tool_call_started", "name": "search", "tool_call_id": "t1", "description": "Searching for 'x'"},
        {"type": "tool_call_completed", "name": "search"},  # no id: matched by name
    )
    run = ledger.run("r1")
    assert run["stepCount"] == 1
    assert run["steps"][0]["label"] == "Searching for 'x'" and run["steps"][0]["status"] == "done"


def test_run_error_marks_open_tool_steps_failed_and_events_without_run_id_are_ignored():
    ledger = _ledger()
    ledger.observe("s1", {"type": "run_started"})  # no run id: not a run event
    _feed(
        ledger,
        "r1",
        {"type": "tool_call_started", "name": "x", "tool_call_id": "t1"},
        {"type": "run_error", "error": "boom"},
        {"type": "run_closed", "status": "completed"},  # the event status already won
        {"type": "run_content", "token": "late"},  # a late frame does not reopen it
    )
    run = ledger.run("r1")
    assert run["status"] == "failed" and run["error"] == "boom"
    assert run["steps"][0]["status"] == "error"
    assert len(ledger.recent()) == 1


def test_steps_are_capped_but_counted(monkeypatch):
    from praisonaiui.features import run_ledger

    monkeypatch.setattr(run_ledger, "MAX_STEPS", 3)
    ledger = _ledger()
    for i in range(5):
        _feed(ledger, "r1", {"type": "tool_call_started", "name": "t", "tool_call_id": f"t{i}"})
    run = ledger.run("r1")
    assert len(run["steps"]) == 3 and run["stepCount"] == 5


# ── persistence ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_finished_runs_persist_under_the_data_dir_with_their_usage(monkeypatch, _isolated):
    from praisonaiui.features import run_ledger, usage

    _ledger()  # observing from here on (create_app builds the feature)
    run_id = await _one_run(monkeypatch, _Tracking(tokens=(10, 5)))
    _ledger().flush(5)
    path = _isolated / "runs" / run_ledger.LEDGER_FILE
    assert path.is_file() and run_id in path.read_text()

    # a new process: empty usage ring, fresh ledger
    monkeypatch.setattr(usage, "_usage_records", type(usage._usage_records)(maxlen=10))
    run_ledger.reset_run_ledger()
    ledger = run_ledger.get_run_ledger()
    assert ledger.run(run_id) is None
    ledger.ensure_loaded()
    run = ledger.run(run_id)
    assert run["status"] == "completed" and run["tokens"] == 15 and len(run["steps"]) == 3


def test_load_skips_torn_lines_compacts_and_keeps_newer_runs(monkeypatch, _isolated):
    import json

    from praisonaiui.features import run_ledger

    monkeypatch.setattr(run_ledger, "RING_SIZE", 3)
    d = _isolated / "runs"
    d.mkdir()
    rows = [{"id": f"old{i}", "startedAt": i, "status": "completed", "steps": [], "stepCount": 0} for i in range(7)]
    text = "".join(json.dumps(r) + "\n" for r in rows) + '{"id": "torn'
    (d / run_ledger.LEDGER_FILE).write_text(text)
    ledger = _ledger()
    _feed(ledger, "live", {"type": "run_completed"}, {"type": "run_closed"})
    ledger.ensure_loaded()
    ids = [r["id"] for r in ledger.recent(limit=10)]
    assert ids[0] == "live" and "torn" not in ids
    assert len(ids) == 3  # the ring size
    lines = (d / run_ledger.LEDGER_FILE).read_text().splitlines()
    assert len(lines) <= 7  # compacted (more than twice the ring)


def test_unwritable_data_dir_is_logged_not_raised(monkeypatch, _isolated, caplog):
    from praisonaiui.features import run_ledger

    blocker = _isolated / "file"
    blocker.write_text("x")
    monkeypatch.setattr(run_ledger, "ledger_dir", lambda: blocker / "runs")
    ledger = _ledger()
    _feed(ledger, "r1", {"type": "run_completed"}, {"type": "run_closed"})
    assert ledger.run("r1")["status"] == "completed"
    assert "could not write" in caplog.text


@pytest.mark.asyncio
async def test_on_the_event_loop_the_append_runs_on_the_writer_thread(monkeypatch):
    import threading

    from praisonaiui.features import run_ledger

    release = threading.Event()
    seen: List[str] = []

    def slow_append(self, line):
        seen.append(threading.current_thread().name)
        release.wait(5)

    monkeypatch.setattr(run_ledger.RunLedger, "_append", slow_append)
    ledger = _ledger()
    for rid in ("r1", "r2"):
        _feed(ledger, rid, {"type": "run_completed"}, {"type": "run_closed"})
    # The observer returned while the disk write is still blocked.
    assert ledger.run("r2")["status"] == "completed"
    release.set()
    await asyncio.to_thread(ledger.flush, 5)
    assert len(seen) == 2 and all(n.startswith("aiui-run-ledger") for n in seen)


# ── stored runs ──────────────────────────────────────────────────────

_H = 3_600_000


def _put(ledger, rid, *, start, dur=None, status="completed", agent="A", tokens=None, cost=None):
    run = {"id": rid, "sessionId": None, "agent": agent, "startedAt": start, "status": status,
           "steps": [], "stepCount": 0}  # fmt: skip
    if dur is not None:
        run["endedAt"] = start + dur
    if tokens is not None:
        run.update(tokens=tokens, cost=cost)
    ledger._remember(run)


def test_kpis_count_success_cost_and_latency_in_the_window(monkeypatch):
    from praisonaiui.features import config_runtime

    monkeypatch.delitem(config_runtime._runtime_config, "finops", raising=False)
    ledger = _ledger()
    now = 1_800_000_000_000
    for i, d in enumerate([100, 200, 300, 400, 1000]):
        _put(ledger, f"ok{i}", start=now - _H - i, dur=d, tokens=10, cost=0.5)
    _put(ledger, "bad", start=now - _H, dur=50, status="failed", tokens=1, cost=0.25)
    _put(ledger, "stop", start=now - _H, dur=50, status="cancelled")
    _put(ledger, "prev", start=now - 30 * _H, dur=10)  # the window before
    _put(ledger, "older", start=now - 100 * _H, dur=10)
    k = ledger.kpis("24h", now=now)
    assert k["window"] == "24h" and k["runs"] == 7 and k["runsDelta"] == 6
    assert k["successRate"] == round(5 / 6, 4)  # cancelled is excluded
    assert k["cost"] == 2.75 and "budget" not in k  # no FinOps budget set
    assert (k["p50Ms"], k["p95Ms"]) == (300, 1000)
    week = ledger.kpis("7d", now=now)
    assert week["runs"] == 9
    empty = _ledger().kpis("today", now=now - 1000 * _H)
    assert empty["runs"] == 0 and "successRate" not in empty and "p50Ms" not in empty


def test_kpis_today_starts_at_local_midnight():
    from datetime import datetime

    ledger = _ledger()
    noon = int(datetime(2026, 11, 14, 12, 0).timestamp() * 1000)
    _put(ledger, "morning", start=noon - 6 * _H, dur=1)
    _put(ledger, "yesterday", start=noon - 13 * _H, dur=1)
    k = ledger.kpis("today", now=noon)
    assert k["runs"] == 1 and k["runsDelta"] == 0


def test_agents_report_state_last_run_model_and_todays_spend():
    import time

    ledger = _ledger()
    now = int(time.time() * 1000)
    _put(ledger, "a1", start=now - 2000, dur=1000, agent="Writer", tokens=100, cost=0.01)
    _put(ledger, "a0", start=now - 40 * _H, dur=1000, agent="Writer", tokens=999, cost=9.0)
    ledger._done["a1"]["model"] = "gpt-4o"
    _feed(ledger, "live", {"type": "run_started", "agent_name": "Coder"})
    agents = {a["name"]: a for a in ledger.agents(["Writer", "Idle", ""])}
    assert list(agents) == ["Coder", "Writer", "Idle"]  # active first, then most recent
    assert agents["Coder"]["state"] == "running" and agents["Coder"]["elapsedMs"] >= 0
    w = agents["Writer"]
    assert w["state"] == "idle" and w["lastRunAt"] == now - 2000 and w["model"] == "gpt-4o"
    assert (w["tokensToday"], w["costToday"]) == (100, 0.01)
    assert agents["Idle"] == {"name": "Idle", "state": "idle", "tokensToday": 0, "costToday": 0.0}


@pytest.mark.parametrize(
    "finops, today, week",
    [
        ({"daily_cost_budget_usd": 2.5}, 2.5, 17.5),
        ({"daily_cost_budget_usd": 0}, None, None),
        ({"daily_cost_budget_usd": 3, "enabled": False}, None, None),
        ({"daily_cost_budget_usd": True}, None, None),
        ({"daily_token_budget": 1000}, None, None),
    ],
)
def test_kpis_report_the_finops_cost_budget_for_the_window(monkeypatch, finops, today, week):
    from praisonaiui.features import config_runtime

    monkeypatch.setitem(config_runtime._runtime_config, "finops", finops)
    ledger = _ledger()
    assert ledger.kpis("today").get("budget") == today
    assert ledger.kpis("24h").get("budget") == today
    assert ledger.kpis("7d").get("budget") == week


# ── routes ───────────────────────────────────────────────────────────


@pytest.fixture
def client():
    from starlette.applications import Starlette
    from starlette.testclient import TestClient

    from praisonaiui.features.run_ledger import RunLedgerFeature

    return TestClient(Starlette(routes=RunLedgerFeature().routes()))


def test_routes_list_filter_get_kpis_and_agents(client):
    ledger = _ledger()
    _put(ledger, "r1", start=1000, dur=5, agent="A")
    _put(ledger, "r2", start=2000, dur=5, agent="B")
    _put(ledger, "r3", start=3000, dur=5, agent="A")
    body = client.get("/api/runs").json()
    assert [r["id"] for r in body["runs"]] == ["r3", "r2", "r1"] and body["count"] == 3
    assert set(body["runs"][0]) <= {"id", "sessionId", "agent", "startedAt", "endedAt", "status",
                                    "stepCount", "tokens", "cost", "approximate"}  # fmt: skip
    assert [r["id"] for r in client.get("/api/runs?agent=A").json()["runs"]] == ["r3", "r1"]
    assert [r["id"] for r in client.get("/api/runs?after=r1").json()["runs"]] == ["r3", "r2"]
    assert [r["id"] for r in client.get("/api/runs?limit=1").json()["runs"]] == ["r3"]
    assert client.get("/api/runs?limit=nope").status_code == 200
    detail = client.get("/api/runs/r2").json()
    assert detail["id"] == "r2" and detail["steps"] == []
    assert client.get("/api/runs/missing").status_code == 404
    assert client.get("/api/runs/kpis?window=7d").json()["window"] == "7d"
    assert client.get("/api/runs/kpis?window=year").status_code == 400
    names = [a["name"] for a in client.get("/api/runs/agents").json()["agents"]]
    assert set(names) >= {"A", "B"}


def test_session_filter(client):
    ledger = _ledger()
    _feed(ledger, "x", {"type": "run_started"}, session="s-a")
    _feed(ledger, "y", {"type": "run_started"}, session="s-b")
    assert [r["id"] for r in client.get("/api/runs?session_id=s-b").json()["runs"]] == ["y"]


@pytest.mark.asyncio
async def test_health_is_cheap_and_reports_counts():
    from praisonaiui.features.run_ledger import RunLedgerFeature

    feat = RunLedgerFeature()
    _feed(_ledger(), "r1", {"type": "run_started"})
    h = await feat.health()
    assert h["status"] == "ok" and h["live_runs"] == 1


def test_feature_observes_chat_once_however_often_it_is_built():
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features.run_ledger import RunLedgerFeature

    RunLedgerFeature()
    RunLedgerFeature()
    assert chat_mod._event_observers == [_ledger().observe]


# ── the catalog records and their layout gating ──────────────────────


def _records() -> Dict[str, Any]:
    from praisonaiui.builtin import BUILTIN_PLUGINS

    return {p.name: p for p in BUILTIN_PLUGINS if p.name in ("artifacts", "run-ledger")}


def test_layout_data_records_name_their_layouts_and_features():
    from praisonaiui.builtin import BUILTIN_PLUGINS
    from praisonaiui.features.artifacts import ArtifactsFeature
    from praisonaiui.features.run_ledger import RunLedgerFeature

    recs = _records()
    assert list(recs) == ["artifacts", "run-ledger"]
    assert [p.name for p in BUILTIN_PLUGINS[-2:]] == ["artifacts", "run-ledger"]  # appended last
    art, ledger = recs["artifacts"], recs["run-ledger"]
    assert art.for_layouts == ("chat-canvas",)
    assert ledger.for_layouts == ("command", "mission")
    assert [r.load() for r in art.feature_refs] == [ArtifactsFeature]
    assert [r.load() for r in ledger.feature_refs] == [RunLedgerFeature]
    assert not art.required and not ledger.required
    # The artifacts index (layout-features/artifacts/ArtifactsPage): shell
    # only and native, listed while Chat and Canvas is on offer.
    assert art.pages() == []
    [index] = art.shell_pages()
    assert (index.id, index.kind, index.shell_only, index.layouts) == ("artifacts", "native", True, ("chat-canvas",))
    assert ledger.pages() == [] and ledger.shell_pages() == []


def test_the_artifacts_page_is_in_the_shell_manifest_only():
    import praisonaiui.server as srv

    srv.reset_state()
    try:
        client = _app_client()
        assert client.get("/api/artifacts").status_code == 200  # mounted under style app
        pages = client.get("/api/shell/manifest").json()["pages"]
        assert [p["id"] for p in pages if p["source"] in ("builtin.artifacts", "builtin.run-ledger")] == ["artifacts"]
        assert "artifacts" not in {p["id"] for p in client.get("/api/pages").json()["pages"]}
        # Share links land on /artifacts: a page navigation gets the shell's HTML.
        nav = client.get("/artifacts?session=s1&artifact=k", headers={"accept": "text/html"})
        assert nav.status_code == 200 and nav.headers["content-type"].startswith("text/html")
    finally:
        srv.reset_state()


def test_the_artifacts_page_leaves_the_shell_with_its_record_or_its_layout():
    import praisonaiui as aiui
    import praisonaiui.server as srv

    srv.reset_state()
    try:
        off = _app_client(extensions={"disabled": ["builtin.artifacts"]})
        assert "artifacts" not in {p["id"] for p in off.get("/api/shell/manifest").json()["pages"]}
        srv.reset_state()
        aiui.set_layout(available=["workbench"])
        other = _app_client()
        assert "artifacts" not in {p["id"] for p in other.get("/api/shell/manifest").json()["pages"]}
    finally:
        srv.reset_state()


def test_layout_data_routes_never_shadow_another_feature():
    """Same rule as test_builtin_plugins: no route of these features can match
    a path another built-in feature serves, either way round."""
    import re

    from praisonaiui.features import auto_register_defaults, get_features
    from praisonaiui.features.artifacts import ArtifactsFeature
    from praisonaiui.features.run_ledger import RunLedgerFeature

    auto_register_defaults()
    others = [
        r for name, f in get_features().items()
        if name not in ("artifacts", "run_ledger") for r in f.routes() if hasattr(r, "path_regex")
    ]  # fmt: skip
    mine = [*ArtifactsFeature().routes(), *RunLedgerFeature().routes()]

    def concrete(path: str) -> str:
        return re.sub(r"\{[^}]+\}", "x", path)

    clashes = [
        (a.path, b.path)
        for a in mine
        for b in others
        if (getattr(a, "methods", None) or set()) & (getattr(b, "methods", None) or set())
        and (a.path_regex.match(concrete(b.path)) or b.path_regex.match(concrete(a.path)))
    ]
    assert len(others) > 200 and clashes == []


def _probe(code: str) -> str:
    import os
    import subprocess
    import sys
    from pathlib import Path

    import praisonaiui

    env = {**os.environ, "AIUI_DISABLE_PLUGIN_AUTOLOAD": "1",
           "PYTHONPATH": str(Path(praisonaiui.__file__).parents[1])}  # fmt: skip
    env.pop("AIUI_SHELL", None)
    env.pop("AIUI_LAYOUT", None)
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    return out.stdout.strip().splitlines()[-1]


_LOADED = (
    "import sys; print(sorted(m for m in ('praisonaiui.features.artifacts',"
    " 'praisonaiui.features.run_ledger') if m in sys.modules))"
)


def test_import_and_the_default_app_never_import_the_layout_data_modules(tmp_path):
    assert _probe("import praisonaiui; " + _LOADED) == "[]"
    code = (
        "import os; os.environ['AIUI_DATA_DIR'] = %r\n"
        "import praisonaiui.server as s; s.set_style('dashboard'); s.create_app(); " % str(tmp_path)
    ) + _LOADED
    assert _probe(code) == "[]"  # style dashboard: no layout needs them


def test_gated_off_by_default_and_mounted_when_enabled_explicitly(monkeypatch, tmp_path):
    from starlette.testclient import TestClient

    import praisonaiui.server as srv
    from praisonaiui.plugin_registry import set_extensions

    srv.reset_state()
    try:
        srv.set_style("dashboard")  # no layout on offer
        client = TestClient(srv.create_app())
        assert client.get("/api/runs").status_code == 404
        assert client.get("/api/artifacts").status_code == 404
        set_extensions(enabled=["builtin.run-ledger", "builtin.artifacts"])
        client = TestClient(srv.create_app())
        assert client.get("/api/runs").status_code == 200
        assert client.get("/api/artifacts").status_code == 200
        pages = {p["id"] for p in client.get("/api/pages").json()["pages"]}
        assert "artifacts" not in pages  # shell-only: never on the dashboard
    finally:
        srv.reset_state()


def _app_client(**cfg):
    from starlette.testclient import TestClient

    import praisonaiui.server as srv

    srv.set_style("app")
    return TestClient(srv.create_app(config=cfg or None))


def _mounted(client) -> Dict[str, Any]:
    rows = {r["name"]: r for r in client.get("/api/plugins?origin=builtin").json()["plugins"]}
    return {
        "artifacts": client.get("/api/artifacts").status_code,
        "runs": client.get("/api/runs").status_code,
        "artifacts_status": (rows["builtin.artifacts"]["status"], rows["builtin.artifacts"].get("reason")),
        "ledger_status": (rows["builtin.run-ledger"]["status"], rows["builtin.run-ledger"].get("reason")),
    }


@pytest.mark.parametrize(
    "available, artifacts, runs",
    [
        (None, 200, 200),  # style app: every layout is on offer
        (["chat-canvas"], 200, 404),
        (["mission"], 404, 200),
        (["workbench", "guided"], 404, 404),
    ],
)
def test_each_record_mounts_only_while_a_layout_it_serves_is_on_offer(monkeypatch, available, artifacts, runs):
    import praisonaiui as aiui
    import praisonaiui.server as srv

    monkeypatch.delenv("AIUI_LAYOUT", raising=False)
    srv.reset_state()
    try:
        if available is not None:
            aiui.set_layout(available=available)
        m = _mounted(_app_client())
        assert (m["artifacts"], m["runs"]) == (artifacts, runs)
        off = ("disabled", "no layout needs it")
        assert m["artifacts_status"] == (("ok", None) if artifacts == 200 else off)
        assert m["ledger_status"] == (("ok", None) if runs == 200 else off)
    finally:
        srv.reset_state()


def test_extensions_disabled_wins_over_a_layout_that_needs_them():
    import praisonaiui.server as srv

    srv.reset_state()
    try:
        m = _mounted(_app_client(extensions={"disabled": ["builtin.artifacts", "builtin.run-ledger"]}))
        assert (m["artifacts"], m["runs"]) == (404, 404)
        assert m["artifacts_status"] == m["ledger_status"] == ("disabled", None)
    finally:
        srv.reset_state()
