"""Unit tests for SurfaceFeature and surface store."""

import pytest
from starlette.testclient import TestClient

from praisonaiui.features.surfaces import (
    SurfaceStore,
    get_surface_store,
    set_surface_store,
)


@pytest.fixture
def store():
    s = SurfaceStore()
    set_surface_store(s)
    yield s
    set_surface_store(SurfaceStore())


@pytest.mark.asyncio
async def test_apply_messages(store):
    state = await store.apply_messages(
        "main",
        [{"createSurface": {"surfaceId": "main", "catalogId": "basic"}}],
    )
    assert len(state.messages) == 1
    assert state.messages[0]["version"] == "v0.9"


@pytest.mark.asyncio
async def test_list_surfaces(store):
    await store.apply_messages("a", [{"createSurface": {"surfaceId": "a"}}])
    items = await store.list_surfaces()
    assert len(items) == 1
    assert items[0]["id"] == "a"


def test_surfaces_routes(store):
    from praisonaiui.server import create_app

    app = create_app()
    client = TestClient(app)

    r = client.get("/api/surfaces")
    assert r.status_code == 200
    assert "surfaces" in r.json()

    r = client.post(
        "/api/surfaces/test/messages",
        json={"messages": [{"createSurface": {"surfaceId": "test"}}]},
    )
    assert r.status_code == 200

    r = client.get("/api/surfaces/test")
    assert r.status_code == 200
    assert len(r.json()["messages"]) == 1

    r = client.delete("/api/surfaces/test")
    assert r.status_code == 200


def test_canvas_builtin_page(store):
    from praisonaiui.server import create_app

    app = create_app()
    client = TestClient(app)
    r = client.get("/api/pages")
    assert r.status_code == 200
    page_ids = [p["id"] for p in r.json().get("pages", [])]
    assert "canvas" in page_ids
