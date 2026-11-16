"""SDKKnowledgeManager reads what the vector store returns (issue #398).

praisonaiagents' Chroma adapter returns ``SearchResult`` objects (``.results``
of ``SearchResultItem`` with ``.id``/``.text``/``.metadata``/``.score``) and
``AddResult`` with the document ID it generated. The fake below mirrors that.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any, Dict, List

from praisonaiui.features.knowledge import SDKKnowledgeManager


@dataclass
class _Item:
    id: str
    text: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    score: float = 1.0


@dataclass
class _SearchResult:
    results: List[_Item] = field(default_factory=list)


@dataclass
class _AddResult:
    id: str = ""
    success: bool = True


class _ChromaLikeSDK:
    _ids = itertools.count(1000)

    def __init__(self) -> None:
        self.docs: Dict[str, _Item] = {}

    def store(self, text, user_id=None, agent_id=None, metadata=None):
        doc_id = str(next(self._ids))  # the adapter picks its own ID
        self.docs[doc_id] = _Item(doc_id, text, dict(metadata or {}))
        return _AddResult(id=doc_id)

    def search(self, query, limit=10, user_id=None):
        hits = [d for d in self.docs.values() if query.lower() in d.text.lower()]
        return _SearchResult(results=[_Item(h.id, h.text, h.metadata, 0.9) for h in hits][:limit])

    def get_all(self, user_id=None):
        return _SearchResult(results=list(self.docs.values()))

    def get(self, item_id):
        return self.docs.get(item_id)

    def delete(self, item_id):
        self.docs.pop(item_id, None)


def _manager(sdk) -> SDKKnowledgeManager:
    mgr = SDKKnowledgeManager()
    mgr._sdk_knowledge = sdk
    mgr._sdk_probed = True
    return mgr


def test_store_uses_vector_store_id():
    sdk = _ChromaLikeSDK()
    entry = _manager(sdk).store("hello world")
    assert entry["id"] in sdk.docs


def test_list_all_reads_store_and_does_not_duplicate():
    sdk = _ChromaLikeSDK()
    sdk.docs["old"] = _Item("old", "from an earlier run", {"source": "x"})
    mgr = _manager(sdk)
    entry = mgr.store("this session")

    listed = mgr.list_all()
    assert sorted(e["id"] for e in listed) == sorted(["old", entry["id"]])
    old = next(e for e in listed if e["id"] == "old")
    assert old["text"] == "from an earlier run"
    assert old["metadata"] == {"source": "x"}


def test_search_returns_vector_hits():
    sdk = _ChromaLikeSDK()
    sdk.docs["old"] = _Item("old", "persisted fact about cats")
    mgr = _manager(sdk)

    hits = mgr.search("cats")
    assert [(h["id"], h["text"], h["score"]) for h in hits] == [
        ("old", "persisted fact about cats", 0.9)
    ]
    assert mgr.last_search_meta()["mode"] == "vector"


def test_get_and_delete_address_both_copies():
    sdk = _ChromaLikeSDK()
    sdk.docs["old"] = _Item("old", "earlier")
    mgr = _manager(sdk)
    entry = mgr.store("now")

    assert mgr.get("old")["text"] == "earlier"
    assert mgr.delete(entry["id"]) is True
    assert entry["id"] not in sdk.docs
    assert mgr.get(entry["id"]) is None
    assert [e["id"] for e in mgr.list_all()] == ["old"]


def test_dict_results_still_supported():
    class _Mem0Like:
        def search(self, query, limit=10, user_id=None):
            return {"results": [{"id": "m1", "memory": "mem0 text", "score": 0.5}]}

        def get_all(self, user_id=None):
            return [{"id": "m1", "memory": "mem0 text"}]

    mgr = _manager(_Mem0Like())
    assert mgr.search("x")[0]["text"] == "mem0 text"
    assert mgr.list_all()[0]["id"] == "m1"
