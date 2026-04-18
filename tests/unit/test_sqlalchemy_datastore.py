"""Tests for SQLAlchemyDataStore — async SQLAlchemy-based session storage.

Verifies:
- Schema auto-creation on first run
- All 6 BaseDataStore methods implemented
- SQLite default behavior
- Atomic writes (single transaction per message append)
- Lazy import behavior
- PostgreSQL URL support
- Concurrent writes handling
- Title auto-generation
- toolCalls metadata preservation
"""

import asyncio
import json
import os
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture
def temp_db_path():
    """Create a temporary SQLite database file."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    yield db_path
    # Cleanup
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest.fixture
def sqlite_url(temp_db_path):
    """SQLite database URL for testing."""
    return f"sqlite+aiosqlite:///{temp_db_path}"


# ── Test lazy imports and graceful degradation ──────────────────────────


def test_import_without_sqlalchemy_raises_on_init():
    """SQLAlchemyDataStore should be importable but raise on initialization without SQLAlchemy."""
    # This just tests that the class can be imported
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    # We can create an instance (lazy import)
    store = SQLAlchemyDataStore()
    assert store is not None
    
    # But initialization should fail without SQLAlchemy
    with patch("praisonaiui.datastore.SQLAlchemyDataStore._ensure_initialized") as mock_init:
        mock_init.side_effect = ImportError("No module named 'sqlalchemy'")
        
        # This should work fine (no actual DB operations yet)
        store = SQLAlchemyDataStore("sqlite+aiosqlite:///test.db")
        assert store._database_url == "sqlite+aiosqlite:///test.db"


@pytest.mark.asyncio
async def test_missing_dependencies_error(monkeypatch):
    """Should raise helpful error when SQLAlchemy dependencies are missing."""
    from praisonaiui.datastore import SQLAlchemyDataStore
    import praisonaiui.datastore as ds
    import builtins

    # Reset module state and simulate missing SQLAlchemy
    monkeypatch.setattr(ds, "_ORM_MODELS", None, raising=False)
    monkeypatch.setattr(ds, "_SQLALCHEMY_AVAILABLE", False, raising=False)

    # Mock __import__ to fail for sqlalchemy
    real_import = builtins.__import__
    def fake_import(name, *a, **kw):
        if name.startswith("sqlalchemy"):
            raise ImportError(f"No module named '{name}'")
        return real_import(name, *a, **kw)
    monkeypatch.setattr(builtins, "__import__", fake_import)

    store = SQLAlchemyDataStore()
    with pytest.raises(ImportError, match="SQLAlchemy dependencies not found"):
        await store.list_sessions()


# ── Test default SQLite behavior ────────────────────────────────────────


@pytest.mark.asyncio 
async def test_default_sqlite_url():
    """Default should create ~/.praisonaiui/aiui.db"""
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    with patch.dict(os.environ, {}, clear=True):
        store = SQLAlchemyDataStore()
        expected = str(Path.home() / ".praisonaiui" / "aiui.db")
        assert expected in store._database_url
        assert store._database_url.startswith("sqlite+aiosqlite:///")


@pytest.mark.asyncio
async def test_respects_aiui_data_dir_env():
    """Should respect AIUI_DATA_DIR environment variable."""
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch.dict(os.environ, {"AIUI_DATA_DIR": tmpdir}):
            store = SQLAlchemyDataStore()
            expected = str(Path(tmpdir) / "aiui.db")
            assert expected in store._database_url


# ── Test core CRUD operations ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_and_list_sessions(sqlite_url):
    """Created sessions should appear in list."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        # Create session
        sid = str(uuid.uuid4())
        result = await store.create_session(sid)
        assert result["id"] == sid
        assert result["title"] == "New conversation"
        assert "created_at" in result
        assert "updated_at" in result
        
        # List sessions
        sessions = await store.list_sessions()
        ids = [s["id"] for s in sessions]
        assert sid in ids
        
        # Check session details
        session_info = next(s for s in sessions if s["id"] == sid)
        assert session_info["title"] == "New conversation"
        assert session_info["message_count"] == 0
        
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_get_session_full_data(sqlite_url):
    """get_session should return full session data including messages."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        # Add some messages
        await store.add_message(sid, {"role": "user", "content": "Hello"})
        await store.add_message(sid, {"role": "assistant", "content": "Hi there!"})
        
        # Get full session
        session = await store.get_session(sid)
        assert session is not None
        assert session["id"] == sid
        assert len(session["messages"]) == 2
        assert session["messages"][0]["role"] == "user"
        assert session["messages"][0]["content"] == "Hello"
        assert session["messages"][1]["role"] == "assistant"
        assert session["messages"][1]["content"] == "Hi there!"
        
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_delete_session(sqlite_url):
    """Deleted sessions should be removed completely."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        await store.add_message(sid, {"role": "user", "content": "Test"})
        
        # Delete session
        deleted = await store.delete_session(sid)
        assert deleted is True
        
        # Should not exist anymore
        session = await store.get_session(sid)
        assert session is None
        
        # Should not appear in list
        sessions = await store.list_sessions()
        ids = [s["id"] for s in sessions]
        assert sid not in ids
        
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_get_session_not_found(sqlite_url):
    """Non-existent session should return None."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        session = await store.get_session("nonexistent-id")
        assert session is None
    finally:
        await store.close()


# ── Test message operations ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_and_get_messages(sqlite_url):
    """Messages should round-trip correctly."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        # Add messages
        await store.add_message(sid, {"role": "user", "content": "What is Python?"})
        await store.add_message(sid, {"role": "assistant", "content": "A programming language."})
        
        # Get messages
        messages = await store.get_messages(sid)
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "What is Python?"
        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"] == "A programming language."
        
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_tool_calls_metadata_preservation(sqlite_url):
    """toolCalls and other metadata should be preserved."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        # Add message with toolCalls
        tool_calls = [
            {
                "name": "search_web",
                "args": {"query": "Python 3.13"},
                "result": "Some results...",
                "status": "done",
            }
        ]
        await store.add_message(sid, {
            "role": "assistant",
            "content": "I'll search for that.",
            "toolCalls": tool_calls,
            "custom_field": "test_value",
        })
        
        # Retrieve and verify
        messages = await store.get_messages(sid)
        assert len(messages) == 1
        msg = messages[0]
        assert msg["role"] == "assistant"
        assert msg["content"] == "I'll search for that."
        assert msg["toolCalls"] == tool_calls
        assert msg["custom_field"] == "test_value"
        
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_title_auto_generation(sqlite_url):
    """Title should be auto-generated from first user message."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        # First user message should generate title
        await store.add_message(sid, {"role": "user", "content": "What is machine learning?"})
        
        session = await store.get_session(sid)
        assert session["title"] != "New conversation"
        assert "machine learning" in session["title"] or "Machine learning" in session["title"]
        
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_multiple_messages_ordered(sqlite_url):
    """Messages should be returned in chronological order."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        # Add messages in sequence
        for i in range(5):
            role = "user" if i % 2 == 0 else "assistant"
            await store.add_message(sid, {"role": role, "content": f"Message {i}"})
        
        messages = await store.get_messages(sid)
        assert len(messages) == 5
        for i, msg in enumerate(messages):
            assert msg["content"] == f"Message {i}"
            
    finally:
        await store.close()


# ── Test session updates ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_session(sqlite_url):
    """update_session should modify session metadata."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        # Update title
        await store.update_session(sid, title="Custom Title", platform="test")
        
        session = await store.get_session(sid)
        assert session["title"] == "Custom Title"
        assert session["platform"] == "test"
        
    finally:
        await store.close()


