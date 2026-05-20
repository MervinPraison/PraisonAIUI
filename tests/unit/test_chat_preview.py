"""Unit tests for chat preview config and chat-canvas page."""

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import create_app, reset_state, set_chat_preview


@pytest.fixture
def client():
    reset_state()
    app = create_app()
    return TestClient(app)


def test_chat_preview_default_in_ui_config(client):
    r = client.get("/ui-config.json")
    assert r.status_code == 200
    preview = r.json()["chat"]["preview"]
    assert preview["enabled"] is False
    assert preview["surfaceId"] == "main"
    assert preview["width"] == "40%"


def test_set_chat_preview_exposed_in_ui_config():
    reset_state()
    set_chat_preview(enabled=True, surface_id="panel", width="420px")
    client = TestClient(create_app())
    preview = client.get("/ui-config.json").json()["chat"]["preview"]
    assert preview == {
        "enabled": True,
        "surfaceId": "panel",
        "width": "420px",
    }


def test_chat_canvas_builtin_page(client):
    r = client.get("/api/pages")
    assert r.status_code == 200
    page_ids = [p["id"] for p in r.json().get("pages", [])]
    assert "chat-canvas" in page_ids
    assert "chat" in page_ids
    assert "canvas" in page_ids
