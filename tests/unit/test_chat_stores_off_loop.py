"""The chat path reads knowledge and stores memory off the event loop.

Regression: ``run_agent`` called ``get_knowledge_manager().list_all()`` /
``search()`` before every turn and ``get_memory_manager().store()`` after it
directly on the event loop. Those block (chromadb, SQLite, embedding calls
over the network), so every chat turn stalled every other request.
"""

from __future__ import annotations

import json
import threading

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import praisonaiui.server as server
from praisonaiui.datastore import MemoryDataStore
from praisonaiui.features import knowledge, memory
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType


class _Provider(BaseProvider):
    def __init__(self):
        self.thread = None
        self.message = None

    async def run(self, message, *, session_id=None, agent_name=None, **kw):
        self.thread = threading.get_ident()
        self.message = message
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="answer")
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="answer")


class _Knowledge:
    thread = None

    def list_all(self):
        return [{"id": "k1"}]

    def search(self, text, limit=5):
        _Knowledge.thread = threading.get_ident()
        return [{"text": "aiui is a UI for agents"}]


class _Memory:
    def __init__(self):
        self.calls = []

    def store(self, text, **kw):
        self.calls.append((threading.get_ident(), text, kw["metadata"]["role"]))


@pytest.fixture
def stores(tmp_path, monkeypatch):
    monkeypatch.setenv("AIUI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(server, "_datastore", MemoryDataStore())
    provider = _Provider()
    mem = _Memory()
    monkeypatch.setattr(server, "get_provider", lambda: provider)
    monkeypatch.setattr(knowledge, "get_knowledge_manager", lambda: _Knowledge())
    monkeypatch.setattr(memory, "get_memory_manager", lambda: mem)
    return provider, mem


def test_knowledge_and_memory_run_in_a_worker_thread(stores):
    provider, mem = stores
    app = Starlette(routes=[Route("/run", server.run_agent, methods=["POST"])])
    with TestClient(app) as client:
        resp = client.post("/run", json={"message": "what is aiui?", "session_id": "s1"})
    assert resp.status_code == 200
    frames = [json.loads(line[5:]) for line in resp.text.splitlines() if line.startswith("data:")]
    assert "run_completed" in [f["type"] for f in frames]

    # Same results as before: the context reached the agent, the turn was stored.
    assert provider.message.startswith("[Knowledge Context]\naiui is a UI for agents\n")
    assert [(text, role) for _, text, role in mem.calls] == [
        ("what is aiui?", "user"),
        ("answer", "assistant"),
    ]
    # ... but not on the event loop's thread.
    assert _Knowledge.thread is not None and _Knowledge.thread != provider.thread
    assert all(tid != provider.thread for tid, _, _ in mem.calls)
