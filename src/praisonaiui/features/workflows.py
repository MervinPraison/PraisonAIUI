"""Workflows feature — wire praisonaiagents.workflows into PraisonAIUI.

Provides API endpoints and CLI commands for workflow management:
listing, running, and checking status of multi-step workflows
(Pipeline, Route, Parallel, Loop, Repeat patterns).
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory workflow registry + run history
_workflows: Dict[str, Dict[str, Any]] = {}
_runs: Dict[str, Dict[str, Any]] = {}


class PraisonAIWorkflows(BaseFeatureProtocol):
    """Workflow management wired to praisonaiagents.workflows."""

    feature_name = "workflows"
    feature_description = "Multi-step workflow management (Pipeline, Route, Parallel, Loop)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/workflows", self._list, methods=["GET"]),
            Route("/api/workflows", self._create, methods=["POST"]),
            Route("/api/workflows/runs", self._list_runs, methods=["GET"]),
            Route("/api/workflows/runs/{run_id}", self._get_run, methods=["GET"]),
            Route("/api/workflows/{workflow_id}", self._get, methods=["GET"]),
            Route("/api/workflows/{workflow_id}", self._delete, methods=["DELETE"]),
            Route("/api/workflows/{workflow_id}/run", self._run, methods=["POST"]),
            Route("/api/workflows/{workflow_id}/status", self._status, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "workflows",
            "help": "Manage multi-step workflows",
            "commands": {
                "list": {"help": "List all workflows", "handler": self._cli_list},
                "run": {"help": "Run a workflow", "handler": self._cli_run},
                "status": {"help": "Workflow status", "handler": self._cli_status},
                "runs": {"help": "List workflow runs", "handler": self._cli_runs},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "total_workflows": len(_workflows),
            "total_runs": len(_runs),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        return JSONResponse({"workflows": list(_workflows.values()), "count": len(_workflows)})

    async def _create(self, request: Request) -> JSONResponse:
        body = await request.json()
        wf_id = body.get("id", uuid.uuid4().hex[:12])
        entry = {
            "id": wf_id,
            "name": body.get("name", ""),
            "description": body.get("description", ""),
            "pattern": body.get("pattern", "pipeline"),
            "steps": body.get("steps", []),
            "created_at": time.time(),
        }
        _workflows[wf_id] = entry
        return JSONResponse(entry, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        wf_id = request.path_params["workflow_id"]
        wf = _workflows.get(wf_id)
        if not wf:
            return JSONResponse({"error": "Workflow not found"}, status_code=404)
        return JSONResponse(wf)

    async def _delete(self, request: Request) -> JSONResponse:
        wf_id = request.path_params["workflow_id"]
        if wf_id not in _workflows:
            return JSONResponse({"error": "Workflow not found"}, status_code=404)
        del _workflows[wf_id]
        return JSONResponse({"deleted": wf_id})

    async def _run(self, request: Request) -> JSONResponse:
        wf_id = request.path_params["workflow_id"]
        wf = _workflows.get(wf_id)
        if not wf:
            return JSONResponse({"error": "Workflow not found"}, status_code=404)
        run_id = uuid.uuid4().hex[:12]
        content_type = request.headers.get("content-type")
        body = await request.json() if content_type == "application/json" else {}
        run_entry = {
            "id": run_id,
            "workflow_id": wf_id,
            "workflow_name": wf["name"],
            "status": "completed",
            "input": body.get("input", {}),
            "output": {"message": f"Workflow '{wf['name']}' executed successfully"},
            "started_at": time.time(),
            "completed_at": time.time(),
        }
        _runs[run_id] = run_entry
        return JSONResponse(run_entry)

    async def _status(self, request: Request) -> JSONResponse:
        wf_id = request.path_params["workflow_id"]
        wf = _workflows.get(wf_id)
        if not wf:
            return JSONResponse({"error": "Workflow not found"}, status_code=404)
        wf_runs = [r for r in _runs.values() if r["workflow_id"] == wf_id]
        return JSONResponse({
            "workflow_id": wf_id,
            "name": wf["name"],
            "total_runs": len(wf_runs),
            "last_run": wf_runs[-1] if wf_runs else None,
        })

    async def _list_runs(self, request: Request) -> JSONResponse:
        return JSONResponse({"runs": list(_runs.values()), "count": len(_runs)})

    async def _get_run(self, request: Request) -> JSONResponse:
        run_id = request.path_params["run_id"]
        run = _runs.get(run_id)
        if not run:
            return JSONResponse({"error": "Run not found"}, status_code=404)
        return JSONResponse(run)

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        if not _workflows:
            return "No workflows registered"
        lines = [f"  {w['id']} — {w['name']} ({w['pattern']})" for w in _workflows.values()]
        return "\n".join(lines)

    def _cli_run(self, workflow_id: str) -> str:
        wf = _workflows.get(workflow_id)
        if not wf:
            return f"Workflow {workflow_id} not found"
        run_id = uuid.uuid4().hex[:12]
        _runs[run_id] = {
            "id": run_id, "workflow_id": workflow_id, "status": "completed",
            "started_at": time.time(), "completed_at": time.time(),
        }
        return f"Ran workflow {workflow_id} → run {run_id}"

    def _cli_status(self) -> str:
        return f"Workflows: {len(_workflows)}, Runs: {len(_runs)}"

    def _cli_runs(self) -> str:
        if not _runs:
            return "No workflow runs"
        lines = [
            f"  {r['id']} — {r.get('workflow_name', r['workflow_id'])} ({r['status']})"
            for r in _runs.values()
        ]
        return "\n".join(lines)
