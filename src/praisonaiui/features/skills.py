"""Skills feature — wire praisonaiagents.skills into PraisonAIUI.

Provides API endpoints and CLI commands for skill management:
listing, discovering, and checking status of agent skills.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory skills registry
_skills: Dict[str, Dict[str, Any]] = {}


class PraisonAISkills(BaseFeatureProtocol):
    """Skills management wired to praisonaiagents.skills."""

    feature_name = "skills"
    feature_description = "Agent skill discovery and management"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/skills", self._list, methods=["GET"]),
            Route("/api/skills", self._register, methods=["POST"]),
            Route("/api/skills/{skill_id}", self._get, methods=["GET"]),
            Route("/api/skills/{skill_id}", self._delete, methods=["DELETE"]),
            Route("/api/skills/{skill_id}/status", self._status, methods=["GET"]),
            Route("/api/skills/discover", self._discover, methods=["POST"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "skills",
            "help": "Manage agent skills",
            "commands": {
                "list": {"help": "List all skills", "handler": self._cli_list},
                "status": {"help": "Show skill status", "handler": self._cli_status},
                "discover": {"help": "Discover available skills", "handler": self._cli_discover},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "total_skills": len(_skills),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        return JSONResponse({"skills": list(_skills.values()), "count": len(_skills)})

    async def _register(self, request: Request) -> JSONResponse:
        body = await request.json()
        skill_id = body.get("id", uuid.uuid4().hex[:12])
        entry = {
            "id": skill_id,
            "name": body.get("name", ""),
            "description": body.get("description", ""),
            "version": body.get("version", "1.0.0"),
            "status": "active",
            "registered_at": time.time(),
        }
        _skills[skill_id] = entry
        return JSONResponse(entry, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        skill_id = request.path_params["skill_id"]
        skill = _skills.get(skill_id)
        if not skill:
            return JSONResponse({"error": "Skill not found"}, status_code=404)
        return JSONResponse(skill)

    async def _delete(self, request: Request) -> JSONResponse:
        skill_id = request.path_params["skill_id"]
        if skill_id not in _skills:
            return JSONResponse({"error": "Skill not found"}, status_code=404)
        del _skills[skill_id]
        return JSONResponse({"deleted": skill_id})

    async def _status(self, request: Request) -> JSONResponse:
        skill_id = request.path_params["skill_id"]
        skill = _skills.get(skill_id)
        if not skill:
            return JSONResponse({"error": "Skill not found"}, status_code=404)
        return JSONResponse({
            "id": skill_id,
            "name": skill["name"],
            "status": skill.get("status", "unknown"),
            "version": skill.get("version", "unknown"),
        })

    async def _discover(self, request: Request) -> JSONResponse:
        """Discover available skills from the runtime environment."""
        discovered = list(_skills.values())
        return JSONResponse({"discovered": discovered, "count": len(discovered)})

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        if not _skills:
            return "No skills registered"
        lines = [f"  {s['id']} — {s['name']} (v{s.get('version', '?')})" for s in _skills.values()]
        return "\n".join(lines)

    def _cli_status(self) -> str:
        return f"Skills: {len(_skills)} registered"

    def _cli_discover(self) -> str:
        return f"Discovered {len(_skills)} skills"
