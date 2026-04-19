"""Subagent tree view feature — expose subagent spawning in dashboard (Gap 15).

Protocol-driven: tracks subagent hierarchy.
Config-driven: users configure which agents can spawn subagents.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Protocol ─────────────────────────────────────────────────────


class SubagentProtocol:
    """Protocol for subagent tracking."""

    def get_tree(self, session_id: str) -> Dict[str, Any]: ...

    def register_spawn(
        self,
        parent_agent: str,
        child_agent: str,
        session_id: str,
    ) -> str: ...


# ── Implementation ───────────────────────────────────────────────


class SubagentManager(SubagentProtocol):
    """Tracks agent-subagent relationships for visualization."""

    def __init__(self) -> None:
        self._spawns: List[Dict[str, Any]] = []

    def register_spawn(
        self,
        parent_agent: str,
        child_agent: str,
        session_id: str,
    ) -> str:
        spawn_id = f"{parent_agent}->{child_agent}:{len(self._spawns)}"
        self._spawns.append(
            {
                "id": spawn_id,
                "parent": parent_agent,
                "child": child_agent,
                "session_id": session_id,
                "timestamp": time.time(),
                "status": "running",
            }
        )
        return spawn_id

    def get_tree(self, session_id: str) -> Dict[str, Any]:
        session_spawns = [s for s in self._spawns if s["session_id"] == session_id]
        # Build tree structure
        roots = set()
        children: Dict[str, List[str]] = {}

        for s in session_spawns:
            roots.add(s["parent"])
            if s["parent"] not in children:
                children[s["parent"]] = []
            children[s["parent"]].append(s["child"])

        # Remove non-root nodes
        for s in session_spawns:
            roots.discard(s["child"])

        def build_node(name: str) -> Dict[str, Any]:
            return {
                "name": name,
                "children": [build_node(c) for c in children.get(name, [])],
            }

        return {
            "session_id": session_id,
            "roots": [build_node(r) for r in sorted(roots)],
            "total_spawns": len(session_spawns),
        }

    def list_all(self) -> List[Dict[str, Any]]:
        return self._spawns


_subagent_manager: Optional[SubagentManager] = None


def get_subagent_manager() -> SubagentManager:
    global _subagent_manager
    if _subagent_manager is None:
        _subagent_manager = SubagentManager()
    return _subagent_manager


# ── HTTP Handlers ────────────────────────────────────────────────


async def _subagent_tree(request: Request) -> JSONResponse:
    session_id = request.path_params.get("session_id", "")
    mgr = get_subagent_manager()
    return JSONResponse(mgr.get_tree(session_id))


async def _subagent_list(request: Request) -> JSONResponse:
    mgr = get_subagent_manager()
    return JSONResponse({"spawns": mgr.list_all()})


# ── Feature ──────────────────────────────────────────────────────


class SubagentsFeature(BaseFeatureProtocol):
    """Subagent tree view — tracks and visualizes agent hierarchy."""

    feature_name = "subagents"
    feature_description = "Subagent spawning tree view and hierarchy tracking"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/subagents", _subagent_list, methods=["GET"]),
            Route("/api/subagents/{session_id}", _subagent_tree, methods=["GET"]),
        ]


# Backward-compat alias
PraisonAISubagents = SubagentsFeature
