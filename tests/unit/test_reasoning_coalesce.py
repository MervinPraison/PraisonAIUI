"""Streamed reasoning arrives as one reasoning block, not one row per piece.

Regression: each ``is_reasoning`` ``DELTA_TEXT`` stream event became its own
``REASONING_STEP``, and the dashboard chat and the app shell both draw one
row per step, so a reasoning model's thinking showed one row per word.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from praisonaiui.provider import RunEvent, RunEventType
from praisonaiui.providers import PraisonAIProvider, _ReasoningCoalescer

R = RunEventType


def _delta(text: str) -> RunEvent:
    return RunEvent(type=R.REASONING_STEP, token=text, step=text)


def test_consecutive_pieces_become_one_step():
    c = _ReasoningCoalescer()
    assert c.feed(_delta("Let ")) == []
    assert c.feed(_delta("me think")) == []
    content = RunEvent(type=R.RUN_CONTENT, token="Hi")
    out = c.feed(content)
    assert [e.type for e in out] == [
        R.REASONING_STARTED,
        R.REASONING_STEP,
        R.REASONING_COMPLETED,
        R.RUN_CONTENT,
    ]
    assert out[1].step == "Let me think"
    assert out[1].token is None
    assert out[-1] is content
    assert c.flush() == []


def test_flush_at_the_end_of_the_run():
    c = _ReasoningCoalescer()
    c.feed(_delta("only thinking"))
    out = c.flush()
    assert [e.step for e in out] == [None, "only thinking", None]


def test_whole_steps_and_blank_pieces_pass_or_vanish():
    c = _ReasoningCoalescer()
    thought = RunEvent(type=R.REASONING_STEP, step="Plan the answer")
    assert c.feed(thought) == [thought]
    c.feed(_delta("  "))
    assert c.flush() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("live", [True, False], ids=["while-running", "after-the-run"])
async def test_direct_mode_streams_one_reasoning_block(live):
    sev = pytest.importorskip("praisonaiagents.streaming")
    callbacks = []
    agent = MagicMock()
    agent.name = "assistant"
    agent.stream_emitter = MagicMock()
    agent.stream_emitter.add_callback = callbacks.append
    agent.stream_emitter.get_metrics = MagicMock(return_value=None)

    async def emit(**fields):
        for cb in callbacks:
            cb(sev.StreamEvent(type=sev.StreamEventType.DELTA_TEXT, **fields))
        if live:  # let the drain loop take it before the run ends
            await asyncio.sleep(0.01)

    async def achat(message, stream=True, **kwargs):
        for piece in ("The ", "user ", "says hi"):
            await emit(content=piece, is_reasoning=True)
        await emit(content="Hello")
        return "Hello"

    agent.achat = achat
    provider = PraisonAIProvider(agent=agent)
    events = [ev async for ev in provider._run_direct_mode("hi", session_id="s1", agent_name=None)]
    steps = [e for e in events if e.type == R.REASONING_STEP]
    assert [e.step for e in steps] == ["The user says hi"]
    types = [e.type for e in events]
    i = types.index(R.REASONING_STARTED)
    assert types[i : i + 4] == [R.REASONING_STARTED, R.REASONING_STEP, R.REASONING_COMPLETED, R.RUN_CONTENT]
