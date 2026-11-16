"""Feature data comes from the configured data directory, never a global one.

Overview "Recent Activity" (``/api/traces``) listed runs from
``~/.praison/traces`` on a server started with an isolated ``AIUI_DATA_DIR`` and
``PRAISONAI_HOME``. Each test here runs against two isolated data directories
and a fake home that holds "global" data, and checks that each directory sees
only its own data.
"""

from __future__ import annotations

import json
import shutil
import sys
import types
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
        "PRAISONAI_PROJECTS_DIR",
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


def _unconfigure(monkeypatch) -> None:
    monkeypatch.delenv("AIUI_DATA_DIR", raising=False)
    monkeypatch.delenv("PRAISONAI_HOME", raising=False)


# ── memory ───────────────────────────────────────────────────────────


def _file_memory(directory: Path, text: str) -> None:
    user = directory / "default"
    user.mkdir(parents=True, exist_ok=True)
    (user / "short_term.json").write_text(json.dumps([{"id": text, "content": text}]))


def test_file_memories_come_from_the_data_dir_only(dirs, monkeypatch, tmp_path):
    from praisonaiui.features.memory import SDKMemoryManager

    cwd = tmp_path / "project"
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    _file_memory(dirs["home"] / ".praisonai" / "memory", "global-home")
    _file_memory(cwd / ".praisonai" / "memory", "global-cwd")
    _file_memory(dirs["a"] / "memory", "mem-a")
    _file_memory(dirs["b"] / "memory", "mem-b")
    mgr = SDKMemoryManager()

    _use(monkeypatch, dirs["a"])
    assert {e["text"] for e in mgr._read_file_memory_entries()} == {"mem-a"}
    _use(monkeypatch, dirs["b"])
    assert {e["text"] for e in mgr._read_file_memory_entries()} == {"mem-b"}

    _unconfigure(monkeypatch)  # no data dir: the historical folders, unchanged
    assert {e["text"] for e in mgr._read_file_memory_entries()} == {"global-home", "global-cwd"}


def test_sdk_memory_stores_live_in_the_data_dir(dirs, monkeypatch):
    from praisonaiui.features.memory import SDKMemoryManager

    _use(monkeypatch, dirs["a"])
    cfg = SDKMemoryManager()._sdk_config()
    for key in ("short_db", "long_db", "rag_db_path"):
        assert Path(cfg[key]).parent == dirs["a"] / "memory"

    explicit = SDKMemoryManager(short_db="/elsewhere/short.db")._sdk_config()
    assert explicit["short_db"] == "/elsewhere/short.db"

    _unconfigure(monkeypatch)
    assert SDKMemoryManager()._sdk_config() == {}  # SDK defaults, as before


# ── knowledge ────────────────────────────────────────────────────────


def test_knowledge_store_lives_in_the_data_dir(dirs, monkeypatch):
    from praisonaiui.features.knowledge import SDKKnowledgeManager

    seen = []

    class _Knowledge:
        def __init__(self, config=None, **_):
            seen.append(config["vector_store"]["config"]["path"])

        def search(self, *a, **k):
            return []

    mod = types.ModuleType("praisonaiagents.knowledge")
    mod.Knowledge = _Knowledge
    monkeypatch.setitem(sys.modules, "praisonaiagents.knowledge", mod)
    embed = types.ModuleType("praisonaiagents.embedding")  # the init probe: no API call
    embed.embedding = lambda *a, **k: None
    monkeypatch.setitem(sys.modules, "praisonaiagents.embedding", embed)

    _use(monkeypatch, dirs["a"])
    SDKKnowledgeManager()._get_sdk_knowledge()
    _use(monkeypatch, dirs["b"])
    SDKKnowledgeManager()._get_sdk_knowledge()
    _unconfigure(monkeypatch)
    SDKKnowledgeManager()._get_sdk_knowledge()
    assert seen == [str(dirs["a"] / "knowledge"), str(dirs["b"] / "knowledge"), ".praisonai"]


# ── training and MCP config ──────────────────────────────────────────


def test_training_sessions_follow_the_data_dir(dirs, monkeypatch):
    from praisonaiui.features.training import _storage_dir

    _use(monkeypatch, dirs["a"])
    assert _storage_dir() == dirs["a"] / "train"
    _use(monkeypatch, dirs["b"])
    assert _storage_dir() == dirs["b"] / "train"
    monkeypatch.setenv("PRAISON_TRAIN_DIR", str(dirs["home"] / "explicit"))
    assert _storage_dir() == dirs["home"] / "explicit"
    monkeypatch.delenv("PRAISON_TRAIN_DIR")
    _unconfigure(monkeypatch)
    assert _storage_dir() == dirs["home"] / ".praison" / "train"


def test_mcp_auto_discovery_reads_the_data_dir_config(dirs, monkeypatch):
    import asyncio

    from praisonaiui.features import mcp

    connected = []

    async def _connect(config, session_context=None):
        connected.append(config["name"])

    monkeypatch.setattr(mcp, "connect_mcp_server", _connect)
    for where, name in (
        (dirs["home"] / ".praisonai", "global"),
        (dirs["a"], "server-a"),
        (dirs["b"], "server-b"),
    ):
        where.mkdir(parents=True, exist_ok=True)
        (where / "mcp.json").write_text(json.dumps({"servers": [{"name": name}]}))

    _use(monkeypatch, dirs["a"])
    asyncio.run(mcp.auto_discover_mcp_servers())
    _use(monkeypatch, dirs["b"])
    asyncio.run(mcp.auto_discover_mcp_servers())
    _unconfigure(monkeypatch)
    asyncio.run(mcp.auto_discover_mcp_servers())
    assert connected == ["server-a", "server-b", "global"]


# ── video projects ───────────────────────────────────────────────────


def _video_project(root: Path, project_id: str) -> None:
    (root / project_id / ".praisonai").mkdir(parents=True, exist_ok=True)


def test_video_projects_follow_the_data_dir(dirs, monkeypatch):
    from praisonaiui import video_config
    from praisonaiui.features.video import VideoFeature

    monkeypatch.setattr(video_config, "_projects_dir", None)
    client = TestClient(Starlette(routes=VideoFeature().routes()))

    def listed() -> set[str]:
        return {p["id"] for p in client.get("/api/video/projects").json()["projects"]}

    _video_project(dirs["home"] / ".praisonai" / "projects", "proj-global")
    _video_project(dirs["a"] / "projects", "proj-a")
    _video_project(dirs["b"] / "projects", "proj-b")

    _use(monkeypatch, dirs["a"])
    assert listed() == {"proj-a"}
    created = client.post("/api/video/projects", json={"name": "new one"}).json()
    assert Path(created["path"]).parent == dirs["a"] / "projects"
    _use(monkeypatch, dirs["b"])
    assert listed() == {"proj-b"}

    monkeypatch.setenv("PRAISONAI_PROJECTS_DIR", str(dirs["home"] / "explicit"))
    _video_project(dirs["home"] / "explicit", "proj-explicit")
    assert listed() == {"proj-explicit"}
    monkeypatch.setattr(video_config, "_projects_dir", dirs["a"] / "projects")
    assert "proj-a" in listed()  # set_video_engine(projects_dir=) wins over all
    monkeypatch.setattr(video_config, "_projects_dir", None)
    monkeypatch.delenv("PRAISONAI_PROJECTS_DIR")

    _unconfigure(monkeypatch)  # no data dir: the historical folder, unchanged
    assert listed() == {"proj-global"}