# ── Test concurrent operations ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_concurrent_message_writes(sqlite_url):
    """Multiple concurrent message writes should work correctly."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        # Add messages concurrently
        tasks = []
        for i in range(10):
            task = store.add_message(sid, {"role": "user", "content": f"Message {i}"})
            tasks.append(task)
        
        await asyncio.gather(*tasks)
        
        # All messages should be present
        messages = await store.get_messages(sid)
        assert len(messages) == 10
        contents = [msg["content"] for msg in messages]
        for i in range(10):
            assert f"Message {i}" in contents
            
    finally:
        await store.close()


# ── Test PostgreSQL URL support ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_postgres_url_accepted():
    """PostgreSQL URL should be accepted (even if we can't test actual connection)."""
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    postgres_url = "postgresql+asyncpg://user:pass@localhost/testdb"
    store = SQLAlchemyDataStore(postgres_url)
    
    assert store._database_url == postgres_url
    # Don't actually test connection since we don't have a Postgres instance


# ── Test schema auto-creation ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_schema_auto_creation(sqlite_url):
    """Tables should be created automatically on first access."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    # Fresh database - tables shouldn't exist yet
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        # This should trigger schema creation
        sessions = await store.list_sessions()
        assert isinstance(sessions, list)
        assert len(sessions) == 0
        
        # Should be able to create sessions now
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        sessions = await store.list_sessions()
        assert len(sessions) == 1
        
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_record_and_list_feedback(sqlite_url):
    """Feedback should be recorded and retrieved correctly."""
    pytest.importorskip("sqlalchemy")
    pytest.importorskip("aiosqlite")
    
    from praisonaiui.datastore import SQLAlchemyDataStore
    
    store = SQLAlchemyDataStore(sqlite_url)
    
    try:
        # Create session first
        sid = str(uuid.uuid4())
        await store.create_session(sid)
        
        # Add message to have a message_id
        await store.add_message(sid, {"role": "user", "content": "Test message"})
        message_id = "msg_123"
        
        # Record positive feedback
        await store.record_feedback(sid, message_id, 1, "Great response!")
        
        # Record negative feedback
        await store.record_feedback(sid, message_id, -1, "Not helpful")
        
        # List all feedback
        all_feedback = await store.list_feedback()
        assert len(all_feedback) == 2
        
        # Check first feedback
        feedback1 = all_feedback[0]
        assert feedback1["session_id"] == sid
        assert feedback1["message_id"] == message_id
        assert feedback1["value"] == 1
        assert feedback1["comment"] == "Great response!"
        assert "created_at" in feedback1
        assert "id" in feedback1
        
        # Check second feedback
        feedback2 = all_feedback[1]
        assert feedback2["session_id"] == sid
        assert feedback2["message_id"] == message_id
        assert feedback2["value"] == -1
        assert feedback2["comment"] == "Not helpful"
        
        # List feedback filtered by session
        session_feedback = await store.list_feedback(session_id=sid)
        assert len(session_feedback) == 2
        
        # List feedback for non-existent session
        other_feedback = await store.list_feedback(session_id="nonexistent")
        assert len(other_feedback) == 0
        
    finally:
        await store.close()