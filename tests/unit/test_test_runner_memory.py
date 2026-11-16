"""``aiui test memory`` checks the memory store, not just LLM wording (#378)."""

import pytest
import typer

from praisonaiui import test_runner as tr


def _patch(monkeypatch, *, search_results, reply, search_ok=True):
    monkeypatch.setattr(tr, "_check_server", lambda s: True)
    monkeypatch.setattr(tr.time, "sleep", lambda s: None)

    def fake_post(server, path, body=None):
        if path == "/api/memory/search":
            if not search_ok:
                raise OSError("404")
            return {"results": search_results}
        return {}

    monkeypatch.setattr(tr, "_post", fake_post)
    monkeypatch.setattr(
        tr, "_wait_for_response", lambda s, sid, timeout=20: [{"role": "assistant", "content": reply}]
    )


def test_stored_but_not_recalled_is_skipped(monkeypatch):
    _patch(monkeypatch, search_results=[{"text": "User: Haskell"}], reply="I don't know.")
    tr.test_memory("http://x")  # no typer.Exit: recall skipped, store passed


def test_recalled_passes(monkeypatch):
    _patch(monkeypatch, search_results=[{"text": "Haskell"}], reply="It is Haskell.")
    tr.test_memory("http://x")


def test_not_stored_and_not_recalled_fails(monkeypatch):
    monkeypatch.setattr(tr, "_memory_contains", lambda s, t: False)
    _patch(monkeypatch, search_results=[], reply="I don't know.")
    with pytest.raises(typer.Exit):
        tr.test_memory("http://x")


def test_search_unavailable_still_requires_recall(monkeypatch):
    _patch(monkeypatch, search_results=[], reply="I don't know.", search_ok=False)
    with pytest.raises(typer.Exit):
        tr.test_memory("http://x")
