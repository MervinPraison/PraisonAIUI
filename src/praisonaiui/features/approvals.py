"""Approvals feature — protocol-driven approval management for PraisonAIUI.

Architecture:
    ApprovalProtocol (ABC)          <- any backend implements this
      ├── SimpleApprovalManager     <- default in-memory (no deps)
      └── SDKApprovalManager        <- wraps praisonaiagents.approval

    PraisonAIApprovals (BaseFeatureProtocol)
      └── delegates to active ApprovalProtocol implementation
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from abc import ABC, abstractmethod
from collections import deque
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

# Risk levels
RISK_LEVELS = ["low", "medium", "high", "critical"]
RISK_ICONS = {"low": "✅", "medium": "⚠️", "high": "🟠", "critical": "🔴"}


def _list_backend_approvals() -> List[Dict[str, Any]] | None:
    """List approvals from injected backend when available."""
    from praisonaiui.backends import get_approvals_lister

    lister = get_approvals_lister()
    if lister is None:
        return None
    try:
        items = lister()
    except Exception:
        return None
    return items if isinstance(items, list) else None


def _authenticated_user(request: Request) -> Optional[str]:
    """Return the caller identity, or ``None`` when auth is enabled and the caller is
    unauthenticated. In auth mode ``none`` every caller is accepted (backward compat)."""
    from .auth import check_auth

    result = check_auth(request)
    if not result:
        return None
    return result.get("user") or "user"


_UNAUTHORIZED = {"error": "Authentication required"}


# ── Approval Protocol ────────────────────────────────────────────────


class ApprovalProtocol(ABC):
    """Protocol interface for approval backends."""

    @abstractmethod
    def list_pending(self) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def list_history(self, *, limit: int = 50) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def request_approval(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        """Create an approval request. Returns the entry (may be auto-resolved)."""
        ...

    @abstractmethod
    def approve(
        self, approval_id: str, reason: str = "", approver: str = "user", always: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Approve a pending request.

        Implementations may also accept ``modified_args: dict`` (replacement
        tool arguments); the HTTP handler only passes it when the client sent it.
        """
        ...

    @abstractmethod
    def deny(
        self, approval_id: str, reason: str = "", approver: str = "user", always: bool = False
    ) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def get(self, approval_id: str) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def get_policies(self) -> Dict[str, Any]: ...

    @abstractmethod
    def update_policies(self, updates: Dict[str, Any]) -> Dict[str, Any]: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Decision waiter ──────────────────────────────────────────────────


class _DecisionWaiter:
    """One pending decision that both threads and coroutines can wait on.

    ``set()`` may be called from any thread (normally the server's event loop
    handling ``POST /api/approvals/{id}/approve``); sync waiters block on a
    ``threading.Event`` and async waiters get their future resolved on their
    own loop via ``call_soon_threadsafe``, so neither blocks the other.
    """

    def __init__(self) -> None:
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._result: Optional[Dict[str, Any]] = None
        self._futures: List[tuple] = []

    @property
    def done(self) -> bool:
        return self._event.is_set()

    def set(self, entry: Dict[str, Any]) -> None:
        with self._lock:
            if self._event.is_set():
                return
            self._result = entry
            self._event.set()
            futures, self._futures = self._futures, []
        for loop, fut in futures:
            try:
                loop.call_soon_threadsafe(_resolve_future, fut, entry)
            except RuntimeError:  # loop already closed
                pass

    def wait(self, timeout: Optional[float]) -> Optional[Dict[str, Any]]:
        return self._result if self._event.wait(timeout) else None

    async def wait_async(self, timeout: Optional[float]) -> Optional[Dict[str, Any]]:
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        with self._lock:
            if self._event.is_set():
                return self._result
            self._futures.append((loop, fut))
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            with self._lock:
                if (loop, fut) in self._futures:
                    self._futures.remove((loop, fut))


def _resolve_future(fut: "asyncio.Future", value: Any) -> None:
    if not fut.done():
        fut.set_result(value)


