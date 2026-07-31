"""Tests for embedding-model fallback and degraded-mode reporting.

Covers issue #240: knowledge search degrades silently when the default
embedding model is unavailable (403 model_not_found).

Verifies:
- SDKKnowledgeManager marks embedding unavailable on model_not_found search failure
- last_search_meta() reports mode="fallback" with an actionable warning
- health() exposes embedding.available=false + warnings
- non-embedding SDK errors do NOT flag embedding as unavailable
- /v1/embeddings resolves env-configured default + fallback chain
"""

from __future__ import annotations

import pytest

from praisonaiui.features.knowledge import (
    SDKKnowledgeManager,
    SimpleKnowledgeManager,
    _is_embedding_error,
)


class _FakeSDK:
    """Minimal fake SDK Knowledge that raises a chosen error on search."""

    def __init__(self, error: Exception | None = None, probe_error: Exception | None = None):
        self._error = error
        self._probe_error = probe_error
        self._probe_pending = probe_error is not None

    def search(self, query, limit=10, user_id=None):
        if self._probe_pending:
            self._probe_pending = False
            raise self._probe_error
        if self._error is not None:
            raise self._error
        return []


def _manager_with_sdk(sdk) -> SDKKnowledgeManager:
    """Wire a fake SDK as an already-probed working backend."""
    mgr = SDKKnowledgeManager()
    mgr._sdk_knowledge = sdk
    mgr._sdk_probed = True
    return mgr


# ── error detection ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "msg",
    [
        "Project does not have access to model `text-embedding-3-small`",
        "The model does not exist or you do not have access to it",
        "litellm.NotFoundError: model_not_found",
    ],
)
def test_is_embedding_error_true(msg):
    assert _is_embedding_error(msg) is True


@pytest.mark.parametrize("msg", ["empty db", "connection refused", "timeout"])
def test_is_embedding_error_false(msg):
    assert _is_embedding_error(msg) is False


# ── degraded-mode reporting ──────────────────────────────────────────


def test_search_reports_fallback_on_embedding_error():
    err = Exception("Project does not have access to model `text-embedding-3-small`")
    mgr = _manager_with_sdk(_FakeSDK(error=err))
    mgr.store("PraisonAIUI is a YAML documentation generator")

    results = mgr.search("PraisonAIUI")

    meta = mgr.last_search_meta()
    assert meta["mode"] == "fallback"
    assert meta["error"]
    assert "AIUI_EMBEDDING_MODEL" in meta["error"]
    assert results


def test_health_reports_embedding_unavailable():
    err = Exception("model_not_found: text-embedding-3-small")
    mgr = _manager_with_sdk(_FakeSDK(error=err))
    mgr.search("anything")

    h = mgr.health()
    assert h["embedding"]["available"] is False
    assert h["status"] == "degraded"
    assert h["warnings"]


def test_non_embedding_error_does_not_flag_embedding():
    err = Exception("some transient database hiccup")
    mgr = _manager_with_sdk(_FakeSDK(error=err))
    mgr.search("anything")

    h = mgr.health()
    assert h["embedding"]["available"] is True
    assert mgr.last_search_meta()["error"] is None


def test_vector_mode_reported_on_success():
    class _OkSDK:
        def search(self, query, limit=10, user_id=None):
            return [{"id": "1", "memory": "hit", "score": 0.9}]

    mgr = _manager_with_sdk(_OkSDK())
    results = mgr.search("q")
    assert results
    assert mgr.last_search_meta()["mode"] == "vector"


def test_probe_flags_embedding_unavailable(monkeypatch):
    probe_err = Exception("Project does not have access to model `text-embedding-3-small`")

    class _KnowledgeStub:
        def __init__(self, *a, **k):
            self._raised = False

        def search(self, *a, **k):
            if not self._raised:
                self._raised = True
                raise probe_err
            return []

    import sys
    import types

    mod = types.ModuleType("praisonaiagents.knowledge")
    mod.Knowledge = _KnowledgeStub
    monkeypatch.setitem(sys.modules, "praisonaiagents.knowledge", mod)

    mgr = SDKKnowledgeManager()
    mgr._get_sdk_knowledge()
    assert mgr._embedding_unavailable is True
    assert mgr._sdk_knowledge is not None  # SDK stays active, embeddings flagged


def test_simple_manager_default_meta():
    mgr = SimpleKnowledgeManager()
    assert mgr.last_search_meta()["mode"] == "local"


# ── embedding-model resolution ───────────────────────────────────────


def test_default_embedding_model_env(monkeypatch):
    from praisonaiui.features.openai_api import _default_embedding_model

    monkeypatch.delenv("OPENAI_EMBEDDING_MODEL", raising=False)
    monkeypatch.setenv("AIUI_EMBEDDING_MODEL", "text-embedding-ada-002")
    assert _default_embedding_model() == "text-embedding-ada-002"


def test_default_embedding_model_fallback_default(monkeypatch):
    from praisonaiui.features.openai_api import _default_embedding_model

    monkeypatch.delenv("AIUI_EMBEDDING_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_EMBEDDING_MODEL", raising=False)
    assert _default_embedding_model() == "text-embedding-3-small"


def test_embedding_fallback_models_env(monkeypatch):
    from praisonaiui.features.openai_api import _embedding_fallback_models

    monkeypatch.setenv("AIUI_EMBEDDING_FALLBACK_MODELS", "a, b ,, c")
    assert _embedding_fallback_models() == ["a", "b", "c"]
