"""Notifications feature — modular, extendable in-app notification center.

Provides a single DRY store + REST & SSE protocol for the browser Notification
Center bell (`builtin.notifications` + `@aiui/sdk`'s `notifications` store):

- ``GET    /api/notifications``             — list notifications & unread count
- ``POST   /api/notifications``             — create/push a notification (supports ``dedupe_key``)
- ``POST   /api/notifications/{id}/read``   — mark one notification as read
- ``POST   /api/notifications/read-all``    — mark all notifications as read
- ``DELETE /api/notifications/{id}``        — dismiss/delete one notification
- ``DELETE /api/notifications``             — clear notifications (preserves pinned unless ``include_pinned=true``)
- ``GET    /api/notifications/stream``      — Server-Sent Events stream for real-time updates

Extendability:
- Apps and plugins can push notifications from anywhere in Python via
  :func:`push_notification` (or ``aiui.push_notification``).
- Custom storage backends (SQLite, Redis, Postgres, etc.) can implement
  :class:`NotificationStoreProtocol` and install themselves with
  :func:`set_notification_store`.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional, Protocol, Sequence, runtime_checkable
from urllib.parse import urlparse

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

VALID_TYPES = frozenset({"default", "info", "success", "warning", "error"})
DEFAULT_MAX_ITEMS = 200


def _is_safe_href(href: Any) -> bool:
    if not isinstance(href, str):
        return False
    val = href.strip()
    if not val:
        return False
    if val.startswith("/"):
        return not val.startswith("//")
    try:
        parsed = urlparse(val)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except ValueError:
        return False


def _sanitize_action(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    label = str(raw.get("label") or "").strip()[:80]
    if not label:
        return None
    out: Dict[str, Any] = {"label": label}
    page = raw.get("page")
    if isinstance(page, str) and page.strip():
        out["page"] = page.strip()[:120]
    params = raw.get("params")
    if isinstance(params, dict):
        clean_params: Dict[str, Any] = {}
        for k, v in params.items():
            if isinstance(k, str) and k:
                if isinstance(v, list):
                    clean_params[k] = [str(x) for x in v]
                elif v is not None:
                    clean_params[k] = str(v)
        if clean_params:
            out["params"] = clean_params
    href = raw.get("href")
    if _is_safe_href(href):
        out["href"] = str(href).strip()
    if "page" not in out and "href" not in out:
        return None
    return out


def _normalize_notification(data: Dict[str, Any], existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    title = str(data.get("title") or data.get("message") or (existing or {}).get("title") or "").strip()[:240]
    if not title:
        raise ValueError("Notification title is required")
    ntype = str(data.get("type") or (existing or {}).get("type") or "info").strip().lower()
    if ntype not in VALID_TYPES:
        ntype = "info"
    dedupe_key = data.get("dedupe_key") or data.get("dedupeKey") or (existing or {}).get("dedupe_key")
    dedupe_key = str(dedupe_key).strip()[:200] if dedupe_key else None
    nid = str(data.get("id") or (existing or {}).get("id") or f"ntf-{uuid.uuid4().hex[:12]}").strip()[:200]
    created_at = data.get("created_at") or data.get("createdAt")
    if isinstance(created_at, (int, float)) and created_at > 0:
        ts_ms = int(created_at * 1000) if created_at < 1e12 else int(created_at)
    else:
        ts_ms = int(time.time() * 1000)
    item: Dict[str, Any] = {
        "id": nid,
        "title": title,
        "type": ntype,
        "createdAt": ts_ms,
        "read": bool(data.get("read", False)),
    }
    desc = data.get("description")
    if isinstance(desc, str) and desc.strip():
        item["description"] = desc.strip()[:1000]
    category = data.get("category")
    if isinstance(category, str) and category.strip():
        item["category"] = category.strip()[:60]
    source = data.get("source")
    if isinstance(source, str) and source.strip():
        item["source"] = source.strip()[:60]
    else:
        item["source"] = "server"
    if data.get("pinned") or (existing or {}).get("pinned"):
        item["pinned"] = True
    if dedupe_key:
        item["dedupeKey"] = dedupe_key
    action = _sanitize_action(data.get("action"))
    if action:
        item["action"] = action
    meta = data.get("meta")
    if isinstance(meta, dict):
        item["meta"] = dict(meta)
    return item


@runtime_checkable
class NotificationStoreProtocol(Protocol):
    """Protocol for pluggable notification storage backends."""

    def push(self, data: Dict[str, Any]) -> Dict[str, Any]: ...
    def list(
        self,
        *,
        unread_only: bool = False,
        category: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]: ...
    def unread_count(self) -> int: ...
    def mark_read(self, notification_id: str) -> Optional[Dict[str, Any]]: ...
    def mark_all_read(self) -> int: ...
    def remove(self, notification_id: str) -> bool: ...
    def clear(self, *, include_pinned: bool = False, read_only: bool = False) -> int: ...


class InMemoryNotificationStore:
    """Thread-safe bounded ring-buffer notification store with dedupeKey upsert."""

    def __init__(self, max_items: int = DEFAULT_MAX_ITEMS) -> None:
        self._max_items = max(1, int(max_items))
        self._items: List[Dict[str, Any]] = []
        self._lock = threading.Lock()

    def _find_index(self, nid: Optional[str], dedupe_key: Optional[str]) -> int:
        if dedupe_key:
            for i, item in enumerate(self._items):
                if item.get("dedupeKey") == dedupe_key or item.get("id") == dedupe_key:
                    return i
        if nid:
            for i, item in enumerate(self._items):
                if item.get("id") == nid:
                    return i
        return -1

    def _trim(self) -> None:
        while len(self._items) > self._max_items:
            drop_idx = -1
            for i in range(len(self._items) - 1, -1, -1):
                if self._items[i].get("read") and not self._items[i].get("pinned"):
                    drop_idx = i
                    break
            if drop_idx == -1:
                for i in range(len(self._items) - 1, -1, -1):
                    if not self._items[i].get("pinned"):
                        drop_idx = i
                        break
            if drop_idx == -1:
                break
            self._items.pop(drop_idx)

    def push(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            dedupe_key = data.get("dedupe_key") or data.get("dedupeKey")
            dedupe_str = str(dedupe_key).strip()[:200] if dedupe_key else None
            nid = str(data.get("id")).strip()[:200] if data.get("id") else None
            idx = self._find_index(nid, dedupe_str)
            existing = self._items[idx] if idx != -1 else None
            item = _normalize_notification(data, existing=existing)
            if idx != -1:
                self._items[idx] = item
            else:
                self._items.insert(0, item)
            self._items.sort(key=lambda x: x.get("createdAt", 0), reverse=True)
            self._trim()
            return dict(item)

    def list(
        self,
        *,
        unread_only: bool = False,
        category: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        with self._lock:
            out = [
                dict(item)
                for item in self._items
                if (not unread_only or not item.get("read"))
                and (not category or item.get("category") == category)
            ]
            if limit is not None and limit > 0:
                out = out[:limit]
            return out

    def unread_count(self) -> int:
        with self._lock:
            return sum(1 for item in self._items if not item.get("read"))

    def mark_read(self, notification_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            for item in self._items:
                if item.get("id") == notification_id:
                    item["read"] = True
                    return dict(item)
            return None

    def mark_all_read(self) -> int:
        with self._lock:
            changed = 0
            for item in self._items:
                if not item.get("read"):
                    item["read"] = True
                    changed += 1
            return changed

    def remove(self, notification_id: str) -> bool:
        with self._lock:
            for i, item in enumerate(self._items):
                if item.get("id") == notification_id:
                    self._items.pop(i)
                    return True
            return False

    def clear(self, *, include_pinned: bool = False, read_only: bool = False) -> int:
        with self._lock:
            kept: List[Dict[str, Any]] = []
            removed = 0
            for item in self._items:
                keep_pinned = bool(item.get("pinned")) and not include_pinned
                keep_unread = read_only and not item.get("read")
                if keep_pinned or keep_unread:
                    kept.append(item)
                else:
                    removed += 1
            self._items = kept
            return removed


# ── Singleton store & SSE subscriber fan-out ─────────────────────────

_store: NotificationStoreProtocol = InMemoryNotificationStore()
_subscribers: List[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []
_sub_lock = threading.Lock()


def get_notification_store() -> NotificationStoreProtocol:
    """Return the active notification store."""
    return _store


def set_notification_store(store: NotificationStoreProtocol) -> None:
    """Install a custom notification store backend (SQLite, Redis, etc.)."""
    global _store
    if not isinstance(store, NotificationStoreProtocol):
        raise TypeError("store must implement NotificationStoreProtocol")
    _store = store


def reset_notifications_for_tests() -> None:
    """Reset the default store and clear subscribers (test isolation)."""
    global _store
    _store = InMemoryNotificationStore()
    with _sub_lock:
        _subscribers.clear()


def _broadcast(event: str, data: Dict[str, Any]) -> None:
    """Broadcast an event to all active SSE subscribers (thread-safe)."""
    payload = {"event": event, "data": data}
    with _sub_lock:
        subs = list(_subscribers)
    for loop, queue in subs:
        try:
            if not loop.is_closed():
                loop.call_soon_threadsafe(_enqueue_nowait, queue, payload)
        except Exception:
            pass


def _enqueue_nowait(queue: asyncio.Queue, payload: Dict[str, Any]) -> None:
    try:
        queue.put_nowait(payload)
    except asyncio.QueueFull:
        pass


# ── Public Python SDK helpers ────────────────────────────────────────


def push_notification(
    title: str,
    description: Optional[str] = None,
    *,
    type: str = "info",
    category: Optional[str] = None,
    source: Optional[str] = None,
    action: Optional[Dict[str, Any]] = None,
    dedupe_key: Optional[str] = None,
    pinned: bool = False,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Push a notification into the Notification Center and live-broadcast over SSE."""
    data: Dict[str, Any] = {
        "title": title,
        "type": type,
        "pinned": pinned,
    }
    if description is not None:
        data["description"] = description
    if category is not None:
        data["category"] = category
    if source is not None:
        data["source"] = source
    if action is not None:
        data["action"] = action
    if dedupe_key is not None:
        data["dedupe_key"] = dedupe_key
    if meta is not None:
        data["meta"] = meta
    item = _store.push(data)
    _broadcast("notification", item)
    return item


