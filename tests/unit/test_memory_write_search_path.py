"""End-to-end tests for the memory write, search, and cross-session recall path.

Covers:
  * ``FileMemory`` wrapped search hits (``{"type", "item", "score"}``) are
    normalized to clean ``{id, text, memory_type, metadata, session_id, score}``.
  * ``POST /api/chat/send`` (and WebSocket chat via ``_run_and_broadcast``)
    auto-persists completed user/assistant turns into platform memory off the
    event loop, matching ``POST /run``, so ``POST /api/memory/search`` and
    ``GET /api/memory/session/{session_id}`` find them on both direct-mode and
    ``@aiui.reply`` apps.
  * ``PraisonAIProvider`` shares one memory backend across per-session agents
    so Session B recalls Session A's facts and never clobbers
    ``SDKMemoryManager`` with an empty per-agent store.
  * ``SDKMemoryManager.delete``, ``clear`` (``clear_all``/``clear_short_term``),
    ``get_context`` (``FileMemory.get_context``), and ``top_k`` in
    ``/api/memory/search`` all work consistently.
"""

from __future__ import annotations

import time

import pytest
from starlette.testclient import TestClient

from praisonaiui.features import memory as memory_mod
from praisonaiui.features.memory import SDKMemoryManager, SimpleMemoryManager


class _FakeFileMemory:
    """Mimics ``praisonaiagents.memory.file_memory.FileMemory`` wire shapes."""

    def __init__(self) -> None:
        self._short: list[dict] = []
        self._long: list[dict] = []
        self._seq = 0

    def _next_id(self) -> str:
        self._seq += 1
        return f"fm-{self._seq}"

    def store_short_term(self, text: str, metadata: dict | None = None, **kwargs) -> str:
        mid = self._next_id()
        self._short.append(
            {
                "id": mid,
                "content": text,
                "metadata": dict(metadata or {}),
                "created_at": 100.0 + self._seq,
            }
        )
        return mid

    def store_long_term(self, text: str, metadata: dict | None = None, **kwargs) -> str:
        mid = self._next_id()
        self._long.append(
            {
                "id": mid,
                "content": text,
                "metadata": dict(metadata or {}),
                "created_at": 200.0 + self._seq,
            }
        )
        return mid

    def search_short_term(self, query: str, limit: int = 5, **kwargs) -> list[dict]:
        q = query.lower()
        hits = [
            {"type": "short_term", "item": item, "score": 0.75}
            for item in self._short
            if q in item["content"].lower()
        ]
        return hits[:limit]

    def search_long_term(self, query: str, limit: int = 5, **kwargs) -> list[dict]:
        q = query.lower()
        hits = [
            {"type": "long_term", "item": item, "score": 0.9}
            for item in self._long
            if q in item["content"].lower()
        ]
        return hits[:limit]

    def get_all_memories(self) -> list[dict]:
        return [
            {"type": "short_term", **item} for item in self._short
        ] + [
            {"type": "long_term", **item} for item in self._long
        ]

    def delete_memory(self, memory_id: str) -> bool:
        for bucket in (self._short, self._long):
            for idx, item in enumerate(bucket):
                if item["id"] == memory_id:
                    bucket.pop(idx)
                    return True
        return False

    def clear_short_term(self) -> None:
        self._short.clear()

    def clear_all(self) -> None:
        self._short.clear()
        self._long.clear()

    def get_context(self, query: str | None = None) -> str:
        hits = self.search_short_term(query or "") + self.search_long_term(query or "")
        if not hits:
            return ""
        return "## Relevant Memories\n" + "\n".join(f"- {h['item']['content']}" for h in hits)


def test_file_memory_wrapped_records_normalize_cleanly():
    mgr = SDKMemoryManager()
    mgr._sdk_memory = _FakeFileMemory()

    short_entry = mgr.store(
        "My favorite programming language is Haskell.",
        memory_type="short",
        session_id="sess-1",
        agent_id="assistant",
        metadata={"role": "user"},
    )
    long_entry = mgr.store(
        "User works on distributed systems.",
        memory_type="long",
        session_id="sess-1",
    )

    assert short_entry["id"] == "fm-1"
    assert long_entry["id"] == "fm-2"

    # Search must unwrap FileMemory's {"type", "item", "score"} wrapper
    hits = mgr.search("Haskell", memory_type="all")
    assert len(hits) == 1
    assert hits[0]["id"] == "fm-1"
    assert hits[0]["text"] == "My favorite programming language is Haskell."
    assert hits[0]["memory_type"] == "short"
    assert hits[0]["session_id"] == "sess-1"
    assert hits[0]["agent_id"] == "assistant"
    assert hits[0]["score"] == 0.75

    # get() and list_all() preserve session_id and clean text
    fetched = mgr.get("fm-1")
    assert fetched is not None
    assert fetched["text"] == "My favorite programming language is Haskell."
    assert fetched["session_id"] == "sess-1"

    # get_context() bridges to FileMemory.get_context(query=...)
    assert "Haskell" in mgr.get_context("Haskell")

    # delete() uses the SDK-assigned id
    assert mgr.delete("fm-2") is True
    assert mgr.get("fm-2") is None

    # clear("short") and clear("all") invoke FileMemory clear methods
    mgr.clear("short")
    assert mgr.list_all(memory_type="short") == []
    mgr.store("Persisted fact", memory_type="long")
    mgr.clear("all")
    assert mgr.list_all() == []


