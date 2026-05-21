"""Tests for backend injection factories used by feature endpoints."""

from __future__ import annotations

from starlette.testclient import TestClient

from praisonaiui.backends import clear_backends, set_backend
from praisonaiui.server import create_app, reset_state


def _client() -> TestClient:
    reset_state()
    return TestClient(create_app())


def test_hooks_feature_uses_injected_lister():
    clear_backends()
    set_backend("hooks", lambda: [{"id": "sdk-hook", "name": "SDK Hook"}])
    client = _client()

    resp = client.get("/api/hooks")
    assert resp.status_code == 200
    hooks = resp.json()["hooks"]
    assert any(h.get("id") == "sdk-hook" for h in hooks)
    clear_backends()


def test_approvals_feature_uses_injected_lister():
    clear_backends()
    set_backend("approvals", lambda: [{"id": "apr-1", "status": "pending"}])
    client = _client()

    resp = client.get("/api/approvals")
    assert resp.status_code == 200
    assert resp.json()["count"] == 1
    assert resp.json()["approvals"][0]["id"] == "apr-1"
    clear_backends()


def test_usage_feature_uses_injected_query():
    clear_backends()
    set_backend(
        "usage_query",
        lambda: {
            "usage": {"total_requests": 7, "total_tokens": 70, "by_model": {}, "by_session": {}},
            "sessions": {"total": 1, "active": 0},
        },
    )
    client = _client()

    resp = client.get("/api/usage/summary")
    assert resp.status_code == 200
    data = resp.json()
    assert data["usage"]["total_requests"] == 7
    assert data["usage"]["total_tokens"] == 70
    clear_backends()
