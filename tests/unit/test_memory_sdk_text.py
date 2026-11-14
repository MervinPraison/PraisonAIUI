"""SDK memory records keep their text under ``content``; the memory API must
show that text, not the record's dict repr."""

from __future__ import annotations

from praisonaiui.features.memory import SDKMemoryManager


class _FakeSdkMemory:
    def __init__(self):
        self.rows = [
            {"type": "long_term", "id": "a1", "content": "Python is my favorite language",
             "metadata": {}, "created_at": 1.0},
            {"type": "short_term", "id": "b2", "content": "Echo: First",
             "metadata": {"role": "assistant"}, "created_at": 2.0},
        ]

    def get_all_memories(self):
        return list(self.rows)

    def search_long_term(self, query, limit=10):
        return [r for r in self.rows if r["type"] == "long_term"]

    def search_short_term(self, query, limit=10):
        return [r for r in self.rows if r["type"] == "short_term"]


def _manager():
    mgr = SDKMemoryManager()
    mgr._sdk_memory = _FakeSdkMemory()
    return mgr


def test_list_all_reads_sdk_content_key():
    items = _manager().list_all()
    assert [i["text"] for i in items] == ["Python is my favorite language", "Echo: First"]
    assert [i["memory_type"] for i in items] == ["long", "short"]


def test_get_reads_sdk_content_key():
    assert _manager().get("a1")["text"] == "Python is my favorite language"


def test_search_reads_sdk_content_key():
    mgr = _manager()
    assert [r["text"] for r in mgr.search("python", memory_type="long")] == [
        "Python is my favorite language"
    ]
    assert {r["text"] for r in mgr.search("x")} == {
        "Python is my favorite language",
        "Echo: First",
    }
