"""``praisonaiui.features.workflows.list_runs`` is the public read of the run log.

Regression: the run log was only the private ``_runs`` dict, so a host page
listing workflow runs (praisonai's workflow_runs page) had to read it.
"""

from __future__ import annotations

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from praisonaiui.features import workflows


@pytest.fixture
def runs(monkeypatch):
    log = {
        "r1": {"id": "r1", "workflow_id": "wf", "workflow_name": "Build", "status": "completed"},
        "r2": {"id": "r2", "workflow_id": "wf", "status": "failed"},
    }
    monkeypatch.setattr(workflows, "_runs", log)
    return log


def test_list_runs_returns_copies_in_order(runs):
    out = workflows.list_runs()
    assert [r["id"] for r in out] == ["r1", "r2"]
    out[0]["status"] = "changed"
    assert runs["r1"]["status"] == "completed"


def test_route_and_cli_read_the_same_list(runs):
    feat = workflows.WorkflowsFeature()
    client = TestClient(Starlette(routes=feat.routes()))
    body = client.get("/api/workflows/runs").json()
    assert body == {"runs": workflows.list_runs(), "count": 2}
    assert feat._cli_runs().splitlines() == ["  r1 — Build (completed)", "  r2 — wf (failed)"]


def test_no_runs(monkeypatch):
    monkeypatch.setattr(workflows, "_runs", {})
    assert workflows.list_runs() == []
    assert workflows.WorkflowsFeature()._cli_runs() == "No workflow runs"
