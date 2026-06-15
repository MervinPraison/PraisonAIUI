"""Integration tests for A2UI — provider bridge, /run SSE, surfaces, and tool payload."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import praisonaiui as aiui
from praisonaiui.a2ui_utils import A2UI_MIME_TYPE, tool_completed_extra
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType


def _a2ui_tool_result(surface_id: str = "main") -> dict:
    """Shape returned by praisonaiagents send_a2ui_messages."""
    return {
        "mime_type": A2UI_MIME_TYPE,
        "messages": [
            {
                "version": "v0.9",
                "createSurface": {"surfaceId": surface_id, "catalogId": "basic"},
                "updateComponents": {
                    "surfaceId": surface_id,
                    "components": [
                        {
                            "id": "txt1",
                            "component": {"Text": {"text": {"literal": "Hello A2UI"}}},
                        }
                    ],
                },
            }
        ],
    }


class _A2uiStubProvider(BaseProvider):
    """Simulates send_a2ui_messages completing with an A2UI payload."""

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(
            type=RunEventType.TOOL_CALL_STARTED,
            name="send_a2ui_messages",
            tool_call_id="tc-a2ui-1",
        )
        result = _a2ui_tool_result()
        yield RunEvent(
            type=RunEventType.TOOL_CALL_COMPLETED,
            name="send_a2ui_messages",
            tool_call_id="tc-a2ui-1",
            result=result,
            extra_data=tool_completed_extra(result),
        )
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="UI rendered.")


def _parse_sse(text: str) -> list:
    events = []
    for line in text.strip().split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            try:
                events.append(json.loads(line[len("data:") :].strip()))
            except json.JSONDecodeError:
                pass
    return events


@pytest.fixture()
def a2ui_client(monkeypatch):
    from starlette.testclient import TestClient

    from praisonaiui.server import create_app, reset_state

    reset_state()
    aiui.set_provider(_A2uiStubProvider())

    mock_mgr = MagicMock()
    mock_mgr.store = MagicMock()
    monkeypatch.setattr(
        "praisonaiui.features.memory.get_memory_manager",
        lambda: mock_mgr,
    )

    app = create_app()
    return TestClient(app)


def test_run_stream_emits_a2ui(a2ui_client):
    with a2ui_client.stream(
        "POST",
        "/run",
        json={"message": "show a card", "session_id": "a2ui-run-session"},
    ) as resp:
        assert resp.status_code == 200
        body = resp.read().decode()

    events = _parse_sse(body)
    completed = [e for e in events if e.get("type") == "tool_call_completed"]
    assert len(completed) == 1
    assert completed[0].get("name") == "send_a2ui_messages"
    assert "a2ui" in completed[0]
    assert completed[0]["surface_id"] == "main"
    assert completed[0]["a2ui"][0]["createSurface"]["surfaceId"] == "main"


def test_surface_updated_after_run(a2ui_client):
    a2ui_client.post(
        "/run",
        json={"message": "show ui", "session_id": "a2ui-surface-session"},
    )
    state = a2ui_client.get("/api/surfaces/main").json()
    assert state.get("messages")
    assert state["messages"][0].get("createSurface")


@pytest.mark.asyncio
async def test_run_and_broadcast_persists_a2ui():
    broadcasts: list = []

    async def mock_run(content, **kwargs):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        result = _a2ui_tool_result("panel-1")
        yield RunEvent(
            type=RunEventType.TOOL_CALL_COMPLETED,
            name="send_a2ui_messages",
            tool_call_id="tc-bc-1",
            result=result,
            extra_data=tool_completed_extra(result),
        )
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Done.")

    mock_provider = MagicMock()
    mock_provider.run = mock_run
    mock_datastore = AsyncMock()
    mock_datastore.add_message = AsyncMock()

    from praisonaiui.features.chat import _run_and_broadcast, get_chat_manager

    mgr = get_chat_manager()

    with patch("praisonaiui.server.get_provider", return_value=mock_provider), \
         patch("praisonaiui.server._datastore", mock_datastore), \
         patch.object(mgr, "broadcast", AsyncMock(side_effect=lambda sid, p: broadcasts.append(p))):
        await _run_and_broadcast(
            content="build ui",
            session_id="a2ui-broadcast-session",
            agent_name=None,
        )

    tool_done = [b for b in broadcasts if b.get("type") == "tool_call_completed"]
    assert tool_done
    assert tool_done[0].get("a2ui")
    assert tool_done[0]["surface_id"] == "panel-1"

    saved = mock_datastore.add_message.call_args[0][1]
    assert saved["toolCalls"][0].get("a2ui")
    assert saved["toolCalls"][0]["surface_id"] == "panel-1"


def test_send_a2ui_messages_real_tool_extra():
    pytest.importorskip("a2ui", reason="a2ui-agent-sdk not installed")

    from praisonaiagents.tools.a2ui_tools import send_a2ui_messages

    from praisonaiui.providers import _tool_completed_extra_from_result

    result = send_a2ui_messages(
        messages=[{"createSurface": {"surfaceId": "real-main", "catalogId": "basic"}}]
    )
    extra = _tool_completed_extra_from_result(result)
    assert extra is not None
    assert "a2ui" in extra
    assert extra["surface_id"] == "real-main"


def test_example_app_wiring():
    """Smoke: example 29 registers agent, pages, and preview config."""
    import sys
    from pathlib import Path

    example_dir = Path(__file__).resolve().parents[2] / "examples" / "python" / "29-a2ui-canvas"
    if not example_dir.is_dir():
        pytest.skip("example app not present")

    sys.path.insert(0, str(example_dir))
    try:
        from app import create_app
    finally:
        sys.path.pop(0)

    from starlette.testclient import TestClient

    client = TestClient(create_app())
    page_ids = [p["id"] for p in client.get("/api/pages").json().get("pages", [])]
    assert "chat-canvas" in page_ids

    preview = client.get("/ui-config.json").json()["chat"]["preview"]
    assert preview["enabled"] is True
    assert preview["surfaceId"] == "main"
