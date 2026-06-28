"""Tests for kanban feature and backend injection."""

from __future__ import annotations

from starlette.testclient import TestClient

from praisonaiui.backends import clear_backends, set_backend
from praisonaiui.features.kanban import (
    _child_progress,
    _task_card,
    get_kanban_store,
    reset_kanban_store,
)
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

        def add_comment(self, task_id, comment):
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


def test_task_card_enriched_dto():
    card = _task_card(
        {
            "id": "t1",
            "title": "Refactor auth",
            "status": "running",
            "assignee": "coder",
            "priority": "P2",
            "tenant": "acme",
            "created_at": "2024-01-01T00:00:00+00:00",
            "comments": [{"text": "a"}, {"text": "b"}],
        }
    )
    assert card["tenant"] == "acme"
    assert card["created_at"] == "2024-01-01T00:00:00+00:00"
    assert card["comment_count"] == 2
    assert card["progress"] is None


def test_child_progress_from_children_and_meta():
    children = {"children": [{"status": "done"}, {"status": "ready"}, {"status": "done"}]}
    assert _child_progress(children) == {"done": 2, "total": 3}

    explicit = {"meta": {"progress": {"done": 1, "total": 4}}}
    assert _child_progress(explicit) == {"done": 1, "total": 4}

    assert _child_progress({}) is None
    assert _child_progress({"meta": {"progress": {"done": 0, "total": 0}}}) is None


def test_card_in_board_carries_progress_and_counts():
    clear_backends()
    client = _client()
    store = get_kanban_store()
    store.create_task(
        {
            "id": "px",
            "title": "Parent",
            "status": "todo",
            "tenant": "acme",
            "children": [{"status": "done"}, {"status": "todo"}],
        }
    )
    board = client.get("/api/kanban/board").json()
    todo_cards = next(c for c in board["columns"] if c["id"] == "todo")["cards"]
    card = next(c for c in todo_cards if c["id"] == "px")
    assert card["tenant"] == "acme"
    assert card["progress"] == {"done": 1, "total": 2}
    assert card["comment_count"] == 0
    clear_backends()


def test_kanban_add_comment():
    clear_backends()
    client = _client()
    create = client.post("/api/kanban/tasks", json={"title": "Has comments", "status": "todo"})
    task_id = create.json()["id"]

    resp = client.post(f"/api/kanban/tasks/{task_id}/comments", json={"text": "please unblock"})
    assert resp.status_code == 200
    task = resp.json()
    assert len(task["comments"]) == 1
    assert task["comments"][0]["text"] == "please unblock"
    assert task["comments"][0]["author"] == "human"

    board = client.get("/api/kanban/board").json()
    todo_cards = next(c for c in board["columns"] if c["id"] == "todo")["cards"]
    card = next(c for c in todo_cards if c["id"] == task_id)
    assert card["comment_count"] == 1
    clear_backends()


def test_kanban_add_comment_validation():
    clear_backends()
    client = _client()
    create = client.post("/api/kanban/tasks", json={"title": "T", "status": "todo"})
    task_id = create.json()["id"]

    empty = client.post(f"/api/kanban/tasks/{task_id}/comments", json={"text": "   "})
    assert empty.status_code == 400

    missing = client.post("/api/kanban/tasks/nope/comments", json={"text": "hi"})
    assert missing.status_code == 404
    clear_backends()


def test_jobs_board_endpoint():
    clear_backends()
    client = _client()
    resp = client.get("/api/jobs/board")
    assert resp.status_code == 200
    data = resp.json()
    assert data["board"] == "jobs"
    assert any(c["id"] == "queued" for c in data["columns"])
    clear_backends()
