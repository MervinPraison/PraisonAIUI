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


def test_is_integrated_mode_detects_injected_backends():
    clear_backends()
    assert not __import__("praisonaiui.backends", fromlist=["is_integrated_mode"]).is_integrated_mode()
    set_backend("hooks", lambda: [])
    assert __import__("praisonaiui.backends", fromlist=["is_integrated_mode"]).is_integrated_mode()
    clear_backends()


def test_resolve_tools_uses_injected_resolver():
    clear_backends()

    class _Resolver:
        def resolve(self, name: str):
            return f"tool:{name}"

    set_backend("tool_resolver", _Resolver())
    from praisonaiui.backends import resolve_tools

    assert resolve_tools(["search"]) == ["tool:search"]
    clear_backends()


def test_health_includes_sdk_gaps():
    import asyncio

    from praisonaiui.features.nodes import NodesFeature

    feat = NodesFeature()
    data = asyncio.run(feat.health())
    assert data.get("sdk_gap") is True
    assert data.get("sdk_gap_message")


def test_kanban_store_factory_backend():
    clear_backends()
    set_backend("kanban_store", lambda: object())
    from praisonaiui.backends import get_kanban_store_factory

    assert get_kanban_store_factory() is not None
    clear_backends()
