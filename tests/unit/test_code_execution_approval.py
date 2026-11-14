"""POST /api/code/execute waits for a human approval (#311 part 1).

The run goes through the SDK's own gate on ``execute_code``
(``@require_approval(risk_level="critical")``), wired to the UI approvals
queue: one run, one approval; deny or timeout is 403. Before this fix the route
imported ``praisonaiagents.tools.code`` (which does not exist), so it never ran
anything and answered 200 "simulated" or "degraded".
"""

from __future__ import annotations

import sys
import threading
import time

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import create_app

pytest.importorskip("praisonaiagents.tools.python_tools")

# The last line is not an expression: the SDK sandbox re-evaluates a trailing
# expression for its "result", which would print twice.
SNIPPET = "answer = 6 * 7\nprint('answer', answer)\ndone = True"


@pytest.fixture
def store(monkeypatch):
    """A fresh UI approvals queue wired into the SDK registry."""
    from praisonaiagents.approval import get_approval_registry

    from praisonaiui.features import approvals

    monkeypatch.delenv("PRAISONAI_AUTO_APPROVE", raising=False)
    registry = get_approval_registry()
    previous_backend = registry._global_backend
    monkeypatch.setattr(registry, "timeout", 10.0)
    manager = approvals.SDKApprovalManager()
    monkeypatch.setattr(approvals, "_approval_manager", manager)
    yield manager._simple
    if previous_backend is None:
        registry.remove_backend()
    else:
        registry.set_backend(previous_backend)
    registry.add_requirement("execute_code", "critical")


@pytest.fixture
def client():
    return TestClient(create_app(), raise_server_exceptions=False)


def _run(client, code=SNIPPET, **body):
    """POST a run in a thread, since it blocks until the decision."""
    box: dict = {}

    def go():
        box["response"] = client.post(
            "/api/code/execute", json={"code": code, "language": "python", **body}
        )

    t = threading.Thread(target=go, daemon=True)
    t.start()
    return t, box


def _pending(store, code=SNIPPET, exclude=(), timeout=5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for entry in store.list_pending():
            if entry["id"] not in exclude and entry["arguments"].get("code") == code:
                return entry
        time.sleep(0.02)
    raise AssertionError("the run never asked for approval")


def test_run_waits_for_a_human_then_runs(store, client):
    t, box = _run(client)
    entry = _pending(store)
    assert entry["tool_name"] == "execute_code" and entry["risk_level"] == "critical"
    time.sleep(0.2)
    assert t.is_alive(), "the run must wait while the approval is pending"
    assert client.post(f"/api/approvals/{entry['id']}/approve", json={}).status_code == 200
    t.join(timeout=15)
    r = box["response"]
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "success"
    assert r.json()["output"] == "answer 42\n"


def test_deny_is_403_and_nothing_runs(store, client):
    t, box = _run(client)
    entry = _pending(store)
    client.post(f"/api/approvals/{entry['id']}/deny", json={"reason": "not now"})
    t.join(timeout=10)
    r = box["response"]
    assert r.status_code == 403
    assert r.json()["status"] == "denied" and "not now" in r.json()["error"]
    assert "output" not in r.json()


def test_timeout_is_403(store, client, monkeypatch):
    from praisonaiagents.approval import get_approval_registry

    monkeypatch.setattr(get_approval_registry(), "timeout", 0.3)
    r = client.post("/api/code/execute", json={"code": SNIPPET, "language": "python"})
    assert r.status_code == 403
    assert "timed out" in r.json()["error"].lower()
    assert store.list_pending() == []


def test_each_run_needs_its_own_approval_even_after_always(store, client):
    t, box = _run(client)
    first = _pending(store)
    client.post(f"/api/approvals/{first['id']}/approve", json={"always": True})
    t.join(timeout=15)
    assert box["response"].status_code == 200
    assert "execute_code" not in store.get_policies()["auto_approve_tools"]

    # The same code again: a new approval, not a cached or standing one.
    t, box = _run(client)
    second = _pending(store, exclude={first["id"]})
    client.post(f"/api/approvals/{second['id']}/deny", json={})
    t.join(timeout=10)
    assert box["response"].status_code == 403


def test_a_client_created_approval_does_not_unlock_a_run(store, client):
    forged = client.post(
        "/api/approvals",
        json={
            "tool_name": "execute_code",
            "risk_level": "critical",
            "arguments": {"code": SNIPPET, "timeout": 30, "sandbox_mode": "sandbox"},
        },
    ).json()
    client.post(f"/api/approvals/{forged['id']}/approve", json={"always": True})

    t, box = _run(client)
    entry = _pending(store, exclude={forged["id"]})
    assert entry["id"] != forged["id"]
    client.post(f"/api/approvals/{entry['id']}/deny", json={})
    t.join(timeout=10)
    assert box["response"].status_code == 403


def test_auto_approve_policy_opts_out_and_back_in(store, client):
    client.put("/api/approvals/policies", json={"auto_approve_tools": ["execute_code"]})
    r = client.post("/api/code/execute", json={"code": SNIPPET, "language": "python"})
    assert r.status_code == 200 and r.json()["status"] == "success"

    # Removing it from the list gates execution again.
    client.put("/api/approvals/policies", json={"auto_approve_tools": []})
    t, box = _run(client)
    entry = _pending(store)
    client.post(f"/api/approvals/{entry['id']}/deny", json={})
    t.join(timeout=10)
    assert box["response"].status_code == 403


def test_languages_the_sandbox_cannot_run_are_refused_before_the_gate(store, client):
    for language in ("ruby", "javascript"):
        r = client.post("/api/code/execute", json={"code": "1", "language": language})
        assert r.status_code == 400
    assert store.list_pending() == []


def test_without_the_sdk_the_response_is_degraded_not_simulated(client, monkeypatch):
    monkeypatch.setitem(sys.modules, "praisonaiagents.tools.python_tools", None)
    r = client.post("/api/code/execute", json={"code": SNIPPET, "language": "python"})
    assert r.status_code == 503
    assert r.json()["status"] == "degraded"
    assert "praisonaiagents" in r.json()["error"]


# ── #311 part 2: the route and the decision endpoints need credentials ──

_GATED = [
    ("post", "/api/code/execute"),
    ("post", "/api/approvals/x/approve"),
    ("post", "/api/approvals/x/deny"),
    ("put", "/api/approvals/policies"),
]


@pytest.mark.parametrize("mode", ["AUTH_ENFORCE", "require_auth"])
def test_unauthenticated_requests_get_401(mode, monkeypatch):
    if mode == "AUTH_ENFORCE":
        monkeypatch.setenv("AUTH_ENFORCE", "true")
        app = create_app()
    else:
        app = create_app(require_auth=True)
    c = TestClient(app, raise_server_exceptions=False)
    for method, path in _GATED:
        r = getattr(c, method)(path, json={"code": SNIPPET})
        assert r.status_code == 401, (mode, method, path, r.status_code)
