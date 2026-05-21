"""Unit tests for ingest_a2ui_extra and normalisation edge cases."""

import pytest

from praisonaiui.a2ui_utils import (
    A2UI_MIME_TYPE,
    normalise_a2ui_messages,
)


class TestNormaliseEdgeCases:
    def test_mimetype_alias(self):
        msgs = normalise_a2ui_messages(
            {"mimeType": A2UI_MIME_TYPE, "messages": [{"createSurface": {"surfaceId": "a"}}]}
        )
        assert msgs[0]["version"] == "v0.9"

    def test_bare_message_dict(self):
        msgs = normalise_a2ui_messages({"createSurface": {"surfaceId": "bare"}})
        assert len(msgs) == 1

    def test_a2ui_part_nesting(self):
        msgs = normalise_a2ui_messages(
            {
                "a2ui_part": {
                    "messages": [{"createSurface": {"surfaceId": "nested"}}]
                }
            }
        )
        assert len(msgs) == 1


@pytest.mark.asyncio
async def test_ingest_a2ui_extra_applies_and_broadcasts(monkeypatch):
    from praisonaiui.features import surfaces

    broadcast_calls = []

    async def fake_broadcast(surface_id, messages, session_id=None):
        broadcast_calls.append((surface_id, messages, session_id))

    monkeypatch.setattr(surfaces, "broadcast_a2ui_surface", fake_broadcast)

    extra = {
        "surface_id": "main",
        "a2ui": [{"createSurface": {"surfaceId": "main", "catalogId": "basic"}}],
    }
    result = await surfaces.ingest_a2ui_extra(extra, session_id="sess-1")
    assert result is not None
    assert result["surface_id"] == "main"
    assert len(result["messages"]) >= 1
    assert broadcast_calls
    assert broadcast_calls[0][0] == "main"
