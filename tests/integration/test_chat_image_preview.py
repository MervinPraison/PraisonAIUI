"""Robustness tests for image preview in chat — broadcast, persistence, provider bridge."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import praisonaiui as aiui
from praisonaiui.a2ui_utils import tool_completed_extra
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType


class _ImageStubProvider(BaseProvider):
    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield BaseProvider.message_element_event(
            {"type": "image", "url": "https://example.com/test.png", "alt": "Test"}
        )
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Done.")


class _ToolImageProvider(BaseProvider):
    """Simulates an image tool completing with OpenAI-shaped result."""

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(
            type=RunEventType.TOOL_CALL_STARTED,
            name="generate_image",
            tool_call_id="tc-img-1",
        )
        image_result = {"data": [{"url": "https://example.com/generated.png", "revised_prompt": "A cat"}]}
        yield RunEvent(
            type=RunEventType.TOOL_CALL_COMPLETED,
            name="generate_image",
            tool_call_id="tc-img-1",
            result=image_result,
            extra_data=tool_completed_extra(image_result),
        )
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Here is your image.")


@pytest.fixture()
def client(monkeypatch):
    from starlette.testclient import TestClient

    from praisonaiui.server import create_app

    aiui.set_provider(_ImageStubProvider())
    app = create_app()
    with TestClient(app) as c:
        yield c


def test_run_stream_emits_message_element(client):
    with client.stream(
        "POST",
        "/run",
        json={"message": "draw a cat", "session_id": "img-test-session"},
    ) as resp:
        assert resp.status_code == 200
        body = resp.read().decode()
    assert "message_element" in body
    assert "https://example.com/test.png" in body


def test_message_element_enum_stable():
    assert RunEventType.MESSAGE_ELEMENT.value == "message_element"


def test_serve_generated_media(client, tmp_path, monkeypatch):
    from praisonaiui.features.attachments import AttachmentManager

    mgr = AttachmentManager(storage_dir=str(tmp_path))
    monkeypatch.setattr(
        "praisonaiui.features.attachments._attachment_manager",
        mgr,
    )
    meta = mgr.upload(
        data=b"\x89PNG\r\n\x1a\n",
        filename="generated.png",
        content_type="image/png",
        session_id="media-test",
    )
    resp = client.get(f"/api/chat/media/{meta['id']}")
    assert resp.status_code == 200
    assert resp.content.startswith(b"\x89PNG")


def test_serve_media_not_found(client):
    resp = client.get("/api/chat/media/nonexistent-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_run_and_broadcast_persists_elements():
    broadcasts: list = []

    async def mock_run(content, **kwargs):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield BaseProvider.message_element_event(
            {"type": "image", "url": "https://example.com/persist.png", "alt": "Saved"}
        )
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Saved image.")

    mock_provider = MagicMock()
    mock_provider.run = mock_run
    mock_datastore = AsyncMock()
    mock_datastore.add_message = AsyncMock()

    from praisonaiui.features.chat import _run_and_broadcast, get_chat_manager

    mgr = get_chat_manager()

    async def capture(sid, event):
        broadcasts.append(event)

    with patch("praisonaiui.server.get_provider", return_value=mock_provider), \
         patch("praisonaiui.server._datastore", mock_datastore), \
         patch.object(mgr, "broadcast", capture):
        await _run_and_broadcast(
            content="create image",
            session_id="persist-media-session",
            agent_name=None,
        )

    element_events = [b for b in broadcasts if b.get("type") == "message_element"]
    assert len(element_events) == 1
    assert element_events[0]["element"]["url"] == "https://example.com/persist.png"

    mock_datastore.add_message.assert_called_once()
    saved = mock_datastore.add_message.call_args[0][1]
    assert saved["elements"][0]["url"] == "https://example.com/persist.png"

    history = mgr._history.get("persist-media-session", [])
    assert history[-1].elements[0]["url"] == "https://example.com/persist.png"


@pytest.mark.asyncio
async def test_tool_image_result_broadcasts_message_element():
    broadcasts: list = []
    mock_datastore = AsyncMock()
    mock_datastore.add_message = AsyncMock()

    from praisonaiui.features.chat import _run_and_broadcast, get_chat_manager

    mgr = get_chat_manager()

    async def capture(sid, event):
        broadcasts.append(event)

    with patch("praisonaiui.server.get_provider", return_value=_ToolImageProvider()), \
         patch("praisonaiui.server._datastore", mock_datastore), \
         patch.object(mgr, "broadcast", capture):
        await _run_and_broadcast(
            content="draw a cat",
            session_id="tool-image-session",
            agent_name=None,
        )

    element_events = [b for b in broadcasts if b.get("type") == "message_element"]
    assert len(element_events) == 1
    assert "generated.png" in element_events[0]["element"]["url"]

    tool_done = [b for b in broadcasts if b.get("type") == "tool_call_completed"]
    assert tool_done[0].get("elements")

    saved = mock_datastore.add_message.call_args[0][1]
    assert saved["elements"][0]["type"] == "image"
    assert saved["toolCalls"][0]["elements"][0]["url"].endswith("generated.png")


@pytest.mark.asyncio
async def test_callback_image_queue_yields_message_element():
    import praisonaiui.server as server
    from praisonaiui.providers import PraisonAIProvider

    async def reply(ctx):
        await ctx._stream_queue.put(
            {"type": "image", "url": "https://example.com/callback.png", "alt": "From callback"}
        )

    server._callbacks["reply"] = reply
    try:
        provider = PraisonAIProvider()
        events = [
            ev
            async for ev in provider._run_callback_mode("hi", reply, "callback-media-session", None)
        ]
        media = [e for e in events if e.type == RunEventType.MESSAGE_ELEMENT]
        assert len(media) == 1
        assert media[0].extra_data["element"]["url"] == "https://example.com/callback.png"
    finally:
        server._callbacks.pop("reply", None)


@pytest.mark.asyncio
async def test_duplicate_element_urls_deduped_in_history():
    mock_datastore = AsyncMock()
    mock_datastore.add_message = AsyncMock()

    async def mock_run(content, **kwargs):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        url = "https://example.com/same.png"
        yield BaseProvider.message_element_event({"type": "image", "url": url, "alt": "A"})
        yield RunEvent(
            type=RunEventType.TOOL_CALL_COMPLETED,
            name="generate_image",
            tool_call_id="tc-dup",
            result={"data": [{"url": url}]},
            extra_data=tool_completed_extra({"data": [{"url": url}]}),
        )
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Done.")

    mock_provider = MagicMock()
    mock_provider.run = mock_run

    from praisonaiui.features.chat import _run_and_broadcast, get_chat_manager

    mgr = get_chat_manager()

    with patch("praisonaiui.server.get_provider", return_value=mock_provider), \
         patch("praisonaiui.server._datastore", mock_datastore), \
         patch.object(mgr, "broadcast", AsyncMock()):
        await _run_and_broadcast(
            content="dup test",
            session_id="dedup-session",
            agent_name=None,
        )

    saved = mock_datastore.add_message.call_args[0][1]
    assert len(saved["elements"]) == 1


@pytest.mark.asyncio
async def test_direct_mode_image_agent_dict_yields_message_element():
    from praisonaiui.providers import PraisonAIProvider

    class FakeImageAgent:
        name = "Image Bot"

        def chat(self, message, stream=False, **kwargs):
            return {"data": [{"url": "https://example.com/agent.png", "revised_prompt": "sunset"}]}

    provider = PraisonAIProvider(agent=FakeImageAgent())
    events = [
        ev
        async for ev in provider._run_direct_mode(
            "a sunset",
            session_id="agent-img-session",
            agent_name=None,
        )
    ]
    media = [e for e in events if e.type == RunEventType.MESSAGE_ELEMENT]
    assert len(media) == 1
    assert media[0].extra_data["element"]["url"] == "https://example.com/agent.png"
    completed = [e for e in events if e.type == RunEventType.RUN_COMPLETED][-1]
    assert completed.content == "Here is your generated image."


@pytest.mark.asyncio
async def test_image_only_run_persists_without_text():
    broadcasts: list = []
    mock_datastore = AsyncMock()
    mock_datastore.add_message = AsyncMock()

    async def mock_run(content, **kwargs):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield BaseProvider.message_element_event(
            {"type": "image", "url": "https://example.com/only-image.png", "alt": ""}
        )
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="")

    mock_provider = MagicMock()
    mock_provider.run = mock_run

    from praisonaiui.features.chat import _run_and_broadcast, get_chat_manager

    mgr = get_chat_manager()

    async def capture(sid, event):
        broadcasts.append(event)

    with patch("praisonaiui.server.get_provider", return_value=mock_provider), \
         patch("praisonaiui.server._datastore", mock_datastore), \
         patch.object(mgr, "broadcast", capture):
        await _run_and_broadcast(
            content="image only",
            session_id="image-only-session",
            agent_name=None,
        )

    saved = mock_datastore.add_message.call_args[0][1]
    assert saved["content"] == ""
    assert saved["elements"][0]["url"] == "https://example.com/only-image.png"
