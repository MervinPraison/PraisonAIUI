"""Integration tests for the Training Lab API routes."""

from __future__ import annotations

import json

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import create_app


@pytest.fixture
def storage(tmp_path, monkeypatch):
    d = tmp_path / "train"
    d.mkdir()
    monkeypatch.setenv("PRAISON_TRAIN_DIR", str(d))
    return d


@pytest.fixture
def client():
    return TestClient(create_app())


def _write(storage, session_id, iterations, target=None, passed=None, mode="llm"):
    report = {"total_iterations": len(iterations), "metadata": {"mode": mode}}
    if target is not None:
        report["metadata"]["target_iterations"] = target
    if passed is not None:
        report["passed"] = passed
    (storage / f"{session_id}.json").write_text(
        json.dumps({"report": report, "iterations": iterations, "scenarios": []}),
        encoding="utf-8",
    )


class TestTrainingRoutesRegistered:
    def test_status_route(self, client, storage):
        r = client.get("/api/training/status")
        assert r.status_code == 200
        assert r.json()["feature"] == "training"

    def test_sessions_route(self, client, storage):
        r = client.get("/api/training/sessions")
        assert r.status_code == 200
        assert r.json() == {"sessions": [], "count": 0}


class TestTrainingCliParity:
    def test_list_and_detail(self, client, storage):
        _write(storage, "train-45fe3d1f", [{"score": 10.0}], target=3, passed=True)
        listing = client.get("/api/training/sessions").json()
        assert listing["count"] == 1
        assert listing["sessions"][0]["session_id"] == "train-45fe3d1f"
        assert listing["sessions"][0]["early_stopped"] is True

        detail = client.get("/api/training/sessions/train-45fe3d1f").json()
        assert detail["completed_iterations"] == 1
        assert detail["requested_iterations"] == 3

    def test_apply_requires_agent_id(self, client, storage):
        _write(storage, "train-x", [{"score": 9.0}], passed=True)
        r = client.post("/api/training/sessions/train-x/apply", json={})
        assert r.status_code in (422, 503)
