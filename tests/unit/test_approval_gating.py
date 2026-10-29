"""Code execution is gated by approvals; approval endpoints honour auth (#311)."""

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui.features import approvals as approvals_mod
from praisonaiui.features import auth as auth_mod
from praisonaiui.features.approvals import ApprovalsFeature, SimpleApprovalManager
from praisonaiui.features.code_execution import CodeExecutionFeature


@pytest.fixture
def client(monkeypatch):
    mgr = SimpleApprovalManager()
    monkeypatch.setattr(approvals_mod, "_approval_manager", mgr)
    monkeypatch.setitem(auth_mod._auth_config, "mode", "none")
    app = Starlette(routes=ApprovalsFeature().routes() + CodeExecutionFeature().routes())
    c = TestClient(app)
    c.mgr = mgr
    return c


CODE = {"code": "print(1)", "language": "python"}


def test_default_policy_auto_approves_and_records(client):
    r = client.post("/api/code/execute", json=CODE)
    assert r.status_code == 200
    aid = r.json()["approval_id"]
    entry = client.mgr.get(aid)
    assert entry["status"] == "approved" and entry["tool_name"] == "execute_code"


def test_denied_policy_blocks_execution(client):
    client.mgr.update_policies({"always_deny_tools": ["execute_code"]})
    r = client.post("/api/code/execute", json=CODE)
    assert r.status_code == 403
    assert r.json()["status"] == "denied"


def test_pending_then_approved_executes_once(client):
    client.mgr.update_policies({"risk_threshold": "low"})
    r = client.post("/api/code/execute", json=CODE)
    assert r.status_code == 202
    aid = r.json()["approval_id"]

    # Not approved yet → rejected
    assert client.post("/api/code/execute", json={**CODE, "approval_id": aid}).status_code == 403
    assert client.post(f"/api/approvals/{aid}/approve", json={}).status_code == 200

    # Approval is bound to the exact code
    other = {"code": "print(2)", "language": "python", "approval_id": aid}
    assert client.post("/api/code/execute", json=other).status_code == 403

    assert client.post("/api/code/execute", json={**CODE, "approval_id": aid}).status_code == 200
    # Single use
    assert client.post("/api/code/execute", json={**CODE, "approval_id": aid}).status_code == 403


def test_auth_required_when_enabled(client, monkeypatch):
    client.mgr.update_policies({"risk_threshold": "low"})
    aid = client.post("/api/code/execute", json=CODE).json()["approval_id"]

    monkeypatch.setitem(auth_mod._auth_config, "mode", "api_key")
    assert client.post(f"/api/approvals/{aid}/approve", json={}).status_code == 401
    assert client.post(f"/api/approvals/{aid}/deny", json={}).status_code == 401
    assert client.put("/api/approvals/policies", json={"auto_approve_tools": ["x"]}).status_code == 401
    assert client.post("/api/code/execute", json=CODE).status_code == 401
    assert client.mgr.get(aid)["status"] == "pending"

    monkeypatch.setitem(auth_mod._auth_config, "api_keys", {"pk_test": {"name": "alice"}})
    r = client.post(f"/api/approvals/{aid}/approve", json={}, headers={"X-API-Key": "pk_test"})
    assert r.status_code == 200
    assert r.json()["approver"] == "alice"


def test_externally_created_approval_cannot_authorise_execution(client):
    # Policy that would auto-approve a caller-chosen low-risk entry
    client.mgr.update_policies({"risk_threshold": "medium"})
    r = client.post(
        "/api/approvals",
        json={"tool_name": "execute_code", "arguments": CODE, "risk_level": "low"},
    )
    assert r.json()["status"] == "approved"
    aid = r.json()["id"]
    assert client.post("/api/code/execute", json={**CODE, "approval_id": aid}).status_code == 403
