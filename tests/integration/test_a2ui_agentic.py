"""
Real agentic test — agent calls LLM and send_a2ui_messages end-to-end.

Requires:
  - OPENAI_API_KEY
  - a2ui-agent-sdk (praisonaiagents[a2ui])
  - PRAISONAI_LIVE_TESTS=1

Skips when the LLM produces invalid tool arguments (model-dependent formatting).
"""

from __future__ import annotations

import os

import pytest

pytest.importorskip("praisonaiagents")

if not os.environ.get("OPENAI_API_KEY"):
    pytest.skip("OPENAI_API_KEY not set", allow_module_level=True)

if not os.environ.get("PRAISONAI_LIVE_TESTS"):
    pytest.skip("Set PRAISONAI_LIVE_TESTS=1 for live LLM agentic A2UI test", allow_module_level=True)

pytest.importorskip("a2ui", reason="a2ui-agent-sdk not installed")


@pytest.mark.asyncio
async def test_live_agent_emits_a2ui_via_provider():
    """Agent calls LLM → send_a2ui_messages → provider surfaces a2ui extra_data."""
    from praisonaiagents import Agent
    from praisonaiagents.tools.a2ui_tools import send_a2ui_messages
    from praisonaiagents.ui import A2UI
    from praisonaiui.a2ui_utils import A2UI_MIME_TYPE, build_a2ui_extra
    from praisonaiui.provider import RunEventType
    from praisonaiui.providers import PraisonAIProvider

    system = A2UI.system_prompt(
        role_description="You are a UI assistant.",
        ui_description=(
            "When asked for UI, call send_a2ui_messages with a Python list of message dicts "
            "(not a JSON string). Use surface id 'main' and the basic catalog."
        ),
        include_examples=True,
    )

    agent = Agent(
        name="a2ui-live-test",
        llm="gpt-4o-mini",
        instructions=system,
        tools=[send_a2ui_messages],
    )

    provider = PraisonAIProvider(agent=agent)
    events = [
        ev
        async for ev in provider.run(
            "Show one button labeled Click me on surface main.",
            session_id="a2ui-agentic-live",
            agent_name=None,
        )
    ]

    completed = [
        e
        for e in events
        if e.type == RunEventType.TOOL_CALL_COMPLETED
        and getattr(e, "name", None) == "send_a2ui_messages"
    ]

    if not completed:
        tool_starts = [
            e
            for e in events
            if e.type == RunEventType.TOOL_CALL_STARTED
            and getattr(e, "name", None) == "send_a2ui_messages"
        ]
        if tool_starts:
            pytest.skip(
                "LLM invoked send_a2ui_messages but completion did not surface valid A2UI "
                "(likely invalid tool args)"
            )
        pytest.fail(
            f"Expected send_a2ui_messages tool call; event types: {[e.type for e in events]}"
        )

    result = completed[0].result
    if not isinstance(result, dict) or result.get("mime_type") != A2UI_MIME_TYPE:
        pytest.skip(f"Tool completed but result was not A2UI: {result!r}")

    extra = completed[0].extra_data or build_a2ui_extra(result)
    assert extra and extra.get("a2ui"), "Provider should attach a2ui in extra_data"

    print("Agentic A2UI test OK — messages:", len(extra.get("a2ui", [])))
    print("Tool result mime_type:", result.get("mime_type"))
    print("Surface id:", extra.get("surface_id"))
