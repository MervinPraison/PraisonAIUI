"""Issue #331 — rename a session from the chat rail via the existing PATCH route."""

from __future__ import annotations

import asyncio
from pathlib import Path

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

import praisonaiui.server as server
from praisonaiui.datastore import MemoryDataStore

CHAT = Path("src/praisonaiui/templates/frontend/plugins/views/chat.js")


def _client(monkeypatch):
    ds = MemoryDataStore()
    monkeypatch.setattr(server, "_datastore", ds)
    app = Starlette(routes=[Route("/sessions/{session_id}", server.patch_session, methods=["PATCH"])])
    sid = asyncio.run(ds.create_session())["id"]
    return TestClient(app), ds, sid


def test_patch_renames_and_trims(monkeypatch):
    client, ds, sid = _client(monkeypatch)
    r = client.patch(f"/sessions/{sid}", json={"title": "  My chat  "})
    assert r.status_code == 200
    assert asyncio.run(ds.get_session(sid))["title"] == "My chat"


def test_patch_rejects_blank_or_non_string_title(monkeypatch):
    client, _, sid = _client(monkeypatch)
    assert client.patch(f"/sessions/{sid}", json={"title": "   "}).status_code == 400
    assert client.patch(f"/sessions/{sid}", json={"title": 123}).status_code == 400


def test_patch_unknown_session_404(monkeypatch):
    client, _, _ = _client(monkeypatch)
    assert client.patch("/sessions/nope", json={"title": "x"}).status_code == 404


def test_rail_has_rename_button_wired_to_patch():
    src = CHAT.read_text()
    assert "async function renameSession(sessionId, currentTitle)" in src
    assert "method: 'PATCH'" in src
    assert "renameSession(id, title)" in src
    assert "e.stopPropagation()" in src
