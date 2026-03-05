"""Approvals feature — wire praisonaiagents.approval into PraisonAIUI.

Provides API endpoints and CLI commands for tool-execution approval
management: listing pending approvals, resolving them, and configuring
approval policies.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory approval store (lightweight; swap for persistent backend)
_pending: Dict[str, Dict[str, Any]] = {}
_resolved: Dict[str, Dict[str, Any]] = {}


class PraisonAIApprovals(BaseFeatureProtocol):
    """Approval management wired to praisonaiagents.approval."""

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
            Route("/api/approvals/config", self._config, methods=["GET"]),
            Route("/api/approvals/{approval_id}/resolve", self._resolve, methods=["POST"]),
            Route("/api/approvals/{approval_id}", self._get, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "approval",
            "help": "Manage tool-execution approvals",
            "commands": {
                "list": {"help": "List pending approvals", "handler": self._cli_list},
                "pending": {"help": "Show pending count", "handler": self._cli_pending},
                "resolve": {"help": "Resolve an approval", "handler": self._cli_resolve},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "pending_count": len(_pending),
            "resolved_count": len(_resolved),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all approvals (pending + resolved)."""
        status_filter = request.query_params.get("status", "all")
        if status_filter == "pending":
            items = list(_pending.values())
        elif status_filter == "resolved":
            items = list(_resolved.values())
        else:
            items = list(_pending.values()) + list(_resolved.values())
        return JSONResponse({"approvals": items, "count": len(items)})

    async def _request(self, request: Request) -> JSONResponse:
        """Create a new approval request."""
        body = await request.json()
        approval_id = uuid.uuid4().hex[:12]
        entry = {
            "id": approval_id,
            "tool_name": body.get("tool_name", "unknown"),
            "arguments": body.get("arguments", {}),
            "risk_level": body.get("risk_level", "medium"),
            "agent_name": body.get("agent_name"),
            "session_id": body.get("session_id"),
            "status": "pending",
            "created_at": time.time(),
        }
        _pending[approval_id] = entry
        return JSONResponse(entry, status_code=201)

    async def _resolve(self, request: Request) -> JSONResponse:
        """Resolve (approve/deny) a pending approval."""
        approval_id = request.path_params["approval_id"]
        if approval_id not in _pending:
            return JSONResponse({"error": "Approval not found"}, status_code=404)
        body = await request.json()
        entry = _pending.pop(approval_id)
        entry["status"] = "approved" if body.get("approved", False) else "denied"
        entry["reason"] = body.get("reason", "")
        entry["resolved_at"] = time.time()
        entry["approver"] = body.get("approver", "user")
        _resolved[approval_id] = entry
        return JSONResponse(entry)

    async def _get(self, request: Request) -> JSONResponse:
        """Get a specific approval by ID."""
        approval_id = request.path_params["approval_id"]
        entry = _pending.get(approval_id) or _resolved.get(approval_id)
        if not entry:
            return JSONResponse({"error": "Approval not found"}, status_code=404)
        return JSONResponse(entry)

    async def _config(self, request: Request) -> JSONResponse:
        """Get approval configuration."""
        return JSONResponse({
            "auto_approve": False,
            "risk_threshold": "high",
            "require_reason": True,
            "pending_count": len(_pending),
            "resolved_count": len(_resolved),
        })

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        items = list(_pending.values()) + list(_resolved.values())
        if not items:
            return "No approvals"
        lines = []
        for a in items:
            lines.append(f"  [{a['status']}] {a['id']} — {a['tool_name']}")
        return "\n".join(lines)

    def _cli_pending(self) -> str:
        return f"Pending approvals: {len(_pending)}"

    def _cli_resolve(self, approval_id: str, approved: bool = True) -> str:
        if approval_id not in _pending:
            return f"Approval {approval_id} not found"
        entry = _pending.pop(approval_id)
        entry["status"] = "approved" if approved else "denied"
        entry["resolved_at"] = time.time()
        _resolved[approval_id] = entry
        return f"Approval {approval_id} → {entry['status']}"