def test_chat_send_error_turn_does_not_pollute_memory(tmp_path, monkeypatch):
    """A failed @aiui.reply run must not store broken turns in memory."""
    import praisonaiui as aiui
    from praisonaiui import server as srv
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.providers import PraisonAIProvider

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(srv, "_datastore", MemoryDataStore())
    monkeypatch.setattr(srv, "_provider", PraisonAIProvider())
    old_callbacks = dict(srv._callbacks)
    srv._callbacks.clear()

    mem = SimpleMemoryManager()
    monkeypatch.setattr(memory_mod, "_memory_manager", mem)

    try:
        @aiui.reply
        async def failing_reply(msg):
            raise RuntimeError("boom")

        app = srv.create_app()
        with TestClient(app) as client:
            resp = client.post(
                "/api/chat/send",
                json={"message": "SecretShouldNotStore", "session_id": "sess-err"},
            )
            assert resp.status_code == 200

            deadline = time.time() + 5.0
            while time.time() < deadline:
                hist = client.get("/api/chat/history/sess-err").json().get("messages", [])
                if any(m.get("role") == "assistant" for m in hist):
                    break
                time.sleep(0.05)

            assert mem.search("SecretShouldNotStore") == []
    finally:
        srv._callbacks.clear()
        srv._callbacks.update(old_callbacks)


def test_chat_send_persists_reply_callback_turns_to_memory(tmp_path, monkeypatch):
    """POST /api/chat/send with @aiui.reply stores turns searchable via /api/memory/search."""
    import praisonaiui as aiui
    from praisonaiui import server as srv
    from praisonaiui.datastore import MemoryDataStore
    from praisonaiui.providers import PraisonAIProvider

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(srv, "_datastore", MemoryDataStore())
    monkeypatch.setattr(srv, "_provider", PraisonAIProvider())
    old_callbacks = dict(srv._callbacks)
    srv._callbacks.clear()

    mem = SimpleMemoryManager()
    monkeypatch.setattr(memory_mod, "_memory_manager", mem)

    try:
        @aiui.reply
        async def on_message(msg):
            await aiui.say(f"Noted: {msg.text}")

        app = srv.create_app()
        with TestClient(app) as client:
            resp = client.post(
                "/api/chat/send",
                json={
                    "message": "My favorite programming language is Haskell.",
                    "session_id": "sess-a",
                },
            )
            assert resp.status_code == 200

            # Wait for background chat turn to finish and persist
            deadline = time.time() + 5.0
            found = []
            while time.time() < deadline:
                search = client.post(
                    "/api/memory/search",
                    json={"query": "Haskell", "top_k": 5},
                )
                assert search.status_code == 200
                found = search.json().get("results", [])
                if found:
                    break
                time.sleep(0.05)

            assert found, "Expected 'Haskell' turn to be stored in /api/memory/search"
            assert any("Haskell" in r.get("text", "") for r in found)

            by_session = client.get("/api/memory/session/sess-a")
            assert by_session.status_code == 200
            roles = {m.get("metadata", {}).get("role") for m in by_session.json()["memories"]}
            assert roles == {"user", "assistant"}
    finally:
        srv._callbacks.clear()
        srv._callbacks.update(old_callbacks)


def test_provider_session_agents_share_memory_backend(tmp_path, monkeypatch):
    """Session A and Session B get isolated chat_history but share one memory store."""
    pytest.importorskip("praisonaiagents")
    from praisonaiui.providers import PraisonAIProvider

    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-placeholder")
    mgr = SDKMemoryManager()
    monkeypatch.setattr(memory_mod, "_memory_manager", mgr)

    provider = PraisonAIProvider()
    agent_a = provider._get_or_create_agent(session_id="sess-a")
    agent_b = provider._get_or_create_agent(session_id="sess-b")

    assert agent_a is not None and agent_b is not None
    assert agent_a is not agent_b
    assert agent_a._memory_instance is not None
    assert agent_a._memory_instance is agent_b._memory_instance
    assert mgr._get_sdk_memory() is agent_a._memory_instance

    # Session A stores a fact; Session B's context and /api/memory/search both see it
    mgr.store(
        "My favorite programming language is Haskell.",
        memory_type="short",
        session_id="sess-a",
        metadata={"role": "user"},
    )
    assert "Haskell" in agent_b.get_memory_context("favorite programming language")
    hits = mgr.search("Haskell")
    assert len(hits) >= 1
    assert hits[0]["text"] == "My favorite programming language is Haskell."
    assert hits[0]["session_id"] == "sess-a"