# ── Simple Approval Manager ──────────────────────────────────────────


class SimpleApprovalManager(ApprovalProtocol):
    """In-memory approval manager — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._pending: Dict[str, Dict[str, Any]] = {}
        self._history: deque = deque(maxlen=500)
        self._lock = threading.RLock()
        self._waiters: Dict[str, _DecisionWaiter] = {}
        self._policies: Dict[str, Any] = {
            "auto_approve_tools": [],
            "always_deny_tools": [],
            "auto_approve_agents": [],
            "require_reason": False,
            "risk_threshold": "high",
        }

    def _check_auto_action(self, tool_name: str, agent_name: str, risk_level: str) -> Optional[str]:
        if tool_name in self._policies.get("always_deny_tools", []):
            return "denied"
        if tool_name in self._policies.get("auto_approve_tools", []):
            return "approved"
        if agent_name and agent_name in self._policies.get("auto_approve_agents", []):
            return "approved"
        threshold = self._policies.get("risk_threshold", "high")
        risk_order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        if risk_order.get(risk_level, 1) < risk_order.get(threshold, 2):
            return "approved"
        return None

    def list_pending(self) -> List[Dict[str, Any]]:
        items = list(self._pending.values())
        items.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        return items

    def list_history(self, *, limit: int = 50) -> List[Dict[str, Any]]:
        return list(self._history)[:limit]

    def request_approval(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        approval_id = entry.get("id", uuid.uuid4().hex[:12])
        entry["id"] = approval_id
        entry.setdefault("status", "pending")
        entry.setdefault("created_at", time.time())
        entry.setdefault("risk_icon", RISK_ICONS.get(entry.get("risk_level", "medium"), "⚠️"))

        auto = self._check_auto_action(
            entry.get("tool_name", ""),
            entry.get("agent_name", ""),
            entry.get("risk_level", "medium"),
        )
        with self._lock:
            if auto:
                entry["status"] = auto
                entry["resolved_at"] = time.time()
                entry["approver"] = "auto-policy"
                entry["reason"] = f"Auto-{auto} by policy"
                self._history.appendleft(entry)
            else:
                self._pending[approval_id] = entry
                self._waiters.setdefault(approval_id, _DecisionWaiter())
        return entry

    def waiter(self, approval_id: str) -> Optional[_DecisionWaiter]:
        """The waiter for a pending request (``None`` once it is resolved)."""
        with self._lock:
            return self._waiters.get(approval_id)

    def _signal(self, approval_id: str, entry: Dict[str, Any]) -> None:
        waiter = self._waiters.pop(approval_id, None)
        if waiter is not None:
            waiter.set(entry)

    def approve(
        self,
        approval_id: str,
        reason: str = "",
        approver: str = "user",
        always: bool = False,
        modified_args: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        with self._lock:
            if approval_id not in self._pending:
                return None
            entry = self._pending.pop(approval_id)
            entry["status"] = "approved"
            entry["reason"] = reason
            entry["resolved_at"] = time.time()
            entry["approver"] = approver
            if modified_args is not None:
                entry["modified_args"] = dict(modified_args)
            if always and entry["tool_name"] not in self._policies["auto_approve_tools"]:
                self._policies["auto_approve_tools"].append(entry["tool_name"])
            self._history.appendleft(entry)
            self._signal(approval_id, entry)
        return entry

    def deny(
        self, approval_id: str, reason: str = "", approver: str = "user", always: bool = False
    ) -> Optional[Dict[str, Any]]:
        with self._lock:
            if approval_id not in self._pending:
                return None
            entry = self._pending.pop(approval_id)
            entry["status"] = "denied"
            entry["reason"] = reason
            entry["resolved_at"] = time.time()
            entry["approver"] = approver
            if always and entry["tool_name"] not in self._policies["always_deny_tools"]:
                self._policies["always_deny_tools"].append(entry["tool_name"])
            self._history.appendleft(entry)
            self._signal(approval_id, entry)
        return entry

    def get(self, approval_id: str) -> Optional[Dict[str, Any]]:
        entry = self._pending.get(approval_id)
        if not entry:
            entry = next((h for h in self._history if h["id"] == approval_id), None)
        return entry

    def get_policies(self) -> Dict[str, Any]:
        return dict(self._policies)

    def update_policies(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        for key in (
            "auto_approve_tools",
            "always_deny_tools",
            "auto_approve_agents",
            "require_reason",
            "risk_threshold",
        ):
            if key in updates:
                self._policies[key] = updates[key]
        return dict(self._policies)

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleApprovalManager",
            "pending_count": len(self._pending),
            "history_count": len(self._history),
        }


# ── SDK Approval Manager ─────────────────────────────────────────────


class SDKApprovalManager(ApprovalProtocol):
    """Wraps praisonaiagents.approval.ApprovalRegistry for production use."""

    def __init__(self) -> None:
        from praisonaiagents.approval import get_approval_registry
        from praisonaiagents.approval.protocols import ApprovalDecision, ApprovalRequest

        self._registry = get_approval_registry()
        self._simple = SimpleApprovalManager()
        self._ApprovalDecision = ApprovalDecision
        self._ApprovalRequest = ApprovalRequest
        self._registry.set_backend(_UIStoreBackend(self._simple))
        logger.info("SDKApprovalManager initialized (ApprovalRegistry wired to UI store)")

    def list_pending(self) -> List[Dict[str, Any]]:
        return self._simple.list_pending()

    def list_history(self, *, limit: int = 50) -> List[Dict[str, Any]]:
        return self._simple.list_history(limit=limit)

    def request_approval(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        result = self._simple.request_approval(entry)
        tool = entry.get("tool_name")
        if tool and entry.get("status") == "pending":
            self._registry.add_requirement(tool, entry.get("risk_level", "high"))
        return result

    def approve(
        self,
        approval_id: str,
        reason: str = "",
        approver: str = "user",
        always: bool = False,
        modified_args: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        entry = self._simple.approve(approval_id, reason, approver, always, modified_args)
        if entry and always and entry.get("tool_name"):
            self._registry.add_requirement(entry["tool_name"], entry.get("risk_level", "high"))
        return entry

    def deny(
        self, approval_id: str, reason: str = "", approver: str = "user", always: bool = False
    ) -> Optional[Dict[str, Any]]:
        return self._simple.deny(approval_id, reason, approver, always)

    def get(self, approval_id: str) -> Optional[Dict[str, Any]]:
        return self._simple.get(approval_id)

    def get_policies(self) -> Dict[str, Any]:
        policies = self._simple.get_policies()
        policies["sdk_auto_approve_env"] = self._registry.is_env_auto_approve()
        return policies

    def update_policies(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        result = self._simple.update_policies(updates)
        for tool in updates.get("always_deny_tools") or []:
            self._registry.add_requirement(tool, "high")
        for tool in updates.get("auto_approve_tools") or []:
            self._registry.remove_requirement(tool)
        return result

    def health(self) -> Dict[str, Any]:
        h = self._simple.health()
        h["provider"] = "SDKApprovalManager"
        h["sdk_available"] = True
        return h


class _UIStoreBackend:
    """Routes agent approval requests into the UI store and waits for a human.

    Each request becomes a pending entry keyed by ``request.approval_id`` and
    the caller blocks (sync: on a ``threading.Event``; async: on a future of
    its own loop) until ``POST /api/approvals/{id}/approve|deny`` resolves it.
    No answer within the timeout is a denial (fail-closed) and the entry is
    resolved as ``denied`` with ``approver="timeout"`` so the queue stays honest.
    """

    def __init__(self, store: SimpleApprovalManager, timeout: Optional[float] = None) -> None:
        self._store = store
        self._timeout = timeout

    def _effective_timeout(self, timeout: Optional[float]) -> float:
        if timeout is not None:
            return float(timeout)
        if self._timeout is not None:
            return float(self._timeout)
        try:
            from praisonaiagents.approval import get_approval_registry

            return float(getattr(get_approval_registry(), "timeout", 300.0))
        except Exception:
            return 300.0

    def _submit(self, request) -> Dict[str, Any]:
        entry: Dict[str, Any] = {
            "tool_name": request.tool_name,
            "agent_name": getattr(request, "agent_name", "") or "",
            "risk_level": request.risk_level or "medium",
            "arguments": request.arguments or {},
        }
        approval_id = getattr(request, "approval_id", None)
        if approval_id:
            entry["id"] = str(approval_id)
        session_id = getattr(request, "session_id", None)
        if session_id:
            entry["session_id"] = session_id
        return self._store.request_approval(entry)

    @staticmethod
    def _decision(entry: Optional[Dict[str, Any]]) -> Any:
        from praisonaiagents.approval.protocols import ApprovalDecision

        if entry is None:
            return ApprovalDecision(
                approved=False, reason="Timed out waiting for UI approval", approver="timeout"
            )
        if entry.get("status") == "approved":
            return ApprovalDecision(
                approved=True,
                reason=entry.get("reason", ""),
                modified_args=dict(entry.get("modified_args") or {}),
                approver=entry.get("approver"),
            )
        return ApprovalDecision(
            approved=False,
            reason=entry.get("reason") or "denied",
            approver=entry.get("approver"),
        )

    def _expire(
        self,
        approval_id: str,
        reason: str = "Timed out waiting for UI approval",
        approver: str = "timeout",
    ) -> Optional[Dict[str, Any]]:
        """Deny a request nobody answered; return the entry if a human won the race."""
        denied = self._store.deny(approval_id, reason=reason, approver=approver)
        if denied is not None:
            return None
        return self._store.get(approval_id)

    def request_approval_sync(self, request, timeout: Optional[float] = None) -> Any:
        from praisonaiagents.approval.protocols import ApprovalDecision

        entry = self._submit(request)
        if entry.get("status") != "pending":
            return self._decision(entry)
        approval_id = entry["id"]
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            # Blocking here would freeze this thread's event loop (and with it,
            # possibly the very server that has to deliver the answer).
            reason = "UI approval cannot block an event-loop thread; use the async approval path"
            self._expire(approval_id, reason=reason, approver="ui")
            return ApprovalDecision(approved=False, reason=reason, approver="ui")
        waiter = self._store.waiter(approval_id)
        result = waiter.wait(self._effective_timeout(timeout)) if waiter else self._store.get(approval_id)
        if result is None:
            result = self._expire(approval_id)
        return self._decision(result)

    async def request_approval(self, request) -> Any:
        entry = self._submit(request)
        if entry.get("status") != "pending":
            return self._decision(entry)
        approval_id = entry["id"]
        waiter = self._store.waiter(approval_id)
        try:
            result = (
                await waiter.wait_async(self._effective_timeout(None))
                if waiter
                else self._store.get(approval_id)
            )
        except asyncio.CancelledError:
            # The registry's own wait_for timed out (or the turn was cancelled).
            self._expire(approval_id)
            raise
        if result is None:
            result = self._expire(approval_id)
        return self._decision(result)


# ── Manager singleton ────────────────────────────────────────────────

_approval_manager: Optional[ApprovalProtocol] = None
_subscribers: List[asyncio.Queue] = []


def get_approval_manager() -> ApprovalProtocol:
    """Get the active approval manager (SDK-first, fallback to Simple)."""
    global _approval_manager
    if _approval_manager is None:
        try:
            _approval_manager = SDKApprovalManager()
            logger.info("Using SDKApprovalManager")
        except Exception as e:
            logger.debug("SDKApprovalManager init failed (%s), using SimpleApprovalManager", e)
            _approval_manager = SimpleApprovalManager()
    return _approval_manager


async def _notify_subscribers(event: str, data: Dict[str, Any]) -> None:
    for queue in _subscribers:
        try:
            await queue.put({"event": event, "data": data})
        except Exception:
            pass


class ApprovalsFeature(BaseFeatureProtocol):
    """Execution approval management for PraisonAIUI."""

    feature_name = "approvals"
    feature_description = "Tool-execution approval management"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/approvals", self._list, methods=["GET"]),
            Route("/api/approvals", self._request, methods=["POST"]),
            Route("/api/approvals/pending", self._pending, methods=["GET"]),
            Route("/api/approvals/history", self._history_list, methods=["GET"]),
            Route("/api/approvals/policies", self._get_policies, methods=["GET"]),
            Route("/api/approvals/policies", self._update_policies, methods=["PUT"]),
            Route("/api/approvals/stream", self._stream, methods=["GET"]),
            Route("/api/approvals/{approval_id}", self._get, methods=["GET"]),
            Route("/api/approvals/{approval_id}/approve", self._approve, methods=["POST"]),
            Route("/api/approvals/{approval_id}/deny", self._deny, methods=["POST"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "approval",
                "help": "Manage tool-execution approvals",
                "commands": {
                    "list": {"help": "List pending approvals", "handler": self._cli_list},
                    "pending": {"help": "Show pending count", "handler": self._cli_pending},
                },
            }
        ]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        mgr = get_approval_manager()
        return {
            "status": "ok",
            "feature": self.name,
            **mgr.health(),
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        mgr = get_approval_manager()
        backend_items = _list_backend_approvals()
        if backend_items is not None:
            return JSONResponse({"approvals": backend_items, "count": len(backend_items)})

        status_filter = request.query_params.get("status", "all")
        if status_filter == "pending":
            items = mgr.list_pending()
        elif status_filter == "resolved":
            items = mgr.list_history()
        else:
            items = mgr.list_pending() + mgr.list_history()
        items.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        return JSONResponse({"approvals": items, "count": len(items)})

    async def _pending(self, request: Request) -> JSONResponse:
        mgr = get_approval_manager()
        items = mgr.list_pending()
        return JSONResponse({"approvals": items, "count": len(items)})

    async def _history_list(self, request: Request) -> JSONResponse:
        mgr = get_approval_manager()
        limit = int(request.query_params.get("limit", 50))
        items = mgr.list_history(limit=limit)
        return JSONResponse({"history": items, "count": len(items)})

    async def _request(self, request: Request) -> JSONResponse:
        mgr = get_approval_manager()
        body = await request.json()
        entry = {
            "id": uuid.uuid4().hex[:12],
            "tool_name": body.get("tool_name", "unknown"),
            "arguments": body.get("arguments", {}),
            "risk_level": body.get("risk_level", "medium"),
            "agent_name": body.get("agent_name", ""),
            "session_id": body.get("session_id"),
            "description": body.get("description", ""),
            "status": "pending",
            "created_at": time.time(),
        }

        # Validate agent exists in gateway
        agent_name = entry["agent_name"]
        if agent_name:
            try:
                from ._gateway_ref import get_gateway

                gw = get_gateway()
                if gw is not None:
                    for aid in gw.list_agents():
                        gw_agent = gw.get_agent(aid)
                        if gw_agent and getattr(gw_agent, "name", None) == agent_name:
                            entry["gateway_agent_found"] = True
                            break
                    else:
                        entry["gateway_agent_found"] = False
            except (ImportError, Exception):
                pass

        result = mgr.request_approval(entry)
        event = "resolved" if result["status"] != "pending" else "new"
        await _notify_subscribers(event, result)
        return JSONResponse(result, status_code=201)

    async def _approve(self, request: Request) -> JSONResponse:
        approver = _authenticated_user(request)
        if approver is None:
            return JSONResponse(_UNAUTHORIZED, status_code=401)
        mgr = get_approval_manager()
        approval_id = request.path_params["approval_id"]
        body = await request.json() if request.headers.get("content-length") else {}
        modified_args = body.get("modified_args")
        if modified_args is not None and not isinstance(modified_args, dict):
            return JSONResponse({"error": "modified_args must be an object"}, status_code=400)
        entry = mgr.approve(
            approval_id,
            reason=body.get("reason", ""),
            approver=approver,
            always=body.get("always", False),
            **({"modified_args": modified_args} if modified_args is not None else {}),
        )
        if entry is None:
            return JSONResponse({"error": "Approval not found"}, status_code=404)
        await _notify_subscribers("resolved", entry)
        return JSONResponse(entry)

    async def _deny(self, request: Request) -> JSONResponse:
        approver = _authenticated_user(request)
        if approver is None:
            return JSONResponse(_UNAUTHORIZED, status_code=401)
        mgr = get_approval_manager()
        approval_id = request.path_params["approval_id"]
        body = await request.json() if request.headers.get("content-length") else {}
        entry = mgr.deny(
            approval_id,
            reason=body.get("reason", ""),
            approver=approver,
            always=body.get("always", False),
        )
        if entry is None:
            return JSONResponse({"error": "Approval not found"}, status_code=404)
        await _notify_subscribers("resolved", entry)
        return JSONResponse(entry)

    async def _get(self, request: Request) -> JSONResponse:
        mgr = get_approval_manager()
        approval_id = request.path_params["approval_id"]
        entry = mgr.get(approval_id)
        if not entry:
            return JSONResponse({"error": "Approval not found"}, status_code=404)
        return JSONResponse(entry)

    async def _get_policies(self, request: Request) -> JSONResponse:
        mgr = get_approval_manager()
        pending = mgr.list_pending()
        history = mgr.list_history()
        return JSONResponse(
            {
                "policies": mgr.get_policies(),
                "pending_count": len(pending),
                "history_count": len(history),
            }
        )

    async def _update_policies(self, request: Request) -> JSONResponse:
        if _authenticated_user(request) is None:
            return JSONResponse(_UNAUTHORIZED, status_code=401)
        mgr = get_approval_manager()
        body = await request.json()
        policies = mgr.update_policies(body)
        return JSONResponse({"policies": policies, "updated": True})

    async def _stream(self, request: Request) -> StreamingResponse:
        queue: asyncio.Queue = asyncio.Queue()
        _subscribers.append(queue)
        mgr = get_approval_manager()

        async def event_generator():
            try:
                pending_count = len(mgr.list_pending())
                yield f'data: {{"event": "connected", "pending": {pending_count}}}\n\n'
                while True:
                    try:
                        msg = await asyncio.wait_for(queue.get(), timeout=30)
                        pc = len(mgr.list_pending())
                        yield f'data: {{"event": "{msg["event"]}", "data": {{}}, "pending": {pc}}}\n\n'
                    except asyncio.TimeoutError:
                        pc = len(mgr.list_pending())
                        yield f'data: {{"event": "ping", "pending": {pc}}}\n\n'
            finally:
                _subscribers.remove(queue)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        mgr = get_approval_manager()
        items = mgr.list_pending()
        if not items:
            return "No pending approvals"
        lines = []
        for a in items:
            icon = RISK_ICONS.get(a.get("risk_level", "medium"), "⚠️")
            lines.append(
                f"  {icon} {a['id']} — {a['tool_name']} ({a.get('agent_name', 'unknown')})"
            )
        return "\n".join(lines)

    def _cli_pending(self) -> str:
        mgr = get_approval_manager()
        return f"Pending approvals: {len(mgr.list_pending())}"

    def _cli_resolve(self, approval_id: str, approved: bool = True) -> str:
        mgr = get_approval_manager()
        if approved:
            entry = mgr.approve(approval_id)
        else:
            entry = mgr.deny(approval_id)
        if entry is None:
            return f"Approval {approval_id} not found"
        return f"Approval {approval_id} → {entry['status']}"


# Backward-compat alias
PraisonAIApprovals = ApprovalsFeature
