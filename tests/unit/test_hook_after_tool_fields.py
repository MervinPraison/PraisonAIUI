"""after_tool hook events carry the tool's output into TOOL_CALL_COMPLETED.

Regression: ``_hook_event_to_run_events`` read ``result`` / ``error``, but
praisonaiagents' ``AfterToolInput`` has ``tool_output`` / ``tool_error``, so
every completed tool row arrived with ``result=None``.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from praisonaiui.providers import RunEventType, _hook_event_to_run_events


def _completed(data):
    events = _hook_event_to_run_events("after_tool", data)
    assert [e.type for e in events] == [RunEventType.TOOL_CALL_COMPLETED]
    return events[0]


def test_reads_the_sdk_field_names():
    ev = _completed(SimpleNamespace(tool_name="search", tool_output="3 hits", tool_error=None))
    assert ev.name == "search"
    assert ev.result == "3 hits"
    assert ev.error is None


def test_reads_the_tool_error():
    ev = _completed(SimpleNamespace(tool_name="search", tool_output=None, tool_error="boom"))
    assert ev.error == "boom"


def test_older_field_names_still_work():
    ev = _completed(SimpleNamespace(tool_name="search", result="ok", error="warn"))
    assert ev.result == "ok"
    assert ev.error == "warn"


def test_real_after_tool_input():
    events = pytest.importorskip("praisonaiagents.hooks.events")
    data = events.AfterToolInput(
        session_id="s",
        cwd=".",
        event_name="after_tool",
        timestamp="0",
        tool_name="search",
        tool_output="found",
        tool_error=None,
    )
    assert _completed(data).result == "found"
