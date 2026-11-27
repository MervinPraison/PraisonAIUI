"""Tests for composable aiui.chat_panel() block."""

from __future__ import annotations

import pytest

import praisonaiui as aiui


def test_chat_panel_defaults_and_options():
    basic = aiui.chat_panel()
    assert basic == {"type": "chat_panel", "title": "Agent Chat", "height": 520}

    custom = aiui.chat_panel(
        title="Ask about this document",
        agent="researcher",
        height="70vh",
        session_id="sess-42",
        welcome="Ask me anything about the report on the left.",
    )
    assert custom == {
        "type": "chat_panel",
        "title": "Ask about this document",
        "height": "70vh",
        "agent": "researcher",
        "session_id": "sess-42",
        "welcome": "Ask me anything about the report on the left.",
    }


@pytest.mark.parametrize("bad_height", [0, 100, -50, True])
def test_chat_panel_rejects_invalid_height(bad_height):
    with pytest.raises(ValueError, match="height"):
        aiui.chat_panel(height=bad_height)
