"""Steps on the wire: aiui.Step (async with / with), @aiui.step (bare, args,
sync, async), implicit nesting across awaits, tasks and threads, timing,
errors, step_* events and the steps saved with the reply."""

import asyncio
import time
from unittest.mock import MagicMock

import pytest

import praisonaiui as aiui
from praisonaiui.message import MAX_CODE_SIZE, Step, step
from praisonaiui.provider import ReplySteps, RunEvent, RunEventType


@pytest.fixture
def queue(monkeypatch):
    """The reply stream every step of the test puts its events on."""
    q: asyncio.Queue = asyncio.Queue()
    ctx = MagicMock()
    ctx._stream_queue = q
    monkeypatch.setattr("praisonaiui.callbacks._get_context", lambda: ctx)
    return q


def drain(q: asyncio.Queue) -> list:
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


@pytest.mark.asyncio
async def test_step_input_output_tokens_and_timing(queue):
    before = time.time() * 1000
    async with Step("search", type="tool") as s:
        s.input = {"query": "rust"}  # set inside the block: arrives with the end
        await s.stream_token("Hello ")
        await s.stream_token("world")
        await asyncio.sleep(0.02)
    start, t1, t2, end = drain(queue)
    assert (start["type"], start["step_type"], t1["token"], t2["token"]) == ("step_start", "tool", "Hello ", "world")
    assert end["type"] == "step_end" and end["status"] == "done" and end["input"] == '{"query": "rust"}'
    assert "output" not in end and s.output == "Hello world"  # streamed, not repeated
    assert before - 1 <= start["start"] <= end["end"] - 15
    assert end["duration"] == pytest.approx((s.end - s.start) / 1000)

    async with Step("calc") as s:
        s.output = {"answer": 42}
    assert drain(queue)[-1]["output"] == '{"answer": 42}'


@pytest.mark.asyncio
async def test_error_and_cancel_status(queue):
    with pytest.raises(RuntimeError):
        async with Step("fails"):
            raise RuntimeError("boom")
    end = drain(queue)[-1]
    assert end["status"] == "error" and end["error"] == "boom"

    started = asyncio.Event()

    async def work():
        async with Step("slow"):
            started.set()
            await asyncio.sleep(10)

    task = asyncio.create_task(work())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    end = drain(queue)[-1]
    assert end["status"] == "stopped" and "error" not in end


@pytest.mark.asyncio
async def test_sync_with(queue):
    with Step("sync") as s:
        s.stream_token("a")  # sync code need not await
    assert [e["type"] for e in drain(queue)] == ["step_start", "step_update", "step_end"]


def test_without_a_reply_a_step_still_times_itself():
    with Step("alone") as s:
        s.stream_token("x")
    assert s._context is None and s.status == "done" and s.duration is not None and s.output == "x"


@pytest.mark.asyncio
async def test_implicit_nesting_across_awaits_and_tasks(queue):
    async def branch(name: str) -> Step:
        async with Step(name) as s:
            await asyncio.sleep(0.01)
        return s

    async with Step("outer") as outer:
        async with Step("inner") as inner:
            await asyncio.sleep(0)
            async with Step("leaf") as leaf:
                pass
        a, b = await asyncio.gather(branch("a"), branch("b"))
    async with Step("next root") as root:
        async with Step("explicit", parent=leaf) as explicit:
            pass
    assert explicit.parent is leaf
    assert (inner.parent, leaf.parent, a.parent, b.parent, root.parent) == (outer, inner, outer, outer, None)
    starts = {e["name"]: e.get("parent_id") for e in drain(queue) if e["type"] == "step_start"}
    assert starts == {
        "outer": None, "inner": outer.id, "leaf": inner.id, "a": outer.id, "b": outer.id,
        "next root": None, "explicit": leaf.id,
    }


@pytest.mark.asyncio
async def test_a_step_in_a_make_async_thread_nests_and_reaches_the_reply(queue):
    def blocking() -> Step:
        with Step("in thread", type="tool") as s:
            s.stream_token("from a thread")
        return s

    async with Step("outer") as outer:
        child = await aiui.make_async(blocking)()
    await asyncio.sleep(0.05)  # the thread's events arrive through the loop
    events = drain(queue)
    assert child.parent is outer
    assert [(e["type"], e.get("name")) for e in events][::len(events) - 1] == [("step_start", "outer"), ("step_end", "outer")]
    assert next(e for e in events if e.get("name") == "in thread")["parent_id"] == outer.id
    assert any(e.get("token") == "from a thread" for e in events)


