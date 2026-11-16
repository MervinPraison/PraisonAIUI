"""Knowledge tells the truth when embeddings fail.

praisonaiagents' knowledge adapters do not raise when the embedding model is
not reachable: search() logs a warning and returns no hits, and store()
returns ``AddResult(success=False)``. Before this fix the manager read that
as success: /api/knowledge/status said ``ok`` with semantic search, an added
entry was marked synced while it lived only in memory (gone on restart), and
search fell back to keyword matching while reporting ``vector``.

The fakes below behave like the SDK; no test makes an API call.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field

import pytest
from starlette.testclient import TestClient

from praisonaiui.features import _features, register_feature
from praisonaiui.features import knowledge as knowledge_mod
from praisonaiui.features.knowledge import KnowledgeFeature, SDKKnowledgeManager
from praisonaiui.server import create_app

DENIED = "litellm.NotFoundError: Project `p` does not have access to model `text-embedding-3-small`"


@dataclass
class _AddResult:  # praisonaiagents.knowledge.models.AddResult
    success: bool = True
    message: str = ""


@dataclass
class _SearchResult:  # praisonaiagents.knowledge.models.SearchResult
    results: list = field(default_factory=list)


class _SwallowingKnowledge:
    """Like praisonaiagents.knowledge.Knowledge over the Chroma adapter."""

    def __init__(self, *a, embeddings_ok: bool = False, **k):
        self.embeddings_ok = embeddings_ok

    def search(self, query, limit=10, user_id=None):
        return _SearchResult()

    def get_all(self, user_id=None):
        return _SearchResult()

    def store(self, text, user_id=None, agent_id=None, metadata=None):
        if self.embeddings_ok:
            return _AddResult(success=True)
        return _AddResult(success=False, message=f"Failed to generate embedding (model=text-embedding-3-small): {DENIED}")


@pytest.fixture
def sdk(monkeypatch):
    """Stub the SDK modules: Knowledge swallows failures, embedding() raises 403."""
    kn = types.ModuleType("praisonaiagents.knowledge")
    kn.Knowledge = _SwallowingKnowledge
    calls = []

    def embedding(text, model=None, **kwargs):
        calls.append(model)
        raise Exception(DENIED)

    emb = types.ModuleType("praisonaiagents.embedding")
    emb.embedding = embedding
    monkeypatch.setitem(sys.modules, "praisonaiagents.knowledge", kn)
    monkeypatch.setitem(sys.modules, "praisonaiagents.embedding", emb)
    monkeypatch.delenv("OPENAI_EMBEDDING_MODEL", raising=False)
    return calls


@pytest.fixture
def client(sdk):
    saved, saved_mgr = dict(_features), knowledge_mod._knowledge_manager
    _features.clear()
    register_feature(KnowledgeFeature())
    knowledge_mod._knowledge_manager = SDKKnowledgeManager()
    yield TestClient(create_app())
    _features.clear()
    _features.update(saved)
    knowledge_mod._knowledge_manager = saved_mgr


def test_status_reports_degraded_with_a_plain_reason(client, sdk):
    body = client.get("/api/knowledge/status").json()
    assert sdk == ["text-embedding-3-small"], "the init probe embeds once, with the adapters' model"
    assert body["status"] == "degraded"
    assert body["embedding"]["available"] is False
    (warning,) = body["warnings"]
    assert warning.startswith("Embeddings unavailable: text-embedding-3-small is not accessible")
    assert "keyword search" in warning and "won't persist" in warning


def test_add_surfaces_the_failed_write(client):
    entry = client.post("/api/knowledge", json={"text": "Refunds within 30 days."}).json()
    assert entry["persisted"] is False and entry["sdk_synced"] is False
    assert "won't persist" in entry["warning"]


def test_search_says_it_fell_back(client):
    client.post("/api/knowledge", json={"text": "Refunds within 30 days."})
    body = client.post("/api/knowledge/search", json={"query": "refunds"}).json()
    assert body["count"] == 1
    assert body["search_mode"] == "fallback"
    assert body["warning"].startswith("Embeddings unavailable")


def test_a_failed_write_is_caught_even_when_the_probe_passed():
    mgr = SDKKnowledgeManager()
    mgr._sdk_knowledge, mgr._sdk_probed = _SwallowingKnowledge(), True
    entry = mgr.store("Support hours are 9 to 6.")
    assert entry["persisted"] is False
    assert mgr.health()["status"] == "degraded"


def test_a_working_write_persists_and_clears_the_flag():
    mgr = SDKKnowledgeManager()
    mgr._sdk_knowledge, mgr._sdk_probed = _SwallowingKnowledge(embeddings_ok=True), True
    mgr._embedding_unavailable, mgr._embedding_error = True, DENIED
    entry = mgr.store("Support hours are 9 to 6.")
    assert entry["persisted"] is True and "warning" not in entry
    assert mgr.health()["status"] == "ok"


def test_file_ingest_is_refused_while_embeddings_are_down():
    mgr = SDKKnowledgeManager()
    mgr._sdk_knowledge, mgr._sdk_probed = _SwallowingKnowledge(), True
    mgr._embedding_unavailable, mgr._embedding_error = True, DENIED
    result = mgr.add_file("/tmp/notes.pdf")
    assert result["status"] == "error" and result["error"].startswith("Embeddings unavailable")


def test_a_configured_embedder_is_not_probed_with_openai(sdk):
    mgr = SDKKnowledgeManager(embedder={"provider": "ollama", "config": {"model": "nomic"}})
    mgr._get_sdk_knowledge()
    assert sdk == [], "the caller's embedder is used by the adapters, not OPENAI_EMBEDDING_MODEL"
    assert mgr.health()["status"] == "ok"
