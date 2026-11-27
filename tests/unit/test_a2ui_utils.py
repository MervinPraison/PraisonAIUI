"""Unit tests for A2UI payload detection and normalisation."""


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

    def test_mimetype_alias(self):
        assert is_a2ui_tool_result({"mimeType": A2UI_MIME_TYPE, "messages": []})

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


class TestCoerceA2uiToolMessages:
    def test_bare_button_dict(self):
        from praisonaiui.a2ui_utils import coerce_a2ui_tool_messages

        msgs = coerce_a2ui_tool_messages({"component": "Button", "text": {"literal": "Submit"}})
        assert msgs[0]["createSurface"]["surfaceId"] == "main"
        assert msgs[-1]["updateComponents"]["components"][0]["text"]["literal"] == "Submit"

    def test_components_wrapper(self):
        from praisonaiui.a2ui_utils import coerce_a2ui_tool_messages

        msgs = coerce_a2ui_tool_messages(
            {"components": [{"component": "Text", "text": {"literal": "Hi"}}]}
        )
        assert msgs[-1]["updateComponents"]["components"][0]["component"] == "Text"


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


class TestV08CompatibilityAndBuilders:
    def test_v08_messages_detected_and_upgraded_to_v09(self):
        from praisonaiui.a2ui_utils import v08_to_v09

        v08 = [
            {
                "surfaceUpdate": {
                    "surfaceId": "booking",
                    "components": [
                        {
                            "id": "main-col",
                            "component": {
                                "Column": {
                                    "children": {"explicitList": ["title", "btn"]},
                                    "distribution": "start",
                                    "alignment": "stretch",
                                }
                            },
                        },
                        {
                            "id": "title",
                            "component": {
                                "Text": {"text": {"path": "/headline"}, "usageHint": "h1"}
                            },
                        },
                        {
                            "id": "btn",
                            "component": {
                                "Button": {
                                    "child": "btn-txt",
                                    "primary": True,
                                    "action": {"name": "book", "context": [{"key": "id", "value": {"literalString": "42"}}]},
                                }
                            },
                        },
                    ],
                }
            },
            {
                "dataModelUpdate": {
                    "surfaceId": "booking",
                    "path": "/",
                    "contents": [
                        {"key": "headline", "valueString": "Reserve Table"},
                        {"key": "guests", "valueNumber": 4},
                    ],
                }
            },
            {
                "beginRendering": {
                    "surfaceId": "booking",
                    "root": "main-col",
                    "styles": {"primaryColor": "#0f766e"},
                }
            },
        ]

        assert is_a2ui_tool_result(v08)
        v09 = v08_to_v09(v08)
        assert v09[0]["createSurface"]["surfaceId"] == "booking"
        assert v09[0]["createSurface"]["theme"] == {"primaryColor": "#0f766e"}
        comps = v09[1]["updateComponents"]["components"]
        assert comps[0]["id"] == "root"
        assert comps[0]["component"] == "Column"
        assert comps[0]["children"] == ["title", "btn"]
        assert comps[0]["justify"] == "start"
        assert comps[1]["text"] == {"path": "/headline"}
        assert comps[1]["variant"] == "h1"
        assert comps[2]["variant"] == "primary"
        assert comps[2]["action"] == {"event": {"name": "book", "context": {"id": "42"}}}
        assert v09[2]["updateDataModel"]["value"] == {"headline": "Reserve Table", "guests": 4}

    def test_jsonl_parsing_and_coercion(self):
        from praisonaiui.a2ui_utils import coerce_a2ui_tool_messages, parse_a2ui_jsonl

        jsonl = "\n".join(
            [
                '{"version":"v0.9","createSurface":{"surfaceId":"s1","catalogId":"basic"}}',
                '{"version":"v0.9","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Text","text":{"path":"/msg"}}]}}',
                '{"version":"v0.9","updateDataModel":{"surfaceId":"s1","path":"/","value":{"msg":"Hi"}}}',
            ]
        )
        parsed = parse_a2ui_jsonl(jsonl)
        assert len(parsed) == 3
        coerced = coerce_a2ui_tool_messages(jsonl)
        assert coerced[0]["createSurface"]["surfaceId"] == "s1"
        assert coerced[2]["updateDataModel"]["value"]["msg"] == "Hi"

    def test_builders_and_capabilities(self):
        import praisonaiui as aiui

        msgs = aiui.a2ui_surface(
            [{"id": "root", "component": "Text", "text": {"path": "/hello"}}],
            data={"hello": "World"},
            surface_id="demo",
            theme={"primaryColor": "#2563eb"},
            send_data_model=True,
        )
        assert len(msgs) == 3
        assert msgs[0]["createSurface"]["theme"] == {"primaryColor": "#2563eb"}
        assert msgs[0]["createSurface"]["sendDataModel"] is True
        assert msgs[2]["updateDataModel"]["value"] == {"hello": "World"}

        caps = aiui.a2ui_client_capabilities()
        assert len(caps["components"]) == 18
        assert len(caps["functions"]) == 14
        assert "v0.8" in caps["supportedVersions"]
        assert "v0.9" in caps["supportedVersions"]
        assert "v0.10" in caps["supportedVersions"]


class TestSurfacesEndpointsComplete:
    def test_capabilities_actions_envelopes_and_delete_surface(self):
        from starlette.testclient import TestClient

        import praisonaiui as aiui
        from praisonaiui.server import create_app, reset_state

        reset_state()
        received = []

        @aiui.surface_action("demo")
        async def handle(act):
            received.append(act)
            return {"ok": True}

        client = TestClient(create_app())

        caps = client.get("/api/surfaces/capabilities")
        assert caps.status_code == 200
        assert len(caps.json()["components"]) == 18

        # Push surface with theme + data model
        msgs = aiui.a2ui_surface(
            [{"id": "root", "component": "Text", "text": {"path": "/k"}}],
            data={"k": "v"},
            surface_id="demo",
            theme={"primaryColor": "#111827"},
        )
        post = client.post("/api/surfaces/demo/messages", json={"messages": msgs})
        assert post.status_code == 200

        state = client.get("/api/surfaces/demo").json()
        assert state["metadata"]["theme"] == {"primaryColor": "#111827"}

        # Official v0.9 client-to-server action envelope on /actions alias
        r1 = client.post(
            "/api/surfaces/demo/actions",
            json={
                "version": "v0.9",
                "action": {
                    "name": "save",
                    "surfaceId": "demo",
                    "sourceComponentId": "save-btn",
                    "context": {"k": "v"},
                },
            },
        )
        assert r1.status_code == 200
        assert received[-1]["action"] == "save"
        assert received[-1]["component_id"] == "save-btn"
        assert received[-1]["data"] == {"k": "v"}

        # Official v0.8 userAction envelope on /action
        r2 = client.post(
            "/api/surfaces/demo/action",
            json={"userAction": {"name": "legacy_click", "sourceComponentId": "b1", "context": {"x": 1}}},
        )
        assert r2.status_code == 200
        assert received[-1]["action"] == "legacy_click"

        # deleteSurface message clears stored messages
        r3 = client.post(
            "/api/surfaces/demo/messages",
            json={"messages": [aiui.a2ui_delete_surface("demo")]},
        )
        assert r3.status_code == 200
        assert client.get("/api/surfaces/demo").json()["messages"] == []
