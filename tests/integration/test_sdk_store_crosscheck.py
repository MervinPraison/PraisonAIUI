"""Cross-verification integration tests for SDK session store adapter.

These tests verify that the AIUI API ↔ SDK on-disk store roundtrip is
correct: data written via the AIUI API lands in ``~/.praisonai/sessions/``
and data written directly via the SDK can be read back through AIUI.

Run with:
    python -m pytest tests/integration/test_sdk_store_crosscheck.py -v -o "addopts="
"""

import json
import os
import uuid

import pytest
from starlette.testclient import TestClient

from praisonaiui.server import create_app, set_datastore, _callbacks


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_callbacks():
    _callbacks.clear()
    yield
    _callbacks.clear()


@pytest.fixture
def tmp_session_dir(tmp_path):
    """Isolated temp dir so tests don't touch the user's real sessions."""
    d = tmp_path / "sessions"
    d.mkdir()
    return str(d)


@pytest.fixture
def sdk_store(tmp_session_dir):
    """Create an SDKFileDataStore pointed at a temp dir."""
    try:
        from praisonaiui.datastore_sdk import SDKFileDataStore
    except ImportError:
        pytest.skip("praisonai-agents SDK not installed")
    return SDKFileDataStore(session_dir=tmp_session_dir)


@pytest.fixture
def client(sdk_store):
    """Test client with the SDK store as the active datastore."""
    set_datastore(sdk_store)
    app = create_app()
    return TestClient(app)


@pytest.fixture
def raw_sdk_store(tmp_session_dir):
    """Raw SDK DefaultSessionStore (no AIUI wrapper) for cross-reads."""
    try:
        from praisonaiagents.session.store import DefaultSessionStore
    except ImportError:
        pytest.skip("praisonai-agents SDK not installed")
    return DefaultSessionStore(session_dir=tmp_session_dir)


# ---------------------------------------------------------------------------
# Tests: AIUI API → SDK on-disk
# ---------------------------------------------------------------------------

class TestAPIWriteSDKRead:
    """Write via AIUI REST API, then read from SDK store directly."""

    def test_create_session_appears_on_disk(self, client, tmp_session_dir):
        """POST /sessions must create a .json file in the SDK session dir."""
        r = client.post("/sessions")
        assert r.status_code == 200
        sid = r.json()["session_id"]

        filepath = os.path.join(tmp_session_dir, f"{sid}.json")
        assert os.path.exists(filepath), (
            f"Session {sid} not found on disk at {filepath}"
        )

        with open(filepath) as f:
            data = json.load(f)
        assert data["session_id"] == sid

    def test_api_session_readable_by_raw_sdk(
        self, client, raw_sdk_store, tmp_session_dir,
    ):
        """Session created via API should be loadable by raw SDK store."""
        r = client.post("/sessions")
        sid = r.json()["session_id"]

        # Read directly from raw SDK store
        session = raw_sdk_store.get_session(sid)
        assert session is not None
        assert session.session_id == sid

    def test_delete_session_removes_file(self, client, tmp_session_dir):
        """DELETE /sessions/{id} must remove the .json file from disk."""
        r = client.post("/sessions")
        sid = r.json()["session_id"]

        filepath = os.path.join(tmp_session_dir, f"{sid}.json")
        assert os.path.exists(filepath)

        r2 = client.delete(f"/sessions/{sid}")
        assert r2.status_code == 200
        assert not os.path.exists(filepath), "File should be deleted"

    def test_deleted_session_returns_404(self, client):
        """GET on a deleted session should return 404."""
        r = client.post("/sessions")
        sid = r.json()["session_id"]
        client.delete(f"/sessions/{sid}")

        r2 = client.get(f"/sessions/{sid}")
        assert r2.status_code == 404


# ---------------------------------------------------------------------------
# Tests: SDK direct write → AIUI API read
# ---------------------------------------------------------------------------

class TestSDKWriteAPIRead:
    """Write via raw SDK store, then read through AIUI REST API."""

    def test_sdk_session_listed_by_api(self, client, raw_sdk_store):
        """Session created by raw SDK should appear in GET /sessions."""
        sid = f"sdk-test-{uuid.uuid4()}"
        raw_sdk_store.add_message(sid, "user", "hello from SDK")

        r = client.get("/sessions")
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()["sessions"]]
        assert sid in ids, f"SDK session {sid} not found in API listing"

    def test_sdk_messages_readable_by_api(self, client, raw_sdk_store):
        """Messages added via raw SDK should be returned by GET /sessions/{id}."""
        sid = f"sdk-msg-{uuid.uuid4()}"
        raw_sdk_store.add_message(sid, "user", "ping from SDK")
        raw_sdk_store.add_message(sid, "assistant", "pong from SDK")

        r = client.get(f"/sessions/{sid}")
        assert r.status_code == 200

        data = r.json()
        msgs = data["messages"]
        assert len(msgs) == 2
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "ping from SDK"
        assert msgs[1]["role"] == "assistant"
        assert msgs[1]["content"] == "pong from SDK"


