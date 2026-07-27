"""Unit tests for knowledge embedding fallback + degraded-mode reporting."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from starlette.testclient import TestClient

from praisonaiui.features import _features, register_feature
from praisonaiui.features import knowledge as knowledge_mod
from praisonaiui.features.knowledge import (
    KnowledgeFeature,
    SDKKnowledgeManager,
    SimpleKnowledgeManager,
    _is_embedding_unavailable,
)
from praisonaiui.features.openai_api import (
    OpenAIAPIFeature,
    _default_embedding_model,
    _embedding_fallback_models,
    _is_model_not_found,
)
from praisonaiui.server import create_app


class _FakeSDK:
    def __init__(self, search_error: BaseException | None = None) -> None:
        self._search_error = search_error

    def search(self, query, limit=1, user_id=None):
        if query == "__probe__":
            return []
        if self._search_error is not None:
            raise self._search_error
        return []


def test_is_model_not_found_detects_403():
    assert _is_model_not_found(Exception("Project does not have access to model x"))
    assert _is_model_not_found(Exception("litellm.NotFoundError: nope"))
    assert not _is_model_not_found(Exception("timeout"))


def test_is_embedding_unavailable_detects_403():
    assert _is_embedding_unavailable(Exception("model_not_found"))
    assert not _is_embedding_unavailable(Exception("connection reset"))


def test_default_embedding_model_env(monkeypatch):
    monkeypatch.delenv("AIUI_EMBEDDING_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_EMBEDDING_MODEL", raising=False)
    assert _default_embedding_model() == "text-embedding-3-small"
    monkeypatch.setenv("AIUI_EMBEDDING_MODEL", "text-embedding-ada-002")
    assert _default_embedding_model() == "text-embedding-ada-002"


def test_fallback_models_env(monkeypatch):
    monkeypatch.setenv("AIUI_EMBEDDING_FALLBACK_MODELS", "a, b ,,c")
    assert _embedding_fallback_models() == ["a", "b", "c"]


def test_simple_manager_reports_local_mode():
    mgr = SimpleKnowledgeManager()
    mgr.store("hello world")
    mgr.search("hello")
    assert mgr.last_search_meta()["mode"] == "local"
    assert mgr.health()["embedding"]["available"] is False


def test_sdk_search_reports_fallback_on_embedding_error():
    mgr = SDKKnowledgeManager()
    err = Exception("Project does not have access to model text-embedding-3-small")
    mgr._sdk_knowledge = _FakeSDK(search_error=err)
    mgr._sdk_probed = True

    mgr.store("PraisonAIUI is a YAML-driven UI generator.")
    mgr.search("documentation generator")

    meta = mgr.last_search_meta()
    assert meta["mode"] == "fallback"
    assert "text-embedding" in meta["error"].lower()

    health = mgr.health()
    assert health["embedding"]["available"] is False
    assert health["status"] == "degraded"
    assert health["warnings"]


def test_sdk_search_vector_mode_when_healthy():
    class _OkSDK:
        def search(self, query, limit=1, user_id=None):
            if query == "__probe__":
                return []
            return [{"id": "1", "memory": "hit", "score": 0.9}]

    mgr = SDKKnowledgeManager()
    mgr._sdk_knowledge = _OkSDK()
    mgr._sdk_probed = True
    results = mgr.search("anything")
    assert results
    assert mgr.last_search_meta()["mode"] == "vector"


def test_probe_flags_embedding_unavailable():
    mgr = SDKKnowledgeManager()

    class _Kn:
        def search(self, query, limit=1):
            raise Exception("model_not_found: no access")

    with patch("praisonaiagents.knowledge.Knowledge", return_value=_Kn(), create=True):
        mgr._get_sdk_knowledge()
    assert mgr._embedding_unavailable is True


@pytest.fixture
def client():
    saved = dict(_features)
    saved_mgr = knowledge_mod._knowledge_manager
    _features.clear()
    register_feature(KnowledgeFeature())
    register_feature(OpenAIAPIFeature())
    yield TestClient(create_app())
    _features.clear()
    _features.update(saved)
    knowledge_mod._knowledge_manager = saved_mgr


def test_knowledge_search_reports_fallback(client):
    mgr = SDKKnowledgeManager()
    err = Exception("Project does not have access to model text-embedding-3-small")
    mgr._sdk_knowledge = _FakeSDK(search_error=err)
    mgr._sdk_probed = True
    mgr.store("PraisonAIUI is a YAML-driven documentation site generator.")
    knowledge_mod._knowledge_manager = mgr

    r = client.post("/api/knowledge/search", json={"query": "documentation generator YAML"})
    assert r.status_code == 200
    body = r.json()
    assert body["search_mode"] == "fallback"
    assert body["warning"]
    assert "embedding" in body["warning"].lower()


def test_knowledge_status_reports_embedding(client):
    mgr = SDKKnowledgeManager()
    mgr._sdk_knowledge = _FakeSDK()
    mgr._sdk_probed = True
    mgr._embedding_unavailable = True
    mgr._embedding_error = "no access"
    knowledge_mod._knowledge_manager = mgr

    r = client.get("/api/knowledge/status")
    assert r.status_code == 200
    body = r.json()
    assert body["embedding"]["available"] is False
    assert body["warnings"]


def test_embeddings_endpoint_fallback_models(client):
    call_models: list[str] = []

    async def _aembed(input, model):
        call_models.append(model)
        if model == "text-embedding-3-small":
            raise Exception("Project does not have access to model text-embedding-3-small")
        return {"embedding": [0.1, 0.2], "usage": {"prompt_tokens": 1, "total_tokens": 1}}

    fake_caps = type("Caps", (), {"aembed": staticmethod(AsyncMock(side_effect=_aembed))})
    with patch(
        "praisonaiui.features.openai_api._get_capabilities", return_value=fake_caps
    ):
        r = client.post(
            "/v1/embeddings",
            json={"input": "test", "model": "text-embedding-3-small"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "text-embedding-ada-002"
    assert call_models[0] == "text-embedding-3-small"


def test_embeddings_endpoint_all_fail_returns_503(client):
    async def _aembed(input, model):
        raise Exception("model_not_found: no access to any embedding model")

    fake_caps = type("Caps", (), {"aembed": staticmethod(AsyncMock(side_effect=_aembed))})
    with patch(
        "praisonaiui.features.openai_api._get_capabilities", return_value=fake_caps
    ):
        r = client.post("/v1/embeddings", json={"input": "test"})
    assert r.status_code == 503
    assert r.json()["error"]["type"] == "model_not_found"