@pytest.mark.asyncio
async def test_decorator_forms_capture_arguments_and_return_value(queue):
    @step
    async def web_search(query: str, limit: int = 3):
        return add(query, "!") * limit

    @step("Add", type="tool", version="1.0")
    def add(a, b):
        return a + b

    class Agent:
        @step()
        def plan(self, goal):
            return "x" * (MAX_CODE_SIZE + 10)

    assert web_search.__name__ == "web_search" and await web_search("rust", limit=2) == "rust!rust!"
    outer_start, inner_start, inner_end, outer_end = drain(queue)
    assert (outer_start["name"], outer_start["input"]) == ("web_search", '{"query": "rust", "limit": 2}')
    assert (inner_start["name"], inner_start["step_type"], inner_start["metadata"]) == ("Add", "tool", {"version": "1.0"})
    assert inner_start["parent_id"] == outer_start["step_id"]
    assert (inner_end["output"], outer_end["output"]) == ("rust!", "rust!rust!")
    Agent().plan("ship")
    start, end = drain(queue)
    assert start["input"] == '{"goal": "ship"}' and len(end["output"]) == MAX_CODE_SIZE + 1


def test_wire_fields_and_saved_steps():
    ev = RunEvent(type=RunEventType.STEP_START, extra_data={"type": "step_start", "step_id": "s1", "start": 1.0})
    assert ev.to_dict()["step_id"] == "s1" and ev.to_dict()["start"] == 1.0  # flat, for SSE readers
    steps = ReplySteps()
    for fields in ({"step_id": "s1", "name": "a", "start": 1.0}, {"step_id": "s1", "token": "he"},
                   {"step_id": "s1", "token": "llo"}, {"step_id": "s1", "end": 2.0, "status": "done", "duration": 1},
                   {"token": "no id"}):
        steps.apply(fields)
    assert steps.saved() == [{"step_id": "s1", "status": "done", "name": "a", "start": 1.0, "output": "hello", "end": 2.0}]


@pytest.mark.asyncio
async def test_chat_run_broadcasts_steps_and_saves_the_tree(tmp_path, monkeypatch):
    import praisonaiui.server as server
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.features import chat as chat_mod
    from praisonaiui.features import guardrails
    from praisonaiui.provider import BaseProvider

    class Provider(BaseProvider):
        async def run(self, message, **kw):
            for data in (
                {"type": "step_start", "step_id": "p", "name": "plan", "start": 1000.0},
                {"type": "step_start", "step_id": "c", "parent_id": "p", "name": "search", "start": 1001.0},
                {"type": "step_update", "step_id": "c", "token": "3 hits"},
                {"type": "step_end", "step_id": "c", "end": 1250.0, "status": "error", "error": "timeout"},
                {"type": "step_end", "step_id": "p", "end": 1400.0, "status": "done", "output": "ok"},
            ):
                yield RunEvent(type=RunEventType(data["type"]), extra_data=data)
            yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Answer")

    async def _no_guardrail(*_a, **_kw):
        return None

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(guardrails, "check_guardrails", _no_guardrail)
    store = MemoryDataStore()
    monkeypatch.setattr(server, "_datastore", store)
    monkeypatch.setattr(server, "get_provider", lambda: Provider())
    monkeypatch.setattr(chat_mod, "_chat_manager", chat_mod.ChatManager())
    sent: list = []

    async def broadcast(sid, event):
        sent.append(dict(event))

    monkeypatch.setattr(chat_mod.get_chat_manager(), "broadcast", broadcast)
    await store.create_session("s-steps")
    await chat_mod._run_and_broadcast("hi", "s-steps", None, None)

    frames = [e for e in sent if e["type"].startswith("step_")]
    assert [e["type"] for e in frames] == ["step_start", "step_start", "step_update", "step_end", "step_end"]
    assert frames[1]["parent_id"] == "p" and frames[3]["error"] == "timeout"
    assert (await store.get_messages("s-steps"))[-1]["steps"] == [
        {"step_id": "p", "status": "done", "name": "plan", "start": 1000.0, "end": 1400.0, "output": "ok"},
        {"step_id": "c", "status": "error", "parent_id": "p", "name": "search", "start": 1001.0,
         "output": "3 hits", "end": 1250.0, "error": "timeout"},
    ]