def list_notifications(
    *,
    unread_only: bool = False,
    category: Optional[str] = None,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Return notifications from the active store."""
    return _store.list(unread_only=unread_only, category=category, limit=limit)


def mark_notification_read(notification_id: str) -> Optional[Dict[str, Any]]:
    """Mark a single notification as read and broadcast the update."""
    item = _store.mark_read(notification_id)
    if item is not None:
        _broadcast("read", {"id": notification_id})
    return item


def mark_all_notifications_read() -> int:
    """Mark all unread notifications as read and broadcast the update."""
    changed = _store.mark_all_read()
    if changed > 0:
        _broadcast("read_all", {"count": changed})
    return changed


def remove_notification(notification_id: str) -> bool:
    """Dismiss/remove a single notification and broadcast the update."""
    removed = _store.remove(notification_id)
    if removed:
        _broadcast("removed", {"id": notification_id})
    return removed


def clear_notifications(*, include_pinned: bool = False, read_only: bool = False) -> int:
    """Clear notifications from the active store and broadcast the update."""
    removed = _store.clear(include_pinned=include_pinned, read_only=read_only)
    if removed > 0:
        _broadcast("cleared", {"count": removed, "include_pinned": include_pinned, "read_only": read_only})
    return removed


# ── Starlette Feature Protocol ───────────────────────────────────────


class NotificationsFeature(BaseFeatureProtocol):
    """First-party Notification Center feature (REST + SSE)."""

    feature_name = "notifications"
    feature_description = "In-app notification center (bell inbox, REST & SSE feed)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> Sequence[Route]:
        return [
            Route("/api/notifications", self._list, methods=["GET"]),
            Route("/api/notifications", self._create, methods=["POST"]),
            Route("/api/notifications", self._clear, methods=["DELETE"]),
            Route("/api/notifications/read-all", self._read_all, methods=["POST"]),
            Route("/api/notifications/stream", self._stream, methods=["GET"]),
            Route("/api/notifications/{notification_id}/read", self._mark_read, methods=["POST"]),
            Route("/api/notifications/{notification_id}", self._delete, methods=["DELETE"]),
        ]

    async def _list(self, request: Request) -> JSONResponse:
        unread_only = request.query_params.get("unread", "").lower() in ("1", "true", "yes")
        category = request.query_params.get("category") or None
        raw_limit = request.query_params.get("limit")
        limit: Optional[int] = None
        if raw_limit:
            try:
                limit = max(1, min(500, int(raw_limit)))
            except ValueError:
                limit = None
        items = _store.list(unread_only=unread_only, category=category, limit=limit)
        return JSONResponse(
            {
                "notifications": items,
                "unread_count": _store.unread_count(),
                "total": len(items),
            }
        )

    async def _create(self, request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "Expected a JSON object"}, status_code=400)
        try:
            item = _store.push(body)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        _broadcast("notification", item)
        return JSONResponse({"notification": item, "unread_count": _store.unread_count()}, status_code=201)

    async def _mark_read(self, request: Request) -> JSONResponse:
        nid = request.path_params["notification_id"]
        item = mark_notification_read(nid)
        if item is None:
            return JSONResponse({"error": "Notification not found"}, status_code=404)
        return JSONResponse({"notification": item, "unread_count": _store.unread_count()})

    async def _read_all(self, request: Request) -> JSONResponse:
        changed = mark_all_notifications_read()
        return JSONResponse({"marked": changed, "unread_count": _store.unread_count()})

    async def _delete(self, request: Request) -> JSONResponse:
        nid = request.path_params["notification_id"]
        if not remove_notification(nid):
            return JSONResponse({"error": "Notification not found"}, status_code=404)
        return JSONResponse({"removed": True, "unread_count": _store.unread_count()})

    async def _clear(self, request: Request) -> JSONResponse:
        include_pinned = request.query_params.get("include_pinned", "").lower() in ("1", "true", "yes")
        read_only = request.query_params.get("read_only", "").lower() in ("1", "true", "yes")
        removed = clear_notifications(include_pinned=include_pinned, read_only=read_only)
        return JSONResponse({"cleared": removed, "unread_count": _store.unread_count()})

    async def _stream(self, request: Request) -> StreamingResponse:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        entry = (loop, queue)
        with _sub_lock:
            _subscribers.append(entry)

        async def event_generator() -> AsyncIterator[str]:
            try:
                init = json.dumps({"unread_count": _store.unread_count()})
                yield f"event: ready\ndata: {init}\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        msg = await asyncio.wait_for(queue.get(), timeout=25.0)
                        ev = msg["event"]
                        data = json.dumps(msg["data"])
                        yield f"event: {ev}\ndata: {data}\n\n"
                    except asyncio.TimeoutError:
                        ping = json.dumps({"unread_count": _store.unread_count()})
                        yield f"event: ping\ndata: {ping}\n\n"
            finally:
                with _sub_lock:
                    if entry in _subscribers:
                        _subscribers.remove(entry)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )


__all__ = [
    "InMemoryNotificationStore",
    "NotificationStoreProtocol",
    "NotificationsFeature",
    "clear_notifications",
    "get_notification_store",
    "list_notifications",
    "mark_all_notifications_read",
    "mark_notification_read",
    "push_notification",
    "remove_notification",
    "reset_notifications_for_tests",
    "set_notification_store",
]
