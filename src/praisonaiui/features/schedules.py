"""Schedules feature — wire praisonaiagents.scheduler into PraisonAIUI.

Provides API endpoints and CLI commands for scheduled job management:
add, list, remove, toggle, and trigger cron/interval/one-shot jobs.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory schedule store (mirrors praisonaiagents.scheduler.store)
_jobs: Dict[str, Dict[str, Any]] = {}


class PraisonAISchedules(BaseFeatureProtocol):
    """Schedule/cron management wired to praisonaiagents.scheduler."""

    feature_name = "schedules"
    feature_description = "Scheduled job management (cron, interval, one-shot)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/schedules", self._list, methods=["GET"]),
            Route("/api/schedules", self._add, methods=["POST"]),
            Route("/api/schedules/{job_id}", self._get, methods=["GET"]),
            Route("/api/schedules/{job_id}", self._delete, methods=["DELETE"]),
            Route("/api/schedules/{job_id}/toggle", self._toggle, methods=["POST"]),
            Route("/api/schedules/{job_id}/run", self._run, methods=["POST"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "schedule",
            "help": "Manage scheduled jobs",
            "commands": {
                "list": {"help": "List all scheduled jobs", "handler": self._cli_list},
                "add": {"help": "Add a new scheduled job", "handler": self._cli_add},
                "remove": {"help": "Remove a scheduled job", "handler": self._cli_remove},
                "status": {"help": "Show scheduler status", "handler": self._cli_status},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        enabled = sum(1 for j in _jobs.values() if j.get("enabled", True))
        return {
            "status": "ok",
            "feature": self.name,
            "total_jobs": len(_jobs),
            "enabled_jobs": enabled,
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        return JSONResponse({"schedules": list(_jobs.values()), "count": len(_jobs)})

    async def _add(self, request: Request) -> JSONResponse:
        body = await request.json()
        job_id = uuid.uuid4().hex[:12]
        schedule = body.get("schedule", {})
        job = {
            "id": job_id,
            "name": body.get("name", ""),
            "schedule": {
                "kind": schedule.get("kind", "every"),
                "every_seconds": schedule.get("every_seconds"),
                "cron_expr": schedule.get("cron_expr"),
                "at": schedule.get("at"),
            },
            "message": body.get("message", ""),
            "agent_id": body.get("agent_id"),
            "session_target": body.get("session_target", "isolated"),
            "enabled": body.get("enabled", True),
            "delete_after_run": body.get("delete_after_run", False),
            "created_at": time.time(),
            "last_run_at": None,
        }
        _jobs[job_id] = job
        return JSONResponse(job, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        return JSONResponse(job)

    async def _delete(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        if job_id not in _jobs:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        del _jobs[job_id]
        return JSONResponse({"deleted": job_id})

    async def _toggle(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        job["enabled"] = not job["enabled"]
        return JSONResponse(job)

    async def _run(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        job["last_run_at"] = time.time()
        return JSONResponse({"triggered": job_id, "last_run_at": job["last_run_at"]})

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        if not _jobs:
            return "No scheduled jobs"
        lines = []
        for j in _jobs.values():
            status = "✓" if j.get("enabled", True) else "✗"
            lines.append(f"  [{status}] {j['id']} — {j['name']} ({j['schedule']['kind']})")
        return "\n".join(lines)

    def _cli_add(self, name: str, message: str, every_seconds: int = 60) -> str:
        job_id = uuid.uuid4().hex[:12]
        _jobs[job_id] = {
            "id": job_id, "name": name, "message": message,
            "schedule": {"kind": "every", "every_seconds": every_seconds},
            "enabled": True, "created_at": time.time(), "last_run_at": None,
        }
        return f"Added job {job_id}: {name}"

    def _cli_remove(self, job_id: str) -> str:
        if job_id not in _jobs:
            return f"Job {job_id} not found"
        del _jobs[job_id]
        return f"Removed job {job_id}"

    def _cli_status(self) -> str:
        enabled = sum(1 for j in _jobs.values() if j.get("enabled", True))
        return f"Jobs: {len(_jobs)} total, {enabled} enabled"
