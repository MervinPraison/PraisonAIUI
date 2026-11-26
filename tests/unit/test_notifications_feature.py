"""Tests for the modular Notification Center feature, Python SDK helpers, and auth/security."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import pytest
from starlette.testclient import TestClient

import praisonaiui as aiui
import praisonaiui.server as srv
from praisonaiui.features.notifications import (
    InMemoryNotificationStore,
    NotificationStoreProtocol,
    clear_notifications,
    get_notification_store,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    push_notification,
    remove_notification,
    reset_notifications_for_tests,
    set_notification_store,
)


@pytest.fixture(autouse=True)
def _clean_notifications():
    srv.reset_state()
    reset_notifications_for_tests()
    yield
    reset_notifications_for_tests()
    srv.reset_state()


def test_store_dedupe_ring_buffer_and_pinned_clear():
    store = InMemoryNotificationStore(max_items=3)
    a = store.push({"title": "Pinned alert", "pinned": True, "created_at": 1000})
    b = store.push({"title": "Read notice", "read": True, "created_at": 2000})
    c = store.push({"title": "Unread 1", "dedupe_key": "job-1", "created_at": 3000})
    assert store.unread_count() == 2

    # Dedupe upsert updates in place without duplicating.
    c2 = store.push({"title": "Unread 1 updated", "dedupe_key": "job-1", "created_at": 3500})
    assert c2["id"] == c["id"]
    assert len(store.list()) == 3
    assert store.list()[0]["title"] == "Unread 1 updated"

    # Ring-buffer eviction drops oldest read unpinned item first (b).
    store.push({"title": "Unread 2", "created_at": 4000})
    ids = {x["id"] for x in store.list()}
    assert b["id"] not in ids
    assert a["id"] in ids

    # Clear preserves pinned by default, removes when include_pinned=True.
    removed = store.clear()
    assert removed == 2
    assert [x["id"] for x in store.list()] == [a["id"]]
    assert store.clear(include_pinned=True) == 1
    assert store.list() == []


def test_custom_pluggable_notification_store():
    class CustomStore:
        def __init__(self) -> None:
            self.rows: List[Dict[str, Any]] = []

        def push(self, data: Dict[str, Any]) -> Dict[str, Any]:
            item = {"id": "custom-1", "title": data["title"], "type": "info", "createdAt": 1, "read": False}
            self.rows.append(item)
            return item

        def list(self, *, unread_only: bool = False, category: Optional[str] = None, limit: Optional[int] = None):
            return list(self.rows)

        def unread_count(self) -> int:
            return len(self.rows)

        def mark_read(self, notification_id: str):
            return None

        def mark_all_read(self) -> int:
            return 0

        def remove(self, notification_id: str) -> bool:
            return False

        def clear(self, *, include_pinned: bool = False, read_only: bool = False) -> int:
            n = len(self.rows)
            self.rows.clear()
            return n

    custom = CustomStore()
    assert isinstance(custom, NotificationStoreProtocol)
    set_notification_store(custom)
    assert get_notification_store() is custom
    created = aiui.push_notification("From custom store")
    assert created["id"] == "custom-1"
    assert len(aiui.list_notifications()) == 1


def test_rest_crud_sanitization_and_python_helpers():
    client = TestClient(srv.create_app())

    # Empty initially
    r = client.get("/api/notifications")
    assert r.status_code == 200
    assert r.json() == {"notifications": [], "unread_count": 0, "total": 0}

    # POST creates notification & strips unsafe javascript: href (R9)
    r = client.post(
        "/api/notifications",
        json={
            "title": "Deploy finished",
            "description": "Production v2.1 is live",
            "type": "success",
            "category": "deploy",
            "dedupe_key": "deploy-2.1",
            "action": {"label": "Open", "href": "javascript:alert(1)"},
        },
    )
    assert r.status_code == 201
    created = r.json()["notification"]
    assert created["title"] == "Deploy finished"
    assert created["category"] == "deploy"
    assert "action" not in created  # unsafe href dropped -> action with neither page nor href dropped

    # Safe page action preserved
    n2 = push_notification(
        "Review required",
        "Tool call needs approval",
        type="warning",
        category="approval",
        action={"label": "Review", "page": "approvals", "params": {"tab": "pending"}},
    )
    assert n2["action"] == {"label": "Review", "page": "approvals", "params": {"tab": "pending"}}

    # Filter by category & unread
    r = client.get("/api/notifications?category=approval&unread=true")
    assert r.status_code == 200
    assert len(r.json()["notifications"]) == 1
    assert r.json()["unread_count"] == 2

    # Mark one read
    r = client.post(f"/api/notifications/{created['id']}/read")
    assert r.status_code == 200
    assert r.json()["unread_count"] == 1
    assert client.post("/api/notifications/does-not-exist/read").status_code == 404

    # Mark all read
    r = client.post("/api/notifications/read-all")
    assert r.status_code == 200
    assert r.json()["marked"] == 1
    assert r.json()["unread_count"] == 0

    # Delete one & clear
    assert client.delete(f"/api/notifications/{created['id']}").status_code == 200
    assert client.delete("/api/notifications/does-not-exist").status_code == 404
    assert client.delete("/api/notifications").json()["cleared"] == 1
    assert list_notifications() == []


def test_python_notify_persist_and_ui_layout_notifications():
    # Outside a chat stream, persist=True still records in the Notification Center
    ok = asyncio.run(
        aiui.notify(
            "Background sync complete",
            type="success",
            persist=True,
            description="42 records updated",
            category="sync",
        )
    )
    assert ok is True
    rows = list_notifications()
    assert len(rows) == 1
    assert rows[0]["title"] == "Background sync complete"
    assert rows[0]["category"] == "sync"

    # Helpers work cleanly
    assert mark_notification_read(rows[0]["id"]) is not None
    assert mark_all_notifications_read() == 0
    assert remove_notification(rows[0]["id"]) is True
    assert clear_notifications() == 0

    # ui.layout(..., notifications=[...]) emits _notifications
    payload = aiui.layout([aiui.text("ok")], notifications=[{"title": "Saved", "type": "success"}])
    assert payload["_notifications"] == [{"title": "Saved", "type": "success"}]


def test_notifications_routes_require_auth_in_all_modes(monkeypatch):
    # Mode 1: require_auth=True
    app = srv.create_app(require_auth=True)
    client = TestClient(app)
    assert client.get("/api/notifications").status_code == 401
    assert client.post("/api/notifications", json={"title": "x"}).status_code == 401

    # Mode 2: AIUI_REQUIRE_TOKEN=1 + token
    srv.reset_state()
    monkeypatch.setenv("AIUI_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("AIUI_URL_TOKEN", "secret-tok-123")
    app2 = srv.create_app()
    client2 = TestClient(app2)
    assert client2.get("/api/notifications").status_code == 401
    ok = client2.get("/api/notifications", headers={"Authorization": "Bearer secret-tok-123"})
    assert ok.status_code == 200


def test_disabling_builtin_notifications_unmounts_routes():
    aiui.set_extensions(disabled=["builtin.notifications"])
    try:
        client = TestClient(srv.create_app())
        assert client.get("/api/notifications").status_code == 404
        assert client.post("/api/notifications", json={"title": "blocked"}).status_code in (404, 405)
    finally:
        aiui.set_extensions(disabled=[])
