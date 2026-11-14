"""Feature data comes from the configured data directory, never a global one.

Overview "Recent Activity" (``/api/traces``) listed runs from
``~/.praison/traces`` on a server started with an isolated ``AIUI_DATA_DIR`` and
``PRAISONAI_HOME``. Each test here runs against two isolated data directories
and a fake home that holds "global" data, and checks that each directory sees
only its own data.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "replay"


@pytest.fixture()
def dirs(tmp_path, monkeypatch):
    """A fake home with global data, plus two isolated data directories."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    for var in (
        "PRAISONAI_HOME",
        "AIUI_DATA_DIR",
        "PRAISON_HOME",
        "PRAISONAI_TRACES_DIR",
        "PRAISON_TRAIN_DIR",
    ):
        monkeypatch.delenv(var, raising=False)
    a = tmp_path / "data-a"
    b = tmp_path / "data-b"
    a.mkdir()
    b.mkdir()
    return {"home": home, "a": a, "b": b}


def _use(monkeypatch, data_dir: Path) -> None:
    """Point the process at *data_dir* the way an isolated server run does."""
    monkeypatch.setenv("AIUI_DATA_DIR", str(data_dir))
    monkeypatch.setenv("PRAISONAI_HOME", str(data_dir))


def _trace(directory: Path, run_id: str, fixture: str = "legacy_v10") -> None:
    directory.mkdir(parents=True, exist_ok=True)
    shutil.copy(FIXTURES / f"{fixture}.jsonl", directory / f"{run_id}.jsonl")


# ── _paths ───────────────────────────────────────────────────────────


def test_configured_data_dir_prefers_praisonai_home(dirs, monkeypatch):
    from praisonaiui.features._paths import configured_data_dir

    assert configured_data_dir() is None
    monkeypatch.setenv("AIUI_DATA_DIR", str(dirs["a"]))
    assert configured_data_dir() == dirs["a"]
    monkeypatch.setenv("PRAISONAI_HOME", str(dirs["b"]))
    assert configured_data_dir() == dirs["b"]


def test_aiui_default_dir_counts_as_unconfigured(dirs, monkeypatch):
    """create_app() copies the default into PRAISONAI_HOME with setdefault; that
    alone must not move a default install's data."""
    from praisonaiui.features._paths import configured_data_dir

    monkeypatch.setenv("PRAISONAI_HOME", str(dirs["home"] / ".praisonaiui"))
    assert configured_data_dir() is None
    monkeypatch.setenv("AIUI_DATA_DIR", str(dirs["a"]))
    assert configured_data_dir() == dirs["a"]


# ── traces: Overview "Recent Activity", Replay, Runs ────────────────


@pytest.fixture()
def trace_client(monkeypatch):
    from praisonaiui.features import tracing
    from praisonaiui.features.replay import ReplayFeature
    from praisonaiui.features.tracing import TracingFeature

    monkeypatch.setattr(tracing, "_tracing_manager", None)
    routes = TracingFeature().routes() + ReplayFeature().routes()
    return TestClient(Starlette(routes=routes))


def test_traces_follow_the_configured_data_dir(dirs, monkeypatch, trace_client):
    from praisonaiui.features import _trace_jsonl as tj

    _trace(dirs["home"] / ".praison" / "traces", "run-global")
    _trace(dirs["a"] / "traces", "run-a")
    _trace(dirs["b"] / "traces", "run-b")

    _use(monkeypatch, dirs["a"])
    assert tj.traces_dir() == dirs["a"] / "traces"
    ids = {t["id"] for t in trace_client.get("/api/traces?limit=10").json()["traces"]}
    assert ids == {"run-a"}
    runs = {r["run_id"] for r in trace_client.get("/api/replay/runs").json()}
    assert runs == {"run-a"}

    _use(monkeypatch, dirs["b"])
    ids = {t["id"] for t in trace_client.get("/api/traces?limit=10").json()["traces"]}
    assert ids == {"run-b"}


def test_empty_data_dir_lists_no_global_runs(dirs, monkeypatch, trace_client):
    _trace(dirs["home"] / ".praison" / "traces", "run-global")
    _use(monkeypatch, dirs["a"])
    assert trace_client.get("/api/traces?limit=10").json()["traces"] == []


def test_unconfigured_install_keeps_the_cli_trace_dir(dirs, monkeypatch, trace_client):
    from praisonaiui.features import _trace_jsonl as tj

    _trace(dirs["home"] / ".praison" / "traces", "run-global")
    monkeypatch.setenv("PRAISONAI_HOME", str(dirs["home"] / ".praisonaiui"))
    assert tj.traces_dir() == dirs["home"] / ".praison" / "traces"
    ids = {t["id"] for t in trace_client.get("/api/traces?limit=10").json()["traces"]}
    assert ids == {"run-global"}


def test_explicit_trace_overrides_still_win(dirs, monkeypatch):
    from praisonaiui.features import _trace_jsonl as tj

    _use(monkeypatch, dirs["a"])
    monkeypatch.setenv("PRAISON_HOME", str(dirs["b"]))
    assert tj.traces_dir() == dirs["b"] / "traces"
    monkeypatch.setenv("PRAISONAI_TRACES_DIR", str(dirs["home"] / "explicit"))
    assert tj.traces_dir() == dirs["home"] / "explicit"
