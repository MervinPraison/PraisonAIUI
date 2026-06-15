"""Tests for kanban feature and backend injection."""

from __future__ import annotations

from starlette.testclient import TestClient

from praisonaiui.backends import clear_backends, set_backend
from praisonaiui.features.kanban import get_kanban_store, reset_kanban_store
from praisonaiui.server import create_app, reset_state


def _client() -> TestClient:
    reset_state()
    reset_kanban_store()
    return TestClient(create_app())


def test_kanban_board_empty():
    clear_backends()
    client = _client()
    resp = client.get("/api/kanban/board")
    assert resp.status_code == 200
    data = resp.json()
    assert "columns" in data
    assert len(data["columns"]) >= 7
    clear_backends()


def test_kanban_create_move_delete():
    clear_backends()
    client = _client()

    create = client.post("/api/kanban/tasks", json={"title": "Ship board", "status": "todo"})
    assert create.status_code == 201
    task_id = create.json()["id"]

    move = client.post(f"/api/kanban/tasks/{task_id}/move", json={"status": "ready"})
    assert move.status_code == 200
    assert move.json()["status"] == "ready"

    board = client.get("/api/kanban/board").json()
    ready_cards = next(c for c in board["columns"] if c["id"] == "ready")["cards"]
    assert any(c.get("id") == task_id for c in ready_cards)

    delete = client.delete(f"/api/kanban/tasks/{task_id}")
    assert delete.status_code == 200
    clear_backends()


def test_kanban_bulk_update():
    clear_backends()
    client = _client()
    ids = []
    for title in ("A", "B"):
        r = client.post("/api/kanban/tasks", json={"title": title, "status": "todo"})
        ids.append(r.json()["id"])

    bulk = client.post("/api/kanban/tasks/bulk", json={"task_ids": ids, "status": "done"})
    assert bulk.status_code == 200
    assert bulk.json()["updated"] == 2
    clear_backends()


def test_kanban_uses_injected_store():
    clear_backends()
    reset_kanban_store()

    class _Store:
        def get_board(self, **kwargs):
            return {"board": "default", "columns": [{"id": "todo", "title": "Todo", "cards": []}], "tasks_total": 0}

        def get_task(self, task_id):
            return None

        def create_task(self, data):
            return {"id": "inj-1", **data}

        def update_task(self, task_id, data):
            return None

        def move_task(self, task_id, status):
            return None

        def bulk_update(self, task_ids, status):
            return {"updated": 0}

        def delete_task(self, task_id):
            return False

        def list_events(self, since=0.0, board="default"):
            return []

        def health(self):
            return {"status": "ok", "provider": "InjectedTest"}

    set_backend("kanban_store", lambda: _Store())
    store = get_kanban_store()
    assert store.health()["provider"] == "InjectedTest"

    client = _client()
    resp = client.get("/api/kanban/board")
    assert resp.status_code == 200
    assert resp.json()["tasks_total"] == 0
    clear_backends()
    reset_kanban_store()


def test_jobs_board_endpoint():
    clear_backends()
    client = _client()
    resp = client.get("/api/jobs/board")
    assert resp.status_code == 200
    data = resp.json()
    assert data["board"] == "jobs"
    assert any(c["id"] == "queued" for c in data["columns"])
    clear_backends()
