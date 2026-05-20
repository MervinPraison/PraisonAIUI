"""Unit tests for media payload detection and normalisation."""

from __future__ import annotations

import base64

from praisonaiui.media_utils import (
    build_media_extra,
    extract_media_elements,
    is_media_tool_result,
    media_serve_url,
    queue_event_to_element,
)


class TestExtractMediaElements:
    def test_openai_shape_with_url(self):
        result = {"data": [{"url": "https://example.com/a.png", "revised_prompt": "A cat"}]}
        els = extract_media_elements(result, persist_b64=False)
        assert len(els) == 1
        assert els[0]["type"] == "image"
        assert els[0]["url"] == "https://example.com/a.png"
        assert els[0]["alt"] == "A cat"

    def test_explicit_element_dict(self):
        el = {"type": "image", "url": "https://example.com/x.jpg", "alt": "x"}
        assert extract_media_elements(el, persist_b64=False) == [el]

    def test_plain_image_url_string(self):
        url = "https://cdn.example.com/out.png"
        els = extract_media_elements(url, persist_b64=False)
        assert els == [{"type": "image", "url": url, "alt": "Image"}]

    def test_data_url_passthrough(self):
        data_url = "data:image/png;base64,abc123"
        els = extract_media_elements(data_url, persist_b64=False)
        assert els[0]["url"] == data_url

    def test_b64_stored_when_persist_enabled(self, monkeypatch):
        stored: dict = {}

        class FakeMgr:
            def upload(self, data, filename, content_type, session_id=""):
                stored["data"] = data
                return {"id": "att-123"}

        monkeypatch.setattr(
            "praisonaiui.features.attachments.get_attachment_manager",
            lambda: FakeMgr(),
        )
        raw = b"\x89PNG"
        b64 = base64.b64encode(raw).decode()
        els = extract_media_elements({"data": [{"b64_json": b64}]}, persist_b64=True)
        assert els[0]["url"] == media_serve_url("att-123")
        assert stored["data"] == raw

    def test_elements_nested_in_dict(self):
        result = {"elements": [{"type": "video", "url": "https://example.com/v.mp4"}]}
        els = extract_media_elements(result, persist_b64=False)
        assert els[0]["type"] == "video"

    def test_plain_dict_not_media(self):
        assert extract_media_elements({"status": "ok"}, persist_b64=False) == []


class TestIsMediaToolResult:
    def test_true_for_openai(self):
        assert is_media_tool_result({"data": [{"url": "https://x.com/a.png"}]})

    def test_false_for_text(self):
        assert not is_media_tool_result("hello")


class TestBuildMediaExtra:
    def test_builds_elements_key(self):
        extra = build_media_extra({"data": [{"url": "https://x.com/a.png"}]}, persist_b64=False)
        assert extra is not None
        assert len(extra["elements"]) == 1

    def test_none_when_empty(self):
        assert build_media_extra("nope", persist_b64=False) is None


class TestQueueEventToElement:
    def test_image_event(self):
        el = queue_event_to_element({"type": "image", "url": "https://x.com/i.png", "alt": "Hi"})
        assert el == {"type": "image", "url": "https://x.com/i.png", "alt": "Hi"}

    def test_file_event(self):
        el = queue_event_to_element({"type": "file", "url": "https://x.com/f.pdf", "name": "f.pdf"})
        assert el["type"] == "file"
        assert el["name"] == "f.pdf"


class TestImageResultObject:
    def test_dataclass_like_object(self):
        from dataclasses import dataclass

        @dataclass
        class ImageResult:
            url: str = "https://example.com/img.png"
            b64_json: str | None = None
            revised_prompt: str = "prompt"

        els = extract_media_elements(ImageResult(), persist_b64=False)
        assert els[0]["url"] == "https://example.com/img.png"
        assert els[0]["alt"] == "prompt"


class TestMultipleImages:
    def test_openai_multi_data(self):
        result = {
            "data": [
                {"url": "https://example.com/a.png"},
                {"url": "https://example.com/b.png"},
            ]
        }
        els = extract_media_elements(result, persist_b64=False)
        assert len(els) == 2


class TestB64Fallback:
    def test_invalid_b64_falls_back_to_data_url(self, monkeypatch):
        def fail_upload(*args, **kwargs):
            raise ValueError("upload failed")

        monkeypatch.setattr(
            "praisonaiui.media_utils._store_b64_image",
            fail_upload,
        )
        els = extract_media_elements({"data": [{"b64_json": "not-valid-b64!!!"}]}, persist_b64=True)
        assert len(els) == 1
        assert els[0]["url"].startswith("data:image/png;base64,")


class TestCollectElementDedup:
    def test_dedupes_by_url(self):
        from praisonaiui.features.chat import _collect_element

        collected: list = []
        el = {"type": "image", "url": "https://example.com/x.png"}
        _collect_element(collected, el)
        _collect_element(collected, dict(el))
        assert len(collected) == 1
