"""Kanban feature — protocol-driven task board for PraisonAIUI.

Architecture:
    KanbanStoreProtocol (ABC)     <- any backend implements this
      ├── SimpleKanbanStore       <- default in-memory (no deps)
      └── InjectedKanbanStore     <- wrapper-injected via backends.py

    KanbanFeature (BaseFeatureProtocol)
      └── REST + SSE for board UI and dashboard plugins
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from abc import ABC, abstractmethod
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Set

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

BOARD_COLUMNS = [
    {"id": "triage", "title": "Triage"},
    {"id": "todo", "title": "Todo"},
    {"id": "ready", "title": "Ready"},
    {"id": "running", "title": "Running"},
    {"id": "blocked", "title": "Blocked"},
    {"id": "review", "title": "Review"},
    {"id": "done", "title": "Done"},
]

VALID_STATUSES: Set[str] = {c["id"] for c in BOARD_COLUMNS} | {"archived"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _child_progress(task: Dict[str, Any]) -> Optional[Dict[str, int]]:
    """Derive done/total subtask progress from task.children or meta.

    Accepts either a list of child dicts under "children" (each with a status)
    or an explicit {"done": int, "total": int} under meta["progress"].
    Returns None when there is nothing to report.
    """
    meta = task.get("meta") or {}
    explicit = meta.get("progress")
    if isinstance(explicit, dict):
        total = explicit.get("total")
        done = explicit.get("done")
        if isinstance(total, int) and total > 0 and isinstance(done, int):
            return {"done": max(0, min(done, total)), "total": total}
    children = task.get("children")
    if isinstance(children, list) and children:
        total = len(children)
        done = sum(1 for c in children if isinstance(c, dict) and c.get("status") == "done")
        return {"done": done, "total": total}
    return None


def _task_card(task: Dict[str, Any]) -> Dict[str, Any]:
    """Normalise task dict to board card component."""
    title = (task.get("title") or task.get("id") or "Task")[:120]
    footer_parts = [p for p in (task.get("assignee"), task.get("priority")) if p]
    comments = task.get("comments") or []
    return {
        "id": task.get("id"),
        "title": title,
        "footer": " · ".join(str(p) for p in footer_parts) if footer_parts else task.get("status", ""),
        "status": task.get("status"),
        "assignee": task.get("assignee"),
        "priority": task.get("priority"),
        "tenant": task.get("tenant"),
        "created_at": task.get("created_at"),
        "comment_count": len(comments),
        "progress": _child_progress(task),
        "body": task.get("body"),
        "comments": comments,
        "meta": task.get("meta") or {},
    }


# ── Store protocol ───────────────────────────────────────────────────


class KanbanStoreProtocol(ABC):
    """Protocol interface for kanban task storage."""

    @abstractmethod
    def get_board(
        self,
        *,
        board: str = "default",
        tenant: Optional[str] = None,
        include_archived: bool = False,
    ) -> Dict[str, Any]: ...

    @abstractmethod
    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def create_task(self, data: Dict[str, Any]) -> Dict[str, Any]: ...

    @abstractmethod
    def update_task(self, task_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def move_task(self, task_id: str, status: str) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def add_comment(self, task_id: str, comment: Dict[str, Any]) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def bulk_update(self, task_ids: List[str], status: str) -> Dict[str, Any]: ...

    @abstractmethod
    def delete_task(self, task_id: str) -> bool: ...

    @abstractmethod
    def list_events(self, since: float = 0.0, board: str = "default") -> List[Dict[str, Any]]: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


class SimpleKanbanStore(KanbanStoreProtocol):
    """In-memory kanban store — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._tasks: Dict[str, Dict[str, Any]] = {}
        self._events: Deque[Dict[str, Any]] = deque(maxlen=500)
        self._boards: Set[str] = {"default"}

    def _emit(self, event_type: str, task: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> None:
        self._events.append(
            {
                "type": event_type,
                "task_id": task.get("id"),
                "status": task.get("status"),
                "board": task.get("board", "default"),
                "ts": time.time(),
                **(extra or {}),
            }
        )

    def get_board(
        self,
        *,
        board: str = "default",
        tenant: Optional[str] = None,
        include_archived: bool = False,
    ) -> Dict[str, Any]:
        self._boards.add(board)
        tasks = [
            t
            for t in self._tasks.values()
            if t.get("board", "default") == board
            and (include_archived or t.get("status") != "archived")
            and (not tenant or t.get("tenant") == tenant)
        ]
        by_status: Dict[str, List[Dict[str, Any]]] = {c["id"]: [] for c in BOARD_COLUMNS}
        for task in tasks:
            status = task.get("status", "todo")
            if status not in by_status and status != "archived":
                by_status.setdefault(status, [])
            if status in by_status:
                by_status[status].append(_task_card(task))
        columns = []
        for col in BOARD_COLUMNS:
            cards = by_status.get(col["id"], [])
            columns.append({"id": col["id"], "title": col["title"], "cards": cards})
        return {
            "board": board,
            "columns": columns,
            "tasks_total": len(tasks),
            "provider": "SimpleKanbanStore",
        }

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        task = self._tasks.get(task_id)
        return dict(task) if task else None

    def create_task(self, data: Dict[str, Any]) -> Dict[str, Any]:
        task_id = data.get("id") or f"task_{uuid.uuid4().hex[:10]}"
        status = data.get("status", "todo")
        if status not in VALID_STATUSES:
            status = "todo"
        task = {
            "id": task_id,
            "title": data.get("title") or "Untitled",
            "body": data.get("body") or "",
            "status": status,
            "assignee": data.get("assignee"),
            "priority": data.get("priority"),
            "tenant": data.get("tenant"),
            "board": data.get("board", "default"),
            "children": data.get("children") or [],
            "comments": [],
            "meta": data.get("meta") or {},
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        self._tasks[task_id] = task
        self._boards.add(task["board"])
        self._emit("task_created", task)
        return dict(task)

    def update_task(self, task_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        task = self._tasks.get(task_id)
        if not task:
            return None
        for key in ("title", "body", "assignee", "priority", "tenant", "meta", "children"):
            if key in data:
                task[key] = data[key]
        if "status" in data and data["status"] in VALID_STATUSES:
            task["status"] = data["status"]
        task["updated_at"] = _now_iso()
        self._emit("task_updated", task)
        return dict(task)

    def move_task(self, task_id: str, status: str) -> Optional[Dict[str, Any]]:
        if status not in VALID_STATUSES:
            return None
        task = self._tasks.get(task_id)
        if not task:
            return None
        old = task.get("status")
        task["status"] = status
        task["updated_at"] = _now_iso()
        self._emit("task_moved", task, {"from_status": old, "to_status": status})
        return dict(task)

    def add_comment(self, task_id: str, comment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        task = self._tasks.get(task_id)
        if not task:
            return None
        text = str((comment or {}).get("text") or "").strip()
        if not text:
            return None
        entry = {
            "id": f"c_{uuid.uuid4().hex[:8]}",
            "author": (comment or {}).get("author") or "human",
            "text": text,
            "created_at": _now_iso(),
        }
        task.setdefault("comments", []).append(entry)
        task["updated_at"] = _now_iso()
        self._emit("task_commented", task, {"comment_id": entry["id"]})
        return dict(task)

    def bulk_update(self, task_ids: List[str], status: str) -> Dict[str, Any]:
        if status not in VALID_STATUSES:
            return {"updated": 0, "errors": ["invalid status"]}
        updated = 0
        for tid in task_ids:
            if self.move_task(tid, status):
                updated += 1
        return {"updated": updated, "status": status}

    def delete_task(self, task_id: str) -> bool:
        task = self._tasks.pop(task_id, None)
        if task:
            self._emit("task_deleted", task)
            return True
        return False

    def list_events(self, since: float = 0.0, board: str = "default") -> List[Dict[str, Any]]:
        return [e for e in list(self._events) if e.get("ts", 0) >= since and e.get("board", "default") == board]

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleKanbanStore",
            "tasks": len(self._tasks),
            "boards": sorted(self._boards),
        }


class InjectedKanbanStore(KanbanStoreProtocol):
    """Delegates to wrapper-injected kanban store factory."""

    def __init__(self, impl: Any) -> None:
        self._impl = impl

    def _call(self, name: str, *args: Any, **kwargs: Any) -> Any:
        fn = getattr(self._impl, name, None)
        if not callable(fn):
            raise RuntimeError(f"Injected kanban store missing {name}")
        return fn(*args, **kwargs)

    def get_board(self, **kwargs: Any) -> Dict[str, Any]:
        return self._call("get_board", **kwargs)

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        return self._call("get_task", task_id)

    def create_task(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("create_task", data)

    def update_task(self, task_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._call("update_task", task_id, data)

    def move_task(self, task_id: str, status: str) -> Optional[Dict[str, Any]]:
        return self._call("move_task", task_id, status)

    def add_comment(self, task_id: str, comment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._call("add_comment", task_id, comment)

    def bulk_update(self, task_ids: List[str], status: str) -> Dict[str, Any]:
        return self._call("bulk_update", task_ids, status)

    def delete_task(self, task_id: str) -> bool:
        return self._call("delete_task", task_id)

    def list_events(self, since: float = 0.0, board: str = "default") -> List[Dict[str, Any]]:
        return self._call("list_events", since, board)

    def health(self) -> Dict[str, Any]:
        if hasattr(self._impl, "health") and callable(self._impl.health):
            return self._impl.health()
        return {"status": "ok", "provider": "InjectedKanbanStore"}


_kanban_store: Optional[KanbanStoreProtocol] = None


def get_kanban_store() -> KanbanStoreProtocol:
    """Active kanban store — injected backend first, else SimpleKanbanStore."""
    global _kanban_store
    if _kanban_store is not None:
        return _kanban_store
    from praisonaiui.backends import get_kanban_store_factory

    factory = get_kanban_store_factory()
    if factory is not None:
        try:
            impl = factory()
            _kanban_store = InjectedKanbanStore(impl)
            logger.info("Using InjectedKanbanStore")
            return _kanban_store
        except Exception as exc:
            logger.warning("Injected kanban store failed (%s), using SimpleKanbanStore", exc)
    _kanban_store = SimpleKanbanStore()
    return _kanban_store


def reset_kanban_store() -> None:
    """Reset store singleton (tests)."""
    global _kanban_store
    _kanban_store = None


class KanbanFeature(BaseFeatureProtocol):
    """Kanban task board — columns, drag-drop API, SSE events."""

    feature_name = "kanban"
    feature_description = "Multi-agent kanban task board"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/kanban/board", self._board, methods=["GET"]),
            Route("/api/kanban/tasks", self._create, methods=["POST"]),
            Route("/api/kanban/tasks/bulk", self._bulk, methods=["POST"]),
            Route("/api/kanban/tasks/{task_id}", self._get, methods=["GET"]),
            Route("/api/kanban/tasks/{task_id}", self._patch, methods=["PATCH"]),
            Route("/api/kanban/tasks/{task_id}", self._delete, methods=["DELETE"]),
            Route("/api/kanban/tasks/{task_id}/move", self._move, methods=["POST"]),
            Route("/api/kanban/tasks/{task_id}/comments", self._add_comment, methods=["POST"]),
            Route("/api/kanban/events", self._events, methods=["GET"]),
            Route("/api/kanban/health", self._health, methods=["GET"]),
            Route("/api/kanban/boards", self._boards, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        store = get_kanban_store()
        return {"status": "ok", "feature": self.name, **store.health()}

    async def _board(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        board = request.query_params.get("board", "default")
        tenant = request.query_params.get("tenant")
        archived = request.query_params.get("archived", "").lower() in ("1", "true", "yes")
        data = store.get_board(board=board, tenant=tenant, include_archived=archived)
        return JSONResponse(data)

    async def _get(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        task = store.get_task(request.path_params["task_id"])
        if not task:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(task)

    async def _create(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        body = await request.json()
        task = store.create_task(body if isinstance(body, dict) else {})
        return JSONResponse(task, status_code=201)

    async def _patch(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        body = await request.json()
        task = store.update_task(request.path_params["task_id"], body if isinstance(body, dict) else {})
        if not task:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(task)

    async def _move(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        body = await request.json()
        status = (body or {}).get("status")
        if not status:
            return JSONResponse({"error": "status required"}, status_code=400)
        task = store.move_task(request.path_params["task_id"], status)
        if not task:
            return JSONResponse({"error": "not found or invalid status"}, status_code=404)
        return JSONResponse(task)

    async def _add_comment(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        body = await request.json()
        if not isinstance(body, dict) or not str(body.get("text") or "").strip():
            return JSONResponse({"error": "text required"}, status_code=400)
        task = store.add_comment(request.path_params["task_id"], body)
        if not task:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(task)

    async def _bulk(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        body = await request.json()
        task_ids = (body or {}).get("task_ids") or []
        status = (body or {}).get("status")
        if not isinstance(task_ids, list) or not status:
            return JSONResponse({"error": "task_ids and status required"}, status_code=400)
        return JSONResponse(store.bulk_update(task_ids, status))

    async def _delete(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        ok = store.delete_task(request.path_params["task_id"])
        if not ok:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse({"deleted": True})

    async def _boards(self, request: Request) -> JSONResponse:
        store = get_kanban_store()
        h = store.health()
        boards = h.get("boards") or ["default"]
        return JSONResponse({"boards": [{"id": b, "title": b.title()} for b in boards]})

    async def _health(self, request: Request) -> JSONResponse:
        return JSONResponse(await self.health())

    async def _events(self, request: Request) -> StreamingResponse:
        """SSE stream of kanban task events (board live sync)."""
        board = request.query_params.get("board", "default")
        since = float(request.query_params.get("since") or 0)

        async def stream():
            store = get_kanban_store()
            cursor = since
            while True:
                events = store.list_events(since=cursor, board=board)
                for ev in events:
                    cursor = max(cursor, ev.get("ts", cursor))
                    yield f"data: {json.dumps(ev)}\n\n"
                yield ": keepalive\n\n"
                await asyncio.sleep(1.5)

        return StreamingResponse(stream(), media_type="text/event-stream")
