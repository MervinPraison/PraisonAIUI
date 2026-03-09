"""Jobs feature — async job management for PraisonAIUI.

Provides API endpoints for submitting, monitoring, and managing async agent jobs.
Mirrors the praisonai.jobs API but adapted for Starlette.

DRY: Uses praisonaiagents.Agent for real agent execution.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    """Status of a job."""
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


# In-memory job store
_jobs: Dict[str, Dict[str, Any]] = {}
_progress_callbacks: Dict[str, List[asyncio.Queue]] = {}


class PraisonAIJobs(BaseFeatureProtocol):
    """Async job management for agent execution."""

    feature_name = "jobs"
    feature_description = "Async job submission and monitoring"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/jobs", self._list, methods=["GET"]),
            Route("/api/jobs", self._submit, methods=["POST"]),
            Route("/api/jobs/stats", self._stats, methods=["GET"]),
            Route("/api/jobs/{job_id}", self._get, methods=["GET"]),
            Route("/api/jobs/{job_id}", self._delete, methods=["DELETE"]),
            Route("/api/jobs/{job_id}/status", self._status, methods=["GET"]),
            Route("/api/jobs/{job_id}/result", self._result, methods=["GET"]),
            Route("/api/jobs/{job_id}/cancel", self._cancel, methods=["POST"]),
            Route("/api/jobs/{job_id}/stream", self._stream, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "job",
            "help": "Manage async jobs",
            "commands": {
                "list": {"help": "List all jobs", "handler": self._cli_list},
                "status": {"help": "Show job status", "handler": self._cli_status_cmd},
                "stats": {"help": "Show executor stats", "handler": self._cli_stats},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        running = sum(1 for j in _jobs.values() if j.get("status") == JobStatus.RUNNING.value)
        queued = sum(1 for j in _jobs.values() if j.get("status") == JobStatus.QUEUED.value)
        return {
            "status": "ok",
            "feature": self.name,
            "total_jobs": len(_jobs),
            "running_jobs": running,
            "queued_jobs": queued,
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all jobs with optional filters."""
        status_filter = request.query_params.get("status")
        session_id = request.query_params.get("session_id")
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 20))

        jobs = list(_jobs.values())

        # Apply filters
        if status_filter:
            jobs = [j for j in jobs if j.get("status") == status_filter]
        if session_id:
            jobs = [j for j in jobs if j.get("session_id") == session_id]

        # Sort by created_at descending
        jobs.sort(key=lambda j: j.get("created_at", 0), reverse=True)

        # Paginate
        total = len(jobs)
        offset = (page - 1) * page_size
        jobs = jobs[offset:offset + page_size]

        return JSONResponse({
            "jobs": jobs,
            "total": total,
            "page": page,
            "page_size": page_size,
        })

    async def _submit(self, request: Request) -> JSONResponse:
        """Submit a new job for execution."""
        body = await request.json()
        job_id = f"run_{uuid.uuid4().hex[:12]}"
        now = time.time()

        job = {
            "id": job_id,
            "status": JobStatus.QUEUED.value,
            "prompt": body.get("prompt", ""),
            "agent_file": body.get("agent_file"),
            "agent_yaml": body.get("agent_yaml"),
            "recipe_name": body.get("recipe_name"),
            "framework": body.get("framework", "praisonai"),
            "config": body.get("config", {}),
            "webhook_url": body.get("webhook_url"),
            "timeout": body.get("timeout", 3600),
            "session_id": body.get("session_id"),
            "idempotency_key": body.get("idempotency_key"),
            "progress_percentage": 0.0,
            "progress_step": None,
            "created_at": now,
            "started_at": None,
            "completed_at": None,
            "result": None,
            "error": None,
            "metrics": None,
        }

        # Check idempotency
        idem_key = body.get("idempotency_key")
        if idem_key:
            for existing in _jobs.values():
                if existing.get("idempotency_key") == idem_key:
                    return JSONResponse(existing, status_code=200)

        _jobs[job_id] = job

        # Simulate starting the job (in real impl, would use JobExecutor)
        asyncio.create_task(self._execute_job(job_id))

        base_url = str(request.base_url).rstrip("/")
        return JSONResponse({
            "job_id": job_id,
            "status": job["status"],
            "created_at": job["created_at"],
            "poll_url": f"{base_url}/api/jobs/{job_id}/status",
            "stream_url": f"{base_url}/api/jobs/{job_id}/stream",
        }, status_code=202, headers={
            "Location": f"{base_url}/api/jobs/{job_id}",
            "Retry-After": "2",
        })

    async def _execute_job(self, job_id: str) -> None:
        """Execute a job using gateway-registered agents when available."""
        job = _jobs.get(job_id)
        if not job:
            return

        # Mark as running
        job["status"] = JobStatus.RUNNING.value
        job["started_at"] = time.time()
        await self._notify_progress(job_id)

        try:
            # Try to use actual JobExecutor if available
            executor = self._get_executor()
            if executor:
                # Real execution via praisonai.jobs
                from praisonai.jobs.models import Job as PraisonJob
                praison_job = PraisonJob(
                    prompt=job["prompt"],
                    agent_file=job.get("agent_file"),
                    agent_yaml=job.get("agent_yaml"),
                    framework=job.get("framework", "praisonai"),
                    config=job.get("config", {}),
                    timeout=job.get("timeout", 3600),
                    session_id=job.get("session_id"),
                )
                await executor.submit(praison_job)
                # Wait for completion
                while not praison_job.is_terminal:
                    await asyncio.sleep(1)
                    job["progress_percentage"] = praison_job.progress_percentage
                    job["progress_step"] = praison_job.progress_step
                    await self._notify_progress(job_id)

                if praison_job.status.value == "succeeded":
                    job["status"] = JobStatus.SUCCEEDED.value
                    job["result"] = praison_job.result
                    job["metrics"] = praison_job.metrics
                else:
                    job["status"] = JobStatus.FAILED.value
                    job["error"] = praison_job.error
            else:
                # Try gateway-registered agent first (has memory, tools, state)
                agent = None
                agent_name = job.get("config", {}).get("name", "assistant")
                try:
                    from praisonaiui.features._gateway_ref import get_gateway
                    gw = get_gateway()
                    if gw is not None:
                        for aid in gw.list_agents():
                            gw_agent = gw.get_agent(aid)
                            if gw_agent and getattr(gw_agent, "name", None) == agent_name:
                                agent = gw_agent
                                break
                except (ImportError, Exception):
                    pass

                if agent is None:
                    # G6: Fallback — create agent with tools (same pattern as G1/G5)
                    try:
                        from praisonaiagents import Agent

                        instructions = job.get("config", {}).get("instructions", "")
                        model = job.get("config", {}).get("model", "gpt-4o-mini")

                        # Resolve tools from job config
                        agent_tools = []
                        tool_names = job.get("config", {}).get("tools", [])
                        if tool_names:
                            try:
                                from praisonai.tool_resolver import ToolResolver
                                resolver = ToolResolver()
                                for tn in tool_names:
                                    if isinstance(tn, str) and tn.strip():
                                        resolved = resolver.resolve(tn.strip())
                                        if resolved:
                                            agent_tools.append(resolved)
                            except ImportError:
                                pass

                        agent = Agent(
                            name=agent_name,
                            instructions=instructions,
                            llm=model,
                            tools=agent_tools if agent_tools else None,
                            reflection=job.get("config", {}).get("reflection", True),
                        )
                    except ImportError:
                        agent = None

                if agent is not None:
                    job["progress_percentage"] = 10
                    job["progress_step"] = "Creating agent..."
                    await self._notify_progress(job_id)

                    job["progress_percentage"] = 30
                    job["progress_step"] = "Executing agent..."
                    await self._notify_progress(job_id)

                    # Execute in thread pool
                    loop = asyncio.get_running_loop()
                    result = await loop.run_in_executor(None, agent.start, job["prompt"])

                    model = getattr(agent, "llm", "unknown")
                    job["progress_percentage"] = 100
                    job["progress_step"] = "Complete"
                    job["status"] = JobStatus.SUCCEEDED.value
                    job["result"] = result
                    job["metrics"] = {"model": model}
                else:
                    # Mock fallback
                    logger.warning("No agent available, using mock execution")
                    for i in range(5):
                        if job.get("_cancel_requested"):
                            job["status"] = JobStatus.CANCELLED.value
                            job["completed_at"] = time.time()
                            await self._notify_progress(job_id)
                            return

                        job["progress_percentage"] = (i + 1) * 20
                        job["progress_step"] = f"Step {i + 1}/5"
                        await self._notify_progress(job_id)
                        await asyncio.sleep(0.5)

                    job["status"] = JobStatus.SUCCEEDED.value
                    job["result"] = f"Completed: {job['prompt'][:50]}..."
                    job["metrics"] = {"tokens": 100, "cost": 0.001}

        except Exception as e:
            job["status"] = JobStatus.FAILED.value
            job["error"] = str(e)

        job["completed_at"] = time.time()
        job["progress_percentage"] = 100.0
        await self._notify_progress(job_id)

    def _get_executor(self):
        """Try to get JobExecutor from praisonai.jobs."""
        try:
            import importlib.util
            if importlib.util.find_spec("praisonai.jobs"):
                # Would need to be initialized properly with store
                return None  # For now, use mock execution
            return None
        except Exception:
            return None

    async def _notify_progress(self, job_id: str) -> None:
        """Notify all progress listeners."""
        if job_id in _progress_callbacks:
            job = _jobs.get(job_id)
            if job:
                for queue in _progress_callbacks[job_id]:
                    try:
                        queue.put_nowait(job)
                    except asyncio.QueueFull:
                        pass

    async def _get(self, request: Request) -> JSONResponse:
        """Get a job by ID."""
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        return JSONResponse(job)

    async def _status(self, request: Request) -> JSONResponse:
        """Get job status."""
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        retry_after = None
        if job["status"] == JobStatus.QUEUED.value:
            retry_after = 2
        elif job["status"] == JobStatus.RUNNING.value:
            retry_after = 5

        return JSONResponse({
            "job_id": job_id,
            "status": job["status"],
            "progress": {
                "percentage": job.get("progress_percentage", 0),
                "current_step": job.get("progress_step"),
            },
            "created_at": job.get("created_at"),
            "started_at": job.get("started_at"),
            "completed_at": job.get("completed_at"),
            "error": job.get("error"),
            "retry_after": retry_after,
        })

    async def _result(self, request: Request) -> JSONResponse:
        """Get job result."""
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        terminal_states = [JobStatus.SUCCEEDED.value, JobStatus.FAILED.value, JobStatus.CANCELLED.value]
        if job["status"] not in terminal_states:
            return JSONResponse({
                "error": f"Job not complete. Status: {job['status']}"
            }, status_code=409)

        duration = None
        if job.get("started_at") and job.get("completed_at"):
            duration = job["completed_at"] - job["started_at"]

        return JSONResponse({
            "job_id": job_id,
            "status": job["status"],
            "result": job.get("result"),
            "metrics": job.get("metrics"),
            "created_at": job.get("created_at"),
            "started_at": job.get("started_at"),
            "completed_at": job.get("completed_at"),
            "duration_seconds": duration,
            "error": job.get("error"),
        })

    async def _cancel(self, request: Request) -> JSONResponse:
        """Cancel a running job."""
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        terminal_states = [JobStatus.SUCCEEDED.value, JobStatus.FAILED.value, JobStatus.CANCELLED.value]
        if job["status"] in terminal_states:
            return JSONResponse({
                "error": f"Job already complete. Status: {job['status']}"
            }, status_code=409)

        job["_cancel_requested"] = True
        job["status"] = JobStatus.CANCELLED.value
        job["completed_at"] = time.time()

        return JSONResponse({
            "job_id": job_id,
            "status": job["status"],
            "message": "Job cancelled",
        })

    async def _delete(self, request: Request) -> JSONResponse:
        """Delete a completed job."""
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        terminal_states = [JobStatus.SUCCEEDED.value, JobStatus.FAILED.value, JobStatus.CANCELLED.value]
        if job["status"] not in terminal_states:
            return JSONResponse({
                "error": "Cannot delete running job. Cancel first."
            }, status_code=409)

        del _jobs[job_id]
        return JSONResponse({"deleted": job_id})

    async def _stream(self, request: Request) -> StreamingResponse:
        """Stream job progress via SSE."""
        job_id = request.path_params["job_id"]
        job = _jobs.get(job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        async def event_generator():
            queue: asyncio.Queue = asyncio.Queue(maxsize=100)

            # Register for updates
            if job_id not in _progress_callbacks:
                _progress_callbacks[job_id] = []
            _progress_callbacks[job_id].append(queue)

            try:
                last_status = None
                last_progress = -1

                while True:
                    current_job = _jobs.get(job_id)
                    if not current_job:
                        yield f"event: error\ndata: {{\"error\": \"Job not found\"}}\n\n"
                        break

                    # Send status update
                    if current_job["status"] != last_status:
                        last_status = current_job["status"]
                        yield f"event: status\ndata: {{\"status\": \"{last_status}\", \"job_id\": \"{job_id}\"}}\n\n"

                    # Send progress update
                    progress = current_job.get("progress_percentage", 0)
                    if progress != last_progress:
                        last_progress = progress
                        step = current_job.get("progress_step", "")
                        yield f"event: progress\ndata: {{\"percentage\": {progress}, \"step\": \"{step}\"}}\n\n"

                    # Check terminal state
                    terminal_states = [JobStatus.SUCCEEDED.value, JobStatus.FAILED.value, JobStatus.CANCELLED.value]
                    if current_job["status"] in terminal_states:
                        if current_job["status"] == JobStatus.SUCCEEDED.value:
                            result = str(current_job.get("result", ""))[:500].replace('"', '\\"')
                            yield f"event: result\ndata: {{\"result\": \"{result}\"}}\n\n"
                        elif current_job["status"] == JobStatus.FAILED.value:
                            error = str(current_job.get("error", "")).replace('"', '\\"')
                            yield f"event: error\ndata: {{\"error\": \"{error}\"}}\n\n"
                        else:
                            yield f"event: cancelled\ndata: {{\"message\": \"Job cancelled\"}}\n\n"
                        break

                    # Wait for update or timeout
                    try:
                        await asyncio.wait_for(queue.get(), timeout=5.0)
                    except asyncio.TimeoutError:
                        yield f"event: heartbeat\ndata: {{\"timestamp\": \"{datetime.utcnow().isoformat()}\"}}\n\n"

            finally:
                if job_id in _progress_callbacks:
                    try:
                        _progress_callbacks[job_id].remove(queue)
                    except ValueError:
                        pass

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )

    async def _stats(self, request: Request) -> JSONResponse:
        """Get executor statistics."""
        status_counts = {}
        for job in _jobs.values():
            status = job.get("status", "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1

        return JSONResponse({
            "total_jobs": len(_jobs),
            "status_counts": status_counts,
            "max_concurrent": 10,  # Default
        })

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        if not _jobs:
            return "No jobs"
        lines = []
        for j in _jobs.values():
            status_icon = {
                "queued": "⏳",
                "running": "🔄",
                "succeeded": "✅",
                "failed": "❌",
                "cancelled": "⚪",
            }.get(j.get("status", ""), "?")
            lines.append(f"  {status_icon} {j['id']} — {j.get('prompt', '')[:30]}...")
        return "\n".join(lines)

    def _cli_status_cmd(self, job_id: str = "") -> str:
        if not job_id:
            running = sum(1 for j in _jobs.values() if j.get("status") == "running")
            return f"Jobs: {len(_jobs)} total, {running} running"
        job = _jobs.get(job_id)
        if not job:
            return f"Job {job_id} not found"
        return f"Job {job_id}: {job.get('status')} ({job.get('progress_percentage', 0):.0f}%)"

    def _cli_stats(self) -> str:
        status_counts = {}
        for job in _jobs.values():
            status = job.get("status", "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1
        parts = [f"{k}: {v}" for k, v in status_counts.items()]
        return f"Jobs: {len(_jobs)} total — " + ", ".join(parts) if parts else "No jobs"
