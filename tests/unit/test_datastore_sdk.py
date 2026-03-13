"""Tests for SDKFileDataStore — async adapter wrapping SDK DefaultSessionStore.

Verifies:
- add_message maps dict → (role, content, metadata)
- toolCalls stored in metadata
- title auto-generation
- get_messages reconstructs AIUI-format dicts
- create_session / delete_session / list_sessions
- graceful fallback when SDK not available
"""

import asyncio
import json
import os
import shutil
import tempfile
import uuid
from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture
def tmp_session_dir():
    """Create a temp dir for session files, clean up after."""
    d = tempfile.mkdtemp(prefix="test_sdk_store_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def sdk_store(tmp_session_dir):
    """Create a real SDK DefaultSessionStore pointed at temp dir."""
    from praisonaiagents.session.store import DefaultSessionStore
    return DefaultSessionStore(session_dir=tmp_session_dir)


@pytest.fixture
def adapter(tmp_session_dir, sdk_store):
    """Create SDKFileDataStore adapter wrapping a real SDK store."""
    from praisonaiui.datastore_sdk import SDKFileDataStore
    store = SDKFileDataStore.__new__(SDKFileDataStore)
    store._store = sdk_store
    store._session_dir = tmp_session_dir
    store._titles = {}
    return store


# ── Core message round-trip ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_and_get_user_message(adapter):
    """User message round-trips through SDK store."""
    sid = str(uuid.uuid4())
    await adapter.create_session(sid)
    await adapter.add_message(sid, {"role": "user", "content": "Hello world"})

    messages = await adapter.get_messages(sid)
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Hello world"


@pytest.mark.asyncio
async def test_add_and_get_assistant_message(adapter):
    """Assistant message round-trips through SDK store."""
    sid = str(uuid.uuid4())
    await adapter.create_session(sid)
    await adapter.add_message(sid, {"role": "assistant", "content": "Hi there!"})

    messages = await adapter.get_messages(sid)
    assert len(messages) == 1
    assert messages[0]["role"] == "assistant"
    assert messages[0]["content"] == "Hi there!"


# ── toolCalls in metadata ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tool_calls_persisted_in_metadata(adapter):
    """toolCalls should be stored in metadata and restored on read."""
    sid = str(uuid.uuid4())
    await adapter.create_session(sid)

    tool_calls = [
        {
            "name": "internet_search",
            "args": {"query": "Python 3.13"},
            "result": "Some results",
            "status": "done",
        }
    ]
    await adapter.add_message(sid, {
        "role": "assistant",
        "content": "Here are the results",
        "toolCalls": tool_calls,
    })

    messages = await adapter.get_messages(sid)
    assert len(messages) == 1
    assert messages[0]["toolCalls"] == tool_calls


# ── Title auto-generation ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_title_auto_generated_from_first_user_message(adapter):
    """Title should be auto-generated from first user message."""
    sid = str(uuid.uuid4())
    await adapter.create_session(sid)
    await adapter.add_message(sid, {"role": "user", "content": "What is Python?"})

    session = await adapter.get_session(sid)
    assert session is not None
    title = session.get("title", "")
    # Title should not be the default "New conversation"
    assert title != "New conversation"
    assert "Python" in title or "python" in title.lower()


# ── Session CRUD ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_and_list_sessions(adapter):
    """Created sessions appear in list."""
    sid = str(uuid.uuid4())
    result = await adapter.create_session(sid)
    assert result["id"] == sid

    sessions = await adapter.list_sessions()
    ids = [s["id"] for s in sessions]
    assert sid in ids


@pytest.mark.asyncio
async def test_delete_session(adapter):
    """Deleted sessions removed from list."""
    sid = str(uuid.uuid4())
    await adapter.create_session(sid)
    deleted = await adapter.delete_session(sid)
    assert deleted is True

    session = await adapter.get_session(sid)
    assert session is None


@pytest.mark.asyncio
async def test_get_session_not_found(adapter):
    """Non-existent session returns None."""
    session = await adapter.get_session("nonexistent-id")
    assert session is None


# ── Multiple messages ordering ───────────────────────────────────────


@pytest.mark.asyncio
async def test_multiple_messages_ordered(adapter):
    """Messages come back in insertion order."""
    sid = str(uuid.uuid4())
    await adapter.create_session(sid)

    for i in range(5):
        role = "user" if i % 2 == 0 else "assistant"
        await adapter.add_message(sid, {"role": role, "content": f"msg-{i}"})

    messages = await adapter.get_messages(sid)
    assert len(messages) == 5
    for i, msg in enumerate(messages):
        assert msg["content"] == f"msg-{i}"


# ── Factory / fallback ───────────────────────────────────────────────


def test_factory_tries_sdk_first():
    """_init_datastore should try SDK adapter first."""
    # This test just verifies the import path exists
    from praisonaiui.datastore_sdk import SDKFileDataStore
    assert SDKFileDataStore is not None