# ---------------------------------------------------------------------------
# Tests: toolCalls metadata roundtrip
# ---------------------------------------------------------------------------

class TestToolCallMetadataRoundtrip:
    """Ensure toolCalls survive the AIUI → disk → AIUI roundtrip."""

    def test_tool_calls_survive_roundtrip(self, sdk_store, tmp_session_dir):
        """toolCalls stored via adapter must be readable back."""
        import asyncio

        sid = f"tc-{uuid.uuid4()}"
        asyncio.run(sdk_store.create_session(sid))

        tool_calls = [
            {"name": "web_search", "args": {"q": "test"}, "status": "completed", "result": "found"},
            {"name": "write_file", "args": {"path": "/tmp/x"}, "status": "completed", "result": "ok"},
        ]
        asyncio.run(sdk_store.add_message(sid, {
            "role": "assistant",
            "content": "Here are the results",
            "toolCalls": tool_calls,
        }))

        # Read back
        msgs = asyncio.run(sdk_store.get_messages(sid))
        assert len(msgs) == 1
        assert msgs[0]["toolCalls"] == tool_calls

    def test_tool_calls_visible_on_disk(self, sdk_store, tmp_session_dir):
        """toolCalls should be stored in message metadata on disk."""
        import asyncio

        sid = f"tc-disk-{uuid.uuid4()}"
        asyncio.run(sdk_store.create_session(sid))
        asyncio.run(sdk_store.add_message(sid, {
            "role": "assistant",
            "content": "done",
            "toolCalls": [{"name": "read_file", "path": "/tmp/foo"}],
        }))

        # Read raw JSON from disk
        filepath = os.path.join(tmp_session_dir, f"{sid}.json")
        with open(filepath) as f:
            data = json.load(f)

        # Find the assistant message
        assistant_msgs = [m for m in data["messages"] if m.get("role") == "assistant"]
        assert len(assistant_msgs) >= 1
        meta = assistant_msgs[-1].get("metadata", {})
        assert "toolCalls" in meta, f"toolCalls not in metadata on disk: {meta}"

    def test_raw_sdk_metadata_readable_by_adapter(
        self, sdk_store, raw_sdk_store, tmp_session_dir,
    ):
        """Metadata written by raw SDK should be readable by the adapter."""
        import asyncio

        sid = f"raw-meta-{uuid.uuid4()}"
        raw_sdk_store.add_message(
            sid, "assistant", "result",
            metadata={"toolCalls": [{"name": "calculate", "expression": "2+2"}]},
        )

        # Read through AIUI adapter
        msgs = asyncio.run(sdk_store.get_messages(sid))
        assert len(msgs) == 1
        assert msgs[0]["toolCalls"] == [{"name": "calculate", "expression": "2+2"}]


# ---------------------------------------------------------------------------
# Tests: Session listing with empty store
# ---------------------------------------------------------------------------

class TestEmptyStore:
    """Tests against a clean, empty store."""

    def test_list_sessions_empty(self, client):
        """GET /sessions with no sessions should return empty list."""
        r = client.get("/sessions")
        assert r.status_code == 200
        assert r.json()["sessions"] == []

    def test_get_nonexistent_session(self, client):
        """GET /sessions/{id} for nonexistent session should return 404."""
        r = client.get(f"/sessions/{uuid.uuid4()}")
        assert r.status_code == 404

    def test_delete_nonexistent_session(self, client):
        """DELETE /sessions/{id} for nonexistent session should still succeed."""
        r = client.delete(f"/sessions/{uuid.uuid4()}")
        # SDK's delete_session returns True even for non-existent
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# Tests: Message ordering
# ---------------------------------------------------------------------------

class TestMessageOrdering:
    """Verify messages maintain insertion order across store roundtrip."""

    def test_messages_preserve_order(self, sdk_store):
        """Messages should come back in the order they were added."""
        import asyncio

        sid = f"order-{uuid.uuid4()}"
        asyncio.run(sdk_store.create_session(sid))

        for i in range(5):
            role = "user" if i % 2 == 0 else "assistant"
            asyncio.run(sdk_store.add_message(sid, {
                "role": role,
                "content": f"message-{i}",
            }))

        msgs = asyncio.run(sdk_store.get_messages(sid))
        contents = [m["content"] for m in msgs]
        assert contents == [f"message-{i}" for i in range(5)]
