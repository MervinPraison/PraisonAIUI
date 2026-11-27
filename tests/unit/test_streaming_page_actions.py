"""Tests for streaming (yield) @aiui.register_page_action handlers and sheet save action."""

from __future__ import annotations

import asyncio
import json

from starlette.testclient import TestClient

import praisonaiui as aiui
from praisonaiui import server as srv


def _parse_ndjson(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def test_sync_and_async_dict_actions_keep_returning_json(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    srv.reset_state()

    @aiui.page("plain", title="Plain")
    async def plain_page():
        return aiui.layout([aiui.text("hello")])

    @aiui.register_page_action("plain")
    async def plain_action(data):
        return aiui.layout([aiui.text(f"echo:{data.get('x')}")])

    with TestClient(srv.create_app()) as client:
        res = client.post("/api/pages/plain/action", json={"x": "ok"})
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("application/json")
        assert res.json()["_components"][0]["content"] == "echo:ok"


def test_async_generator_action_streams_ndjson_frames(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    srv.reset_state()

    @aiui.page("streamer", title="Streamer")
    async def streamer_page():
        return aiui.layout([aiui.text("idle")])

    @aiui.register_page_action("streamer")
    async def streamer_action(data):
        prompt = data.get("prompt", "")
        acc = ""
        for chunk in ("Hello ", f"{prompt}!"):
            acc += chunk
            await asyncio.sleep(0)
            yield aiui.layout([aiui.markdown_text(acc)])
        yield {"message": "Finished"}

    with TestClient(srv.create_app()) as client:
        res = client.post("/api/pages/streamer/action", json={"prompt": "World"})
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("application/x-ndjson")
        assert res.headers.get("cache-control") == "no-cache"
        assert res.headers.get("x-accel-buffering") == "no"
        frames = _parse_ndjson(res.text)
        assert len(frames) == 3
        assert frames[0]["_components"][0]["content"] == "Hello "
        assert frames[1]["_components"][0]["content"] == "Hello World!"
        assert frames[2] == {"message": "Finished"}


def test_sync_generator_and_midstream_error_emit_ndjson_error_frame(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    srv.reset_state()

    @aiui.page("gen", title="Gen")
    def gen_page():
        return aiui.layout([aiui.text("start")])

    @aiui.register_page_action("gen")
    def gen_action(data):
        yield aiui.layout([aiui.text("step 1")])
        if data.get("fail"):
            raise RuntimeError("boom mid-stream")
        yield aiui.layout([aiui.text("step 2")])

    with TestClient(srv.create_app()) as client:
        ok = client.post("/api/pages/gen/action", json={"fail": False})
        assert ok.status_code == 200
        assert len(_parse_ndjson(ok.text)) == 2

        err = client.post("/api/pages/gen/action", json={"fail": True})
        assert err.status_code == 200
        frames = _parse_ndjson(err.text)
        assert frames[0]["_components"][0]["content"] == "step 1"
        assert frames[1] == {"error": "boom mid-stream"}


def test_streaming_page_action_is_auth_gated(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("AIUI_URL_TOKEN", "stream-secret")
    srv.reset_state()

    @aiui.page("secure-stream", title="Secure")
    def secure_page():
        return aiui.layout([aiui.text("ok")])

    @aiui.register_page_action("secure-stream")
    async def secure_action(data):
        yield aiui.layout([aiui.text("secret-frame")])

    with TestClient(srv.create_app()) as client:
        unauth = client.post("/api/pages/secure-stream/action", json={})
        assert unauth.status_code == 401

        authed = client.post(
            "/api/pages/secure-stream/action",
            headers={"Authorization": "Bearer stream-secret"},
            json={},
        )
        assert authed.status_code == 200
        assert _parse_ndjson(authed.text)[0]["_components"][0]["content"] == "secret-frame"


def test_sheet_builder_supports_optional_save_action():
    plain = aiui.sheet("Budget", headers=["Item", "Cost"], rows=[["GPU", 120]])
    assert "action" not in plain
    assert "save_label" not in plain

    editable = aiui.sheet(
        "Budget",
        headers=["Item", "Cost"],
        rows=[["GPU", 120]],
        action="save_budget",
        save_label="Save budget",
    )
    assert editable["action"] == "save_budget"
    assert editable["save_label"] == "Save budget"
