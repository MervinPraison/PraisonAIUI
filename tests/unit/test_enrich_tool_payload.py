"""Tool display metadata never ends a chat turn.

Regression: ``_enrich_tool_payload`` only caught ImportError/AttributeError,
and its fallback did ``key in args`` / ``args[key]`` on the JSON *string* a
streamed tool call carries, so a run died with "string indices must be
integers" before the agent answered.
"""

from __future__ import annotations

import sys
from types import ModuleType

import pytest

from praisonaiui.features.chat import _enrich_tool_payload


@pytest.fixture
def no_editor(monkeypatch):
    """praisonaiagents.output.editor unavailable: the fallback formats."""
    monkeypatch.setitem(sys.modules, "praisonaiagents.output.editor", None)


@pytest.fixture
def broken_editor(monkeypatch):
    mod = ModuleType("praisonaiagents.output.editor")
    mod.TOOL_LABELS = {}

    class EditorOutput:
        @staticmethod
        def _format_action(*_a):
            raise TypeError("string indices must be integers")

        @staticmethod
        def _format_result(*_a):
            raise ValueError("bad result")

    mod.EditorOutput = EditorOutput
    monkeypatch.setitem(sys.modules, "praisonaiagents.output.editor", mod)


def test_string_args_are_parsed_for_the_fallback(no_editor):
    payload = _enrich_tool_payload({"name": "web_search", "args": '{"query": "aiui"}'}, 1)
    assert payload["description"] == '🔧 Using web_search for "aiui"'
    assert payload["args"] == '{"query": "aiui"}'  # the wire payload is left as sent
    assert payload["step_number"] == 1


@pytest.mark.parametrize("args", ['{"query": "a', "not json", "[1, 2]", 42])
def test_unparseable_args_do_not_raise(no_editor, args):
    payload = _enrich_tool_payload({"name": "t", "args": args}, 2)
    assert payload["description"] == "🔧 Using t"


def test_a_formatter_error_does_not_raise(broken_editor):
    started = _enrich_tool_payload({"name": "t", "args": '{"query": "q"}'}, 3)
    assert started["description"] == '🔧 Using t for "q"'
    done = _enrich_tool_payload({"name": "t", "result": "ok"}, 3, is_completed=True)
    assert done["formatted_result"] == "✓ Done"
