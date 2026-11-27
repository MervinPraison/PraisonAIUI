"""Smoke test for Example 34 (HITL Approvals + Live Notifications dashboard)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


def _load_example_module():
    path = (
        Path(__file__).resolve().parents[2]
        / "examples"
        / "python"
        / "34-hitl-approvals-and-notifications"
        / "app.py"
    )
    spec = importlib.util.spec_from_file_location("example34_hitl", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.asyncio
async def test_hitl_ops_page_approve_and_notify_flow(monkeypatch):
    import praisonaiui.features.approvals as approvals_mod
    from praisonaiui.features.notifications import get_notification_store

    monkeypatch.setattr(approvals_mod, "_approval_manager", approvals_mod.SimpleApprovalManager())
    store = get_notification_store()
    store.clear()

    mod = _load_example_module()

    # Initial page render seeds a pending approval + pushes a Notification Center alert
    layout = await mod.ops_page()
    assert "_components" in layout
    assert layout["_badges"]["ops"] == 1
    assert any("Approval required: deploy_release" in n["title"] for n in store.list())

    # Approving via page action resolves pending queue and emits a success notification
    after = await mod.on_ops_action({"action": "approve_next"})
    assert after["_badges"]["ops"] == 0
    assert any("Approved: deploy_release" in n["title"] for n in store.list())
