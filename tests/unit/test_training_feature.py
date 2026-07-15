"""Unit tests for the Training Lab feature (features/training.py)."""

from __future__ import annotations

import json

import pytest
from starlette.requests import Request

from praisonaiui.features.training import TrainingFeature


def _write_session(
    storage, session_id, *, iterations, target=None, passed=None, mode="llm", agent_id=None
):
    report = {
        "total_iterations": len(iterations),
        "metadata": {"mode": mode},
    }
    if target is not None:
        report["metadata"]["target_iterations"] = target
    if agent_id is not None:
        report["metadata"]["agent_id"] = agent_id
    if passed is not None:
        report["passed"] = passed
    payload = {"report": report, "iterations": iterations, "scenarios": []}
    (storage / f"{session_id}.json").write_text(json.dumps(payload), encoding="utf-8")


@pytest.fixture
def storage(tmp_path, monkeypatch):
    d = tmp_path / "train"
    d.mkdir()
    monkeypatch.setenv("PRAISON_TRAIN_DIR", str(d))
    return d


def _request(path, path_params=None, query_string=b"", body=None):
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "path_params": path_params or {},
        "query_string": query_string,
        "headers": [],
    }
    req = Request(scope)
    if body is not None:
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        req._receive = receive
    return req


async def _json(resp):
    return json.loads(bytes(resp.body).decode())


@pytest.mark.asyncio
async def test_list_sessions_empty(storage):
    feat = TrainingFeature()
    resp = await feat._list_sessions(_request("/api/training/sessions"))
    data = await _json(resp)
    assert data == {"sessions": [], "count": 0}


@pytest.mark.asyncio
async def test_list_sessions_ordering(storage):
    import os
    import time

    _write_session(storage, "train-old", iterations=[{"score": 8.0}])
    _write_session(storage, "train-new", iterations=[{"score": 9.0}])
    old = storage / "train-old.json"
    now = time.time()
    os.utime(old, (now - 100, now - 100))

    feat = TrainingFeature()
    resp = await feat._list_sessions(_request("/api/training/sessions"))
    data = await _json(resp)
    assert [s["session_id"] for s in data["sessions"]] == ["train-new", "train-old"]


@pytest.mark.asyncio
async def test_list_sessions_agent_id_filter(storage):
    _write_session(storage, "train-a", iterations=[{"score": 9.0}], agent_id="alpha")
    _write_session(storage, "train-b", iterations=[{"score": 9.0}], agent_id="beta")

    feat = TrainingFeature()
    resp = await feat._list_sessions(
        _request("/api/training/sessions", query_string=b"agent_id=alpha")
    )
    data = await _json(resp)
    assert [s["session_id"] for s in data["sessions"]] == ["train-a"]
    assert data["sessions"][0]["agent_id"] == "alpha"


@pytest.mark.asyncio
async def test_early_stop_derived_fields(storage):
    _write_session(storage, "train-es", iterations=[{"score": 10.0}], target=3, passed=True)
    feat = TrainingFeature()
    resp = await feat._get_session(
        _request("/api/training/sessions/train-es", {"session_id": "train-es"})
    )
    data = await _json(resp)
    assert data["early_stopped"] is True
    assert data["requested_iterations"] == 3
    assert data["completed_iterations"] == 1
    assert data["early_stop_reason"] == "score_threshold"


@pytest.mark.asyncio
async def test_early_stop_hidden_for_human_mode(storage):
    _write_session(
        storage, "train-hum", iterations=[{"score": 10.0}], target=3, mode="human"
    )
    feat = TrainingFeature()
    resp = await feat._get_session(
        _request("/api/training/sessions/train-hum", {"session_id": "train-hum"})
    )
    data = await _json(resp)
    assert data["early_stopped"] is False


@pytest.mark.asyncio
async def test_get_session_detail_best_iteration(storage):
    _write_session(
        storage,
        "train-best",
        iterations=[{"score": 8.0}, {"score": 10.0}],
        passed=True,
    )
    feat = TrainingFeature()
    resp = await feat._get_session(
        _request("/api/training/sessions/train-best", {"session_id": "train-best"})
    )
    data = await _json(resp)
    assert data["best_iteration_num"] == 2
    assert data["iterations"][1]["is_best"] is True
    assert data["iterations"][0]["is_best"] is False


@pytest.mark.asyncio
async def test_get_session_404(storage):
    feat = TrainingFeature()
    resp = await feat._get_session(
        _request("/api/training/sessions/missing", {"session_id": "missing"})
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_session_corrupt_json(storage):
    (storage / "train-bad.json").write_text("{not valid", encoding="utf-8")
    feat = TrainingFeature()
    resp = await feat._get_session(
        _request("/api/training/sessions/train-bad", {"session_id": "train-bad"})
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_status_reports_backend(storage):
    _write_session(storage, "train-1", iterations=[{"score": 9.0}])
    feat = TrainingFeature()
    resp = await feat._status(_request("/api/training/status"))
    data = await _json(resp)
    assert data["storage_backend"] == "json"
    assert data["sqlite_supported"] is False
    assert data["session_count"] == 1


@pytest.mark.asyncio
async def test_apply_requires_agent_id(storage):
    _write_session(storage, "train-a", iterations=[{"score": 9.0}], passed=True)
    feat = TrainingFeature()
    resp = await feat._apply(
        _request(
            "/api/training/sessions/train-a/apply",
            {"session_id": "train-a"},
            body=b"{}",
        )
    )
    assert resp.status_code in (422, 503)


@pytest.mark.asyncio
async def test_apply_session_404(storage):
    feat = TrainingFeature()
    resp = await feat._apply(
        _request(
            "/api/training/sessions/missing/apply",
            {"session_id": "missing"},
            body=b'{"agent_id": "x"}',
        )
    )
    assert resp.status_code == 404
