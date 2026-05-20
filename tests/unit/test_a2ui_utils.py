"""Unit tests for A2UI payload detection and normalisation."""

import pytest

from praisonaiui.a2ui_utils import (
    A2UI_MIME_TYPE,
    build_a2ui_extra,
    infer_surface_id,
    is_a2ui_tool_result,
    normalise_a2ui_messages,
)


class TestIsA2uiToolResult:
    def test_mime_type_dict(self):
        assert is_a2ui_tool_result({"mime_type": A2UI_MIME_TYPE, "messages": []})

    def test_messages_list(self):
        assert is_a2ui_tool_result({"messages": [{"createSurface": {"surfaceId": "x"}}]})

    def test_bare_message_list(self):
        assert is_a2ui_tool_result([{"createSurface": {"surfaceId": "y"}}])

    def test_plain_string_false(self):
        assert not is_a2ui_tool_result("hello")

    def test_plain_dict_false(self):
        assert not is_a2ui_tool_result({"status": "ok"})


class TestNormaliseA2uiMessages:
    def test_adds_version(self):
        msgs = normalise_a2ui_messages({"messages": [{"createSurface": {"surfaceId": "a"}}]})
        assert len(msgs) == 1
        assert msgs[0]["version"] == "v0.9"

    def test_preserves_existing_version(self):
        msgs = normalise_a2ui_messages({"messages": [{"version": "v0.10", "createSurface": {}}]})
        assert msgs[0]["version"] == "v0.10"


class TestInferSurfaceId:
    def test_from_create_surface(self):
        result = {"messages": [{"createSurface": {"surfaceId": "panel-1"}}]}
        assert infer_surface_id(result) == "panel-1"

    def test_default(self):
        assert infer_surface_id({"messages": [{"updateComponents": {}}]}) == "main"


class TestBuildA2uiExtra:
    def test_builds_extra(self):
        result = {
            "mime_type": A2UI_MIME_TYPE,
            "messages": [{"createSurface": {"surfaceId": "s1"}}],
        }
        extra = build_a2ui_extra(result)
        assert extra is not None
        assert extra["surface_id"] == "s1"
        assert len(extra["a2ui"]) == 1

    def test_non_a2ui_returns_none(self):
        assert build_a2ui_extra({"result": "ok"}) is None


class TestToolCompletedExtra:
    def test_includes_a2ui_and_flags(self):
        from praisonaiui.a2ui_utils import tool_completed_extra

        result = {
            "mime_type": A2UI_MIME_TYPE,
            "messages": [{"createSurface": {"surfaceId": "main"}}],
        }
        extra = tool_completed_extra(result)
        assert extra["has_complete_args"] is True
        assert "a2ui" in extra
        assert extra["surface_id"] == "main"

    def test_includes_media_elements(self):
        from praisonaiui.a2ui_utils import tool_completed_extra

        result = {"data": [{"url": "https://example.com/out.png", "revised_prompt": "A cat"}]}
        extra = tool_completed_extra(result)
        assert extra["has_complete_args"] is True
        assert "elements" in extra
        assert extra["elements"][0]["type"] == "image"
        assert extra["elements"][0]["url"] == "https://example.com/out.png"

    def test_plain_result_only_flags(self):
        from praisonaiui.a2ui_utils import tool_completed_extra

        extra = tool_completed_extra("done")
        assert extra == {"has_complete_args": True}


class TestHookAndCallbackA2ui:
    def test_after_tool_hook_attaches_a2ui(self):
        from types import SimpleNamespace

        from praisonaiui.providers import _hook_event_to_run_events

        payload = SimpleNamespace(
            tool_name="send_a2ui_messages",
            result={
                "mime_type": A2UI_MIME_TYPE,
                "messages": [{"createSurface": {"surfaceId": "hook-main"}}],
            },
            error=None,
        )
        events = _hook_event_to_run_events("after_tool", payload)
        assert len(events) == 1
        assert events[0].extra_data is not None
        assert events[0].extra_data.get("surface_id") == "hook-main"
