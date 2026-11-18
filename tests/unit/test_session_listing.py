"""Session listing: unchanged files are not re-read, and lists can be paged.

``list_sessions`` runs after every chat turn (the app shell refreshes the
sidebar) and on every sidebar load. It used to ``json.load`` every session
file each time, so its cost grew with the whole chat history.
"""

from __future__ import annotations

import asyncio
import importlib.util
import os

import pytest
from starlette.testclient import TestClient

import praisonaiui.config_store as config_store
import praisonaiui.server as srv
from praisonaiui.datastore import JSONFileDataStore


def _make(store: JSONFileDataStore, n: int) -> list[str]:
    ids = []
    for i in range(n):
        sid = f"s{i:02d}"
        asyncio.run(store.create_session(sid))
        asyncio.run(store.add_message(sid, {"role": "user", "content": f"hello {i}"}))
        # newest last: distinct, increasing mtimes
        os.utime(store._session_path(sid), (1_700_000_000 + i, 1_700_000_000 + i))
        ids.append(sid)
    return ids


def _count_reads(store, monkeypatch) -> list[str]:
    reads: list[str] = []
    real = store._read_session

    def counting(path):
        reads.append(path.name)
        return real(path)

    monkeypatch.setattr(store, "_read_session", counting)
    return reads


def test_json_store_reads_each_unchanged_file_once(tmp_path, monkeypatch):
    store = JSONFileDataStore(str(tmp_path / "sessions"))
    ids = _make(store, 5)
    reads = _count_reads(store, monkeypatch)

    first = asyncio.run(store.list_sessions())
    assert [s["id"] for s in first] == list(reversed(ids))  # newest first
    assert first[0]["message_count"] == 1
    assert first[0]["title"] == store.generate_title("hello 4")
    assert len(reads) == 5

    reads.clear()
    assert asyncio.run(store.list_sessions()) == first
    assert reads == []

    asyncio.run(store.add_message("s01", {"role": "assistant", "content": "hi"}))
    reads.clear()
    again = asyncio.run(store.list_sessions())
    assert reads == ["s01.json"]
    assert {s["id"]: s["message_count"] for s in again}["s01"] == 2

    asyncio.run(store.delete_session("s02"))
    assert "s02" not in {s["id"] for s in asyncio.run(store.list_sessions())}
    assert asyncio.run(store.count_sessions()) == 4


def test_returned_rows_are_copies(tmp_path):
    store = JSONFileDataStore(str(tmp_path / "sessions"))
    _make(store, 1)
    asyncio.run(store.list_sessions())[0]["title"] = "mutated by a caller"
    assert asyncio.run(store.list_sessions())[0]["title"] == store.generate_title("hello 0")


@pytest.mark.skipif(
    importlib.util.find_spec("praisonaiagents") is None, reason="needs praisonaiagents"
)
def test_sdk_store_reads_each_unchanged_file_once(tmp_path, monkeypatch):
    from praisonaiui.datastore_sdk import SDKFileDataStore

    store = SDKFileDataStore(session_dir=str(tmp_path / "sdk"))
    for i in range(3):
        asyncio.run(store.create_session(f"k{i}"))
        asyncio.run(store.add_message(f"k{i}", {"role": "user", "content": f"q{i}"}))
    calls: list[str] = []
    real = store._summarize
    monkeypatch.setattr(store, "_summarize", lambda fp: calls.append(str(fp)) or real(fp))
    first = asyncio.run(store.list_sessions())
    assert {s["id"] for s in first} == {"k0", "k1", "k2"}
    assert len(calls) == 3
    calls.clear()
    assert asyncio.run(store.list_sessions()) == first
    assert calls == []


# ── HTTP: ?limit=&offset= and total ──────────────────────────────────


@pytest.fixture
def client(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("AIUI_DATA_DIR", str(data))
    monkeypatch.setattr(config_store, "_config_store", None)
    config_store.init_config_store(data / "config.yaml")
    srv.reset_state()
    store = JSONFileDataStore(str(data / "sessions"))
    _make(store, 5)
    previous = srv.get_datastore()
    srv.set_datastore(store)
    yield TestClient(srv.create_app())
    srv.set_datastore(previous)
    srv.reset_state()


def test_api_sessions_pages(client):
    full = client.get("/api/sessions").json()
    assert full["count"] == full["total"] == 5
    page = client.get("/api/sessions?limit=2&offset=1").json()
    assert [s["id"] for s in page["sessions"]] == ["s03", "s02"]
    assert page["count"] == 2 and page["total"] == 5
    # invalid values fall back to the whole list
    assert client.get("/api/sessions?limit=x&offset=-3").json()["count"] == 5


def test_sessions_route_pages(client):
    page = client.get("/sessions?limit=1", headers={"Accept": "application/json"}).json()
    assert [s["id"] for s in page["sessions"]] == ["s04"]
    assert page["total"] == 5
    assert len(client.get("/sessions", headers={"Accept": "application/json"}).json()["sessions"]) == 5


def test_overview_counts_sessions(client):
    assert client.get("/api/overview").json()["stats"]["total_sessions"] == 5
