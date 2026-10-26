"""_UIStoreBackend waits for a human decision (contract v1 §5, approvals).

Before: request_approval_sync returned ``approved=False, "Awaiting UI
approval"`` immediately, so a tool needing approval was always denied and the
UI's Approve button did nothing for the agent; ``request.approval_id`` and
``modified_args`` were dropped.
"""

from __future__ import annotations

import asyncio
import threading
import time

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

protocols = pytest.importorskip("praisonaiagents.approval.protocols")
ApprovalRequest = protocols.ApprovalRequest


def _request(approval_id: str = "appr-1", **kw) -> "ApprovalRequest":
    return ApprovalRequest(
        tool_name=kw.pop("tool_name", "write_file"),
        arguments=kw.pop("arguments", {"path": "draft.md"}),
        risk_level=kw.pop("risk_level", "high"),
        agent_name=kw.pop("agent_name", "Writer"),
        approval_id=approval_id,
        **kw,
    )


@pytest.fixture()
def store():
    from praisonaiui.features.approvals import SimpleApprovalManager

    return SimpleApprovalManager()


@pytest.fixture()
def backend(store):
    from praisonaiui.features.approvals import _UIStoreBackend

    return _UIStoreBackend(store, timeout=5.0)


def _wait_pending(store, approval_id: str, timeout: float = 3.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for entry in store.list_pending():
            if entry["id"] == approval_id:
                return entry
        time.sleep(0.01)
    raise AssertionError(f"{approval_id} never became pending")


def _in_thread(fn, *args):
    box = {}

    def run():
        box["result"] = fn(*args)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t, box


def test_sync_blocks_until_approved_with_modified_args(store, backend):
    t, box = _in_thread(backend.request_approval_sync, _request("appr-1"))
    entry = _wait_pending(store, "appr-1")  # honours request.approval_id
    assert entry["tool_name"] == "write_file" and entry["agent_name"] == "Writer"
    time.sleep(0.1)
    assert t.is_alive(), "backend must block while the decision is pending"
    store.approve("appr-1", reason="Use docs/", modified_args={"path": "docs/draft.md"})
    t.join(timeout=3)
    assert not t.is_alive()
    decision = box["result"]
    assert decision.approved is True
    assert decision.modified_args == {"path": "docs/draft.md"}
    assert decision.reason == "Use docs/"


def test_sync_deny_resolves_with_reason(store, backend):
    t, box = _in_thread(backend.request_approval_sync, _request("appr-2"))
    _wait_pending(store, "appr-2")
    store.deny("appr-2", reason="Not today")
    t.join(timeout=3)
    assert box["result"].approved is False
    assert box["result"].reason == "Not today"


def test_sync_timeout_denies_and_clears_queue(store):
    from praisonaiui.features.approvals import _UIStoreBackend

    backend = _UIStoreBackend(store, timeout=0.2)
    started = time.monotonic()
    decision = backend.request_approval_sync(_request("appr-3"))
    assert time.monotonic() - started >= 0.2
    assert decision.approved is False
    assert decision.approver == "timeout"
    assert store.list_pending() == []
    assert store.get("appr-3")["status"] == "denied"


def test_per_id_isolation(store, backend):
    t1, b1 = _in_thread(backend.request_approval_sync, _request("a"))
    t2, b2 = _in_thread(backend.request_approval_sync, _request("b"))
    _wait_pending(store, "a")
    _wait_pending(store, "b")
    store.approve("b")
    t2.join(timeout=3)
    assert b2["result"].approved is True
    assert t1.is_alive(), "deciding b must not release a"
    store.deny("a")
    t1.join(timeout=3)
    assert b1["result"].approved is False


def test_async_waits_without_blocking_the_loop(store, backend):
    async def main():
        task = asyncio.create_task(backend.request_approval(_request("appr-4")))
        ticks = 0
        while not store.list_pending():
            ticks += 1
            await asyncio.sleep(0.01)
        # the loop keeps running while waiting
        for _ in range(5):
            ticks += 1
            await asyncio.sleep(0.01)
        assert not task.done()
        # decision arrives from another thread (the server handling POST /approve)
        threading.Timer(0.05, lambda: store.approve("appr-4", modified_args={"x": 1})).start()
        decision = await asyncio.wait_for(task, 3)
        return decision, ticks

    decision, ticks = asyncio.run(main())
    assert decision.approved is True
    assert decision.modified_args == {"x": 1}
    assert ticks >= 5


def test_async_decision_from_same_loop(store, backend):
    async def main():
        task = asyncio.create_task(backend.request_approval(_request("appr-5")))
        while not store.list_pending():
            await asyncio.sleep(0.01)
        store.approve("appr-5")
        return await asyncio.wait_for(task, 3)

    assert asyncio.run(main()).approved is True


def test_async_timeout_denies(store):
    from praisonaiui.features.approvals import _UIStoreBackend

    backend = _UIStoreBackend(store, timeout=0.15)
    decision = asyncio.run(backend.request_approval(_request("appr-6")))
    assert decision.approved is False
    assert store.get("appr-6")["status"] == "denied"


def test_async_cancel_by_registry_wait_for_expires_entry(store, backend):
    async def main():
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(backend.request_approval(_request("appr-7")), 0.1)

    asyncio.run(main())
    assert store.list_pending() == []
    assert store.get("appr-7")["status"] == "denied"


def test_sync_call_on_event_loop_thread_fails_closed_fast(store, backend):
    async def main():
        started = time.monotonic()
        decision = backend.request_approval_sync(_request("appr-8"))
        return decision, time.monotonic() - started

    decision, elapsed = asyncio.run(main())
    assert decision.approved is False
    assert elapsed < 1.0
    assert store.list_pending() == []


def test_auto_policy_still_resolves_immediately(store, backend):
    store.update_policies({"auto_approve_tools": ["write_file"]})
    decision = backend.request_approval_sync(_request("appr-9"))
    assert decision.approved is True
    assert decision.approver == "auto-policy"


def test_approve_endpoint_passes_modified_args(store, backend, monkeypatch):
    from praisonaiui.features import approvals

    monkeypatch.setattr(approvals, "_approval_manager", store)
    client = TestClient(Starlette(routes=approvals.ApprovalsFeature().routes()))
    t, box = _in_thread(backend.request_approval_sync, _request("appr-10"))
    _wait_pending(store, "appr-10")
    assert client.get("/api/approvals/appr-10").json()["arguments"] == {"path": "draft.md"}
    r = client.post("/api/approvals/appr-10/approve", json={"modified_args": {"path": "docs/x.md"}, "reason": "ok"})
    assert r.status_code == 200
    assert r.json()["modified_args"] == {"path": "docs/x.md"}
    t.join(timeout=3)
    assert box["result"].approved is True
    assert box["result"].modified_args == {"path": "docs/x.md"}


def test_approve_endpoint_rejects_non_object_modified_args(store, monkeypatch):
    from praisonaiui.features import approvals

    monkeypatch.setattr(approvals, "_approval_manager", store)
    store.request_approval({"id": "z", "tool_name": "t", "risk_level": "high"})
    client = TestClient(Starlette(routes=approvals.ApprovalsFeature().routes()))
    r = client.post("/api/approvals/z/approve", json={"modified_args": [1, 2]})
    assert r.status_code == 400
    assert store.get("z")["status"] == "pending"
    # plain approve without modified_args still works (and keeps old managers working)
    assert client.post("/api/approvals/z/approve", json={}).status_code == 200


def test_sdk_manager_approve_forwards_modified_args():
    pytest.importorskip("praisonaiagents.approval")
    from praisonaiagents.approval import get_approval_registry

    from praisonaiui.features.approvals import SDKApprovalManager

    registry = get_approval_registry()
    previous = registry.get_backend()
    try:
        mgr = SDKApprovalManager()
        mgr._simple.request_approval({"id": "s1", "tool_name": "t", "risk_level": "high"})
        entry = mgr.approve("s1", modified_args={"k": "v"})
        assert entry["modified_args"] == {"k": "v"}
    finally:
        registry.set_backend(previous)
