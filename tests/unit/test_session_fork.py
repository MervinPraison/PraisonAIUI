"""Unit tests for the session fork endpoint (POST /api/sessions/{id}/fork)."""

import asyncio

import pytest
from starlette.testclient import TestClient

from praisonaiui.datastore import MemoryDataStore
from praisonaiui.features.sessions_ext import _sanitize_message


@pytest.fixture
def store():
    return MemoryDataStore()


@pytest.fixture
def client(store):
    import praisonaiui.server as server

    original = server._datastore
    server._datastore = store
    try:
        yield TestClient(server.create_app())
    finally:
        server._datastore = original


def _seed(store, session_id, count):
    async def _run():
        await store.create_session(session_id)
        for i in range(count):
            role = "user" if i % 2 == 0 else "assistant"
            await store.add_message(session_id, {"role": role, "content": f"msg {i}"})

    asyncio.run(_run())


def _messages(store, session_id):
    return asyncio.run(store.get_messages(session_id))


def _session(store, session_id):
    return asyncio.run(store.get_session(session_id))


def test_sanitize_message_strips_ephemeral_ids():
    msg = {
        "id": "ephemeral-1",
        "role": "user",
        "content": "hi",
        "tool_calls": [{"name": "x"}],
        "timestamp": 123,
    }
    out = _sanitize_message(msg)
    assert "id" not in out
    assert "timestamp" not in out
    assert out["role"] == "user"
    assert out["content"] == "hi"
    assert out["tool_calls"] == [{"name": "x"}]


def test_fork_copies_all_messages(store, client):
    _seed(store, "parent", 4)

    resp = client.post("/api/sessions/parent/fork", json={})
    assert resp.status_code == 200
    body = resp.json()

    assert body["parent_id"] == "parent"
    assert body["message_count"] == 4
    child_id = body["session_id"]
    assert child_id != "parent"

    child_messages = _messages(store, child_id)
    assert len(child_messages) == 4
    assert child_messages[0]["content"] == "msg 0"


def test_fork_up_to_index_truncates(store, client):
    _seed(store, "parent", 10)

    resp = client.post("/api/sessions/parent/fork", json={"up_to_index": 3})
    assert resp.status_code == 200
    body = resp.json()

    assert body["forked_at_index"] == 3
    assert body["message_count"] == 4

    child_messages = _messages(store, body["session_id"])
    assert len(child_messages) == 4
    assert child_messages[-1]["content"] == "msg 3"


def test_fork_records_parent_metadata(store, client):
    _seed(store, "parent", 2)

    resp = client.post(
        "/api/sessions/parent/fork",
        json={"agent_id": "support_bot", "labels": ["playground-fork"]},
    )
    assert resp.status_code == 200
    child_id = resp.json()["session_id"]

    child = _session(store, child_id)
    meta = child.get("metadata", {})
    assert meta.get("parent_session_id") == "parent"
    assert meta.get("agent_id") == "support_bot"
    assert meta.get("source") == "playground-fork"


def test_fork_missing_source_returns_404(client):
    resp = client.post("/api/sessions/does-not-exist/fork", json={})
    assert resp.status_code == 404


def test_fork_index_out_of_range_returns_400(store, client):
    _seed(store, "parent", 3)

    resp = client.post("/api/sessions/parent/fork", json={"up_to_index": 99})
    assert resp.status_code == 400
    assert resp.json()["total_messages"] == 3


def test_fork_virtual_agent_session_blocked(client):
    resp = client.post("/api/sessions/agent:support/fork", json={})
    assert resp.status_code == 400


def _persistent_stores(tmp_path):
    """Build the persistent datastores that ship as the default (SDK + JSON)."""
    stores = []
    from praisonaiui.datastore import JSONFileDataStore

    stores.append(JSONFileDataStore(data_dir=str(tmp_path / "json")))
    try:
        from praisonaiui.datastore_sdk import SDKFileDataStore

        stores.append(SDKFileDataStore(session_dir=str(tmp_path / "sdk")))
    except (ImportError, Exception):
        pass
    return stores


def test_fork_metadata_persists_on_default_stores(tmp_path):
    """Fork lineage must survive on the persistent stores, not just MemoryDataStore.

    Regression: SDKFileDataStore/JSONFileDataStore (the shipped defaults) previously
    dropped session-level ``metadata`` in ``update_session``, so parent lineage was
    silently lost outside of tests running on MemoryDataStore.
    """
    import praisonaiui.server as server

    for ds in _persistent_stores(tmp_path):
        original = server._datastore
        server._datastore = ds
        try:
            client = TestClient(server.create_app())
            _seed(ds, "parent", 2)
            resp = client.post(
                "/api/sessions/parent/fork",
                json={"agent_id": "support_bot"},
            )
            assert resp.status_code == 200, type(ds).__name__
            child_id = resp.json()["session_id"]

            child = asyncio.run(ds.get_session(child_id))
            meta = child.get("metadata", {})
            assert meta.get("parent_session_id") == "parent", type(ds).__name__
            assert meta.get("agent_id") == "support_bot", type(ds).__name__
            assert meta.get("source") == "playground-fork", type(ds).__name__
        finally:
            server._datastore = original
