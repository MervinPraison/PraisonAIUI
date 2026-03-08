"""Approvals feature — execution approval dashboard for PraisonAIUI.

Provides API endpoints for tool-execution approval management:
pending queue, approve/deny actions, policies, and history with SSE.

DRY: Uses praisonaiagents.approval.ApprovalRegistry for backend integration.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

# Risk levels
RISK_LEVELS = ["low", "medium", "high", "critical"]
RISK_ICONS = {"low": "✅", "medium": "⚠️", "high": "🟠", "critical": "🔴"}

# Lazy-loaded approval registry from praisonaiagents
_approval_registry = None


def _get_approval_registry():
    """Lazy-load the praisonaiagents approval registry (DRY)."""
    global _approval_registry
    if _approval_registry is None:
        try:
            from praisonaiagents.approval import get_approval_registry
            _approval_registry = get_approval_registry()
            logger.info("Using praisonaiagents.approval.ApprovalRegistry")
        except ImportError:
            logger.warning("praisonaiagents.approval not available")
            _approval_registry = None
    return _approval_registry


# In-memory stores (UI-specific, synced with registry)
_pending: Dict[str, Dict[str, Any]] = {}
_history: deque = deque(maxlen=500)  # Last 500 resolved approvals
_policies: Dict[str, Any] = {
    "auto_approve_tools": [],  # Tool names to auto-approve
    "always_deny_tools": [],   # Tool names to always deny
    "auto_approve_agents": [], # Agent names to auto-approve
    "require_reason": False,
    "risk_threshold": "high",  # Auto-approve below this level
}
_subscribers: List[asyncio.Queue] = []  # SSE subscribers


async def _notify_subscribers(event: str, data: Dict[str, Any]) -> None:
    """Notify all SSE subscribers of an event."""
    for queue in _subscribers:
        try:
            await queue.put({"event": event, "data": data})
        except Exception:
            pass


def _check_auto_action(tool_name: str, agent_name: str, risk_level: str) -> str | None:
    """Check if an approval should be auto-approved or auto-denied."""
    # Check always deny first
    if tool_name in _policies.get("always_deny_tools", []):
        return "denied"
    
    # Check auto-approve by tool
    if tool_name in _policies.get("auto_approve_tools", []):
        return "approved"
    
    # Check auto-approve by agent
    if agent_name and agent_name in _policies.get("auto_approve_agents", []):
        return "approved"
    
    # Check risk threshold
    threshold = _policies.get("risk_threshold", "high")
    risk_order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
    if risk_order.get(risk_level, 1) < risk_order.get(threshold, 2):
        return "approved"
    
    return None  # Requires manual approval


class PraisonAIApprovals(BaseFeatureProtocol):
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
        return [{
            "name": "approval",
            "help": "Manage tool-execution approvals",
            "commands": {
                "list": {"help": "List pending approvals", "handler": self._cli_list},
                "pending": {"help": "Show pending count", "handler": self._cli_pending},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        return {
            "status": "ok",
            "feature": self.name,
            "pending_count": len(_pending),
            "history_count": len(_history),
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all approvals (pending + history)."""
        status_filter = request.query_params.get("status", "all")
        if status_filter == "pending":
            items = list(_pending.values())
        elif status_filter == "resolved":
            items = list(_history)
        else:
            items = list(_pending.values()) + list(_history)
        
        # Sort by created_at descending
        items.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        return JSONResponse({"approvals": items, "count": len(items)})

    async def _pending(self, request: Request) -> JSONResponse:
        """List only pending approvals."""
        items = list(_pending.values())
        items.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        return JSONResponse({"approvals": items, "count": len(items)})

    async def _history_list(self, request: Request) -> JSONResponse:
        """List approval history."""
        limit = int(request.query_params.get("limit", 50))
        items = list(_history)[:limit]
        return JSONResponse({"history": items, "count": len(items)})

    async def _request(self, request: Request) -> JSONResponse:
        """Create a new approval request."""
        body = await request.json()
        approval_id = uuid.uuid4().hex[:12]
        tool_name = body.get("tool_name", "unknown")
        agent_name = body.get("agent_name", "")
        risk_level = body.get("risk_level", "medium")
        
        entry = {
            "id": approval_id,
            "tool_name": tool_name,
            "arguments": body.get("arguments", {}),
            "risk_level": risk_level,
            "risk_icon": RISK_ICONS.get(risk_level, "⚠️"),
            "agent_name": agent_name,
            "session_id": body.get("session_id"),
            "description": body.get("description", ""),
            "status": "pending",
            "created_at": time.time(),
        }

        # Validate agent exists in gateway (Gap 6 bridge)
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
        
        # Check for auto-action
        auto_action = _check_auto_action(tool_name, agent_name, risk_level)
        if auto_action:
            entry["status"] = auto_action
            entry["resolved_at"] = time.time()
            entry["approver"] = "auto-policy"
            entry["reason"] = f"Auto-{auto_action} by policy"
            _history.appendleft(entry)
            await _notify_subscribers("resolved", entry)
            return JSONResponse(entry, status_code=201)
        
        _pending[approval_id] = entry
        await _notify_subscribers("new", entry)
        return JSONResponse(entry, status_code=201)

    async def _approve(self, request: Request) -> JSONResponse:
        """Approve a pending request."""
        approval_id = request.path_params["approval_id"]
        if approval_id not in _pending:
            return JSONResponse({"error": "Approval not found"}, status_code=404)
        
        body = await request.json() if request.headers.get("content-length") else {}
        entry = _pending.pop(approval_id)
        entry["status"] = "approved"
        entry["reason"] = body.get("reason", "")
        entry["resolved_at"] = time.time()
        entry["approver"] = body.get("approver", "user")
        
        # Handle "always approve" option
        if body.get("always"):
            if entry["tool_name"] not in _policies["auto_approve_tools"]:
                _policies["auto_approve_tools"].append(entry["tool_name"])
        
        _history.appendleft(entry)
        await _notify_subscribers("resolved", entry)
        return JSONResponse(entry)

    async def _deny(self, request: Request) -> JSONResponse:
        """Deny a pending request."""
        approval_id = request.path_params["approval_id"]
        if approval_id not in _pending:
            return JSONResponse({"error": "Approval not found"}, status_code=404)
        
        body = await request.json() if request.headers.get("content-length") else {}
        entry = _pending.pop(approval_id)
        entry["status"] = "denied"
        entry["reason"] = body.get("reason", "")
        entry["resolved_at"] = time.time()
        entry["approver"] = body.get("approver", "user")
        
        # Handle "always deny" option
        if body.get("always"):
            if entry["tool_name"] not in _policies["always_deny_tools"]:
                _policies["always_deny_tools"].append(entry["tool_name"])
        
        _history.appendleft(entry)
        await _notify_subscribers("resolved", entry)
        return JSONResponse(entry)

    async def _get(self, request: Request) -> JSONResponse:
        """Get a specific approval by ID."""
        approval_id = request.path_params["approval_id"]
        entry = _pending.get(approval_id)
        if not entry:
            entry = next((h for h in _history if h["id"] == approval_id), None)
        if not entry:
            return JSONResponse({"error": "Approval not found"}, status_code=404)
        return JSONResponse(entry)

    async def _get_policies(self, request: Request) -> JSONResponse:
        """Get approval policies."""
        return JSONResponse({
            "policies": _policies,
            "pending_count": len(_pending),
            "history_count": len(_history),
        })

    async def _update_policies(self, request: Request) -> JSONResponse:
        """Update approval policies."""
        body = await request.json()
        
        for key in ("auto_approve_tools", "always_deny_tools", "auto_approve_agents",
                    "require_reason", "risk_threshold"):
            if key in body:
                _policies[key] = body[key]
        
        return JSONResponse({"policies": _policies, "updated": True})

    async def _stream(self, request: Request) -> StreamingResponse:
        """SSE stream for real-time approval notifications."""
        queue: asyncio.Queue = asyncio.Queue()
        _subscribers.append(queue)
        
        async def event_generator():
            try:
                # Send initial state
                yield f"data: {{\"event\": \"connected\", \"pending\": {len(_pending)}}}\n\n"
                
                while True:
                    try:
                        msg = await asyncio.wait_for(queue.get(), timeout=30)
                        yield f"data: {{\"event\": \"{msg['event']}\", \"data\": {{}}, \"pending\": {len(_pending)}}}\n\n"
                    except asyncio.TimeoutError:
                        yield f"data: {{\"event\": \"ping\", \"pending\": {len(_pending)}}}\n\n"
            finally:
                _subscribers.remove(queue)
        
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        items = list(_pending.values())
        if not items:
            return "No pending approvals"
        lines = []
        for a in items:
            icon = RISK_ICONS.get(a.get("risk_level", "medium"), "⚠️")
            lines.append(f"  {icon} {a['id']} — {a['tool_name']} ({a.get('agent_name', 'unknown')})")
        return "\n".join(lines)

    def _cli_pending(self) -> str:
        return f"Pending approvals: {len(_pending)}"

    def _cli_resolve(self, approval_id: str, approved: bool = True) -> str:
        if approval_id not in _pending:
            return f"Approval {approval_id} not found"
        entry = _pending.pop(approval_id)
        entry["status"] = "approved" if approved else "denied"
        entry["resolved_at"] = time.time()
        _history.appendleft(entry)
        return f"Approval {approval_id} → {entry['status']}"
