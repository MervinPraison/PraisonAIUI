"""Jobs feature — protocol-driven async job management for PraisonAIUI.

Architecture:
    JobStoreProtocol (ABC)          <- any backend implements this
      ├── SimpleJobStore            <- default in-memory (no deps)
      └── SDKJobStore               <- wraps praisonai.jobs

    PraisonAIJobs (BaseFeatureProtocol)
      └── delegates to active JobStoreProtocol implementation
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

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


# ── Job Store Protocol ───────────────────────────────────────────────


class JobStoreProtocol(ABC):
    """Protocol interface for job storage backends."""

    @abstractmethod
    def get(self, job_id: str) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def list_all(self) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def save(self, job: Dict[str, Any]) -> None: ...

    @abstractmethod
    def delete(self, job_id: str) -> bool: ...

    @abstractmethod
    def stats(self) -> Dict[str, Any]: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


class SimpleJobStore(JobStoreProtocol):
    """In-memory job store — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._jobs: Dict[str, Dict[str, Any]] = {}

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._jobs.get(job_id)

    def list_all(self) -> List[Dict[str, Any]]:
        return list(self._jobs.values())

    def save(self, job: Dict[str, Any]) -> None:
        self._jobs[job["id"]] = job

    def delete(self, job_id: str) -> bool:
        if job_id in self._jobs:
            del self._jobs[job_id]
            return True
        return False

    def stats(self) -> Dict[str, Any]:
        status_counts: Dict[str, int] = {}
        for job in self._jobs.values():
            s = job.get("status", "unknown")
            status_counts[s] = status_counts.get(s, 0) + 1
        return {"total_jobs": len(self._jobs), "status_counts": status_counts}

    def health(self) -> Dict[str, Any]:
        running = sum(1 for j in self._jobs.values() if j.get("status") == JobStatus.RUNNING.value)
        queued = sum(1 for j in self._jobs.values() if j.get("status") == JobStatus.QUEUED.value)
        return {
            "status": "ok",
            "provider": "SimpleJobStore",
            "total_jobs": len(self._jobs),
            "running_jobs": running,
            "queued_jobs": queued,
        }


class SDKJobStore(JobStoreProtocol):
    """Uses praisonai.jobs store when the package is installed."""

    def __init__(self) -> None:
        from praisonaiui.backends import get_jobs_store_factory

        factory = get_jobs_store_factory()
        if factory is not None:
            self._sdk = factory()
            logger.info("SDKJobStore initialized (injected jobs_store backend)")
            return
        from praisonai.jobs.server import get_store

        self._sdk = get_store()
        logger.info("SDKJobStore initialized (praisonai.jobs store)")

    @staticmethod
    def _parse_sdk_status(status: Optional[str]) -> Any:
        if not status:
            return None
        from praisonai.jobs.models import JobStatus as SdkStatus

        try:
            return SdkStatus(status)
        except ValueError:
            return None

    @staticmethod
    def _ts_to_float(value: Any) -> Any:
        if value is None:
            return None
        if hasattr(value, "timestamp"):
            return value.timestamp()
        return value

    @staticmethod
    def _float_to_dt(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        return value

    @classmethod
    def _job_to_dict(cls, job: Any) -> Dict[str, Any]:
        return {
            "id": job.id,
            "job_id": job.id,
            "status": job.status.value if hasattr(job.status, "value") else job.status,
            "prompt": job.prompt,
            "agent_file": job.agent_file,
            "agent_yaml": job.agent_yaml,
            "recipe_name": job.recipe_name,
            "framework": job.framework,
            "config": job.config or {},
            "webhook_url": job.webhook_url,
            "timeout": job.timeout,
            "session_id": job.session_id,
            "idempotency_key": job.idempotency_key,
            "progress_percentage": getattr(job, "progress_percentage", 0.0),
            "progress_step": getattr(job, "progress_step", None),
            "created_at": cls._ts_to_float(job.created_at),
            "started_at": cls._ts_to_float(job.started_at),
            "completed_at": cls._ts_to_float(job.completed_at),
            "result": job.result,
            "error": job.error,
            "metrics": job.metrics,
        }

    @classmethod
    def _dict_to_job(cls, job: Dict[str, Any]) -> Any:
        from praisonai.jobs.models import Job as SdkJob
        from praisonai.jobs.models import JobStatus as SdkStatus

        status = job.get("status", JobStatus.QUEUED.value)
        if isinstance(status, str):
            status = SdkStatus(status)

        return SdkJob(
            id=job.get("id") or job.get("job_id") or f"run_{uuid.uuid4().hex[:12]}",
            status=status,
            prompt=job.get("prompt", ""),
            agent_file=job.get("agent_file"),
            agent_yaml=job.get("agent_yaml"),
            recipe_name=job.get("recipe_name"),
            framework=job.get("framework", "praisonai"),
            config=job.get("config") or {},
            webhook_url=job.get("webhook_url"),
            timeout=job.get("timeout", 3600),
            session_id=job.get("session_id"),
            idempotency_key=job.get("idempotency_key"),
            progress_percentage=job.get("progress_percentage", 0.0),
            progress_step=job.get("progress_step"),
            created_at=cls._float_to_dt(job.get("created_at")) or datetime.now(timezone.utc),
            started_at=cls._float_to_dt(job.get("started_at")),
            completed_at=cls._float_to_dt(job.get("completed_at")),
            result=job.get("result"),
            error=job.get("error"),
            metrics=job.get("metrics"),
        )

    async def get_job_async(self, job_id: str) -> Optional[Dict[str, Any]]:
        job = await self._sdk.get(job_id)
        return self._job_to_dict(job) if job else None

    async def get_by_idempotency_key_async(self, key: str) -> Optional[Dict[str, Any]]:
        job = await self._sdk.get_by_idempotency_key(key)
        return self._job_to_dict(job) if job else None

    async def save_job_async(self, job: Dict[str, Any]) -> None:
        await self._sdk.save(self._dict_to_job(job))

    async def delete_job_async(self, job_id: str) -> bool:
        return await self._sdk.delete(job_id)

    async def list_jobs_async(
        self,
        *,
        status: Optional[str] = None,
        session_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        st = self._parse_sdk_status(status)
        jobs = await self._sdk.list_jobs(status=st, session_id=session_id, limit=limit, offset=offset)
        return [self._job_to_dict(j) for j in jobs]

    async def count_jobs_async(
        self,
        *,
        status: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> int:
        st = self._parse_sdk_status(status)
        return await self._sdk.count(status=st, session_id=session_id)

    async def stats_async(self) -> Dict[str, Any]:
        if hasattr(self._sdk, "get_stats"):
            raw = await self._sdk.get_stats()
            raw["provider"] = "SDKJobStore"
            raw["sdk_available"] = True
            return raw
        total = await self.count_jobs_async()
        return {"provider": "SDKJobStore", "sdk_available": True, "total_jobs": total}

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        return _run_store_coro(self.get_job_async(job_id))

    def list_all(self) -> List[Dict[str, Any]]:
        return _run_store_coro(self.list_jobs_async(limit=10000))

    def save(self, job: Dict[str, Any]) -> None:
        _run_store_coro(self.save_job_async(job))

    def delete(self, job_id: str) -> bool:
        return _run_store_coro(self.delete_job_async(job_id))

    def stats(self) -> Dict[str, Any]:
        return _run_store_coro(self.stats_async())

    def health(self) -> Dict[str, Any]:
        h = self.stats()
        h["status"] = "ok"
        return h


# ── Store singleton ──────────────────────────────────────────────────

_job_store: Optional[JobStoreProtocol] = None
_progress_callbacks: Dict[str, List[asyncio.Queue]] = {}


def get_job_store() -> JobStoreProtocol:
    """Get the active job store (SDK-first, fallback to Simple)."""
    global _job_store
    if _job_store is None:
        try:
            _job_store = SDKJobStore()
            logger.info("Using SDKJobStore")
        except Exception as e:
            logger.debug("SDKJobStore init failed (%s), using SimpleJobStore", e)
            _job_store = SimpleJobStore()
    return _job_store


def _run_store_coro(coro: Any) -> Any:
    """Run an async store call from sync contexts (CLI)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    raise RuntimeError("Sync job store access from async context; use store_* helpers")


async def _store_get(store: JobStoreProtocol, job_id: str) -> Optional[Dict[str, Any]]:
    if hasattr(store, "get_job_async"):
        return await store.get_job_async(job_id)
    return store.get(job_id)


async def _store_save(store: JobStoreProtocol, job: Dict[str, Any]) -> None:
    if hasattr(store, "save_job_async"):
        await store.save_job_async(job)
    else:
        store.save(job)


async def _store_delete(store: JobStoreProtocol, job_id: str) -> bool:
    if hasattr(store, "delete_job_async"):
        return await store.delete_job_async(job_id)
    return store.delete(job_id)


async def _store_count(
    store: JobStoreProtocol,
    *,
    status: Optional[str] = None,
    session_id: Optional[str] = None,
) -> int:
    if hasattr(store, "count_jobs_async"):
        return await store.count_jobs_async(status=status, session_id=session_id)
    jobs = store.list_all()
    if status:
        jobs = [j for j in jobs if j.get("status") == status]
    if session_id:
        jobs = [j for j in jobs if j.get("session_id") == session_id]
    return len(jobs)


async def _store_stats(store: JobStoreProtocol) -> Dict[str, Any]:
    if hasattr(store, "stats_async"):
        return await store.stats_async()
    return store.stats()


class JobsFeature(BaseFeatureProtocol):
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
            Route("/api/jobs/board", self._board, methods=["GET"]),
            Route("/api/jobs/{job_id}", self._get, methods=["GET"]),
            Route("/api/jobs/{job_id}", self._delete, methods=["DELETE"]),
            Route("/api/jobs/{job_id}/status", self._status, methods=["GET"]),
            Route("/api/jobs/{job_id}/result", self._result, methods=["GET"]),
            Route("/api/jobs/{job_id}/cancel", self._cancel, methods=["POST"]),
            Route("/api/jobs/{job_id}/stream", self._stream, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "job",
                "help": "Manage async jobs",
                "commands": {
                    "list": {"help": "List all jobs", "handler": self._cli_list},
                    "status": {"help": "Show job status", "handler": self._cli_status_cmd},
                    "stats": {"help": "Show executor stats", "handler": self._cli_stats},
                },
            }
        ]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        store = get_job_store()
        store_health = await _store_stats(store)
        return {
            "status": "ok",
            "feature": self.name,
            **store_health,
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all jobs with optional filters."""
        store = get_job_store()
        status_filter = request.query_params.get("status")
        session_id = request.query_params.get("session_id")
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 20))

        if hasattr(store, "list_jobs_async"):
            offset = (page - 1) * page_size
            jobs = await store.list_jobs_async(
                status=status_filter,
                session_id=session_id,
                limit=page_size,
                offset=offset,
            )
            total = await _store_count(
                store,
                status=status_filter,
                session_id=session_id,
            )
        else:
            jobs = store.list_all()

            if status_filter:
                jobs = [j for j in jobs if j.get("status") == status_filter]
            if session_id:
                jobs = [j for j in jobs if j.get("session_id") == session_id]

            jobs.sort(key=lambda j: j.get("created_at", 0), reverse=True)
            total = len(jobs)
            offset = (page - 1) * page_size
            jobs = jobs[offset : offset + page_size]

        return JSONResponse(
            {
                "jobs": jobs,
                "total": total,
                "page": page,
                "page_size": page_size,
            }
        )

    async def _board(self, request: Request) -> JSONResponse:
        """Kanban-style column layout from job statuses."""
        store = get_job_store()
        if hasattr(store, "list_jobs_async"):
            jobs = await store.list_jobs_async(limit=10000)
        else:
            jobs = store.list_all()
        cols = ["queued", "running", "succeeded", "failed", "cancelled"]
        columns = []
        for col_id in cols:
            cards = []
            for job in jobs:
                if job.get("status") != col_id:
                    continue
                title = (job.get("prompt") or job.get("id") or "Job")[:80]
                cards.append(
                    {
                        "id": job.get("id"),
                        "title": title,
                        "footer": job.get("status", col_id),
                        "status": col_id,
                    }
                )
            columns.append({"id": col_id, "title": col_id.replace("_", " ").title(), "cards": cards})
        return JSONResponse({"board": "jobs", "columns": columns, "tasks_total": len(jobs)})

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

        store = get_job_store()

        # Check idempotency
        idem_key = body.get("idempotency_key")
        if idem_key:
            if hasattr(store, "get_by_idempotency_key_async"):
                existing = await store.get_by_idempotency_key_async(idem_key)
                if existing:
                    return JSONResponse(existing, status_code=200)
            else:
                for existing in store.list_all():
                    if existing.get("idempotency_key") == idem_key:
                        return JSONResponse(existing, status_code=200)

        await _store_save(store, job)

        # Start execution
        asyncio.create_task(self._execute_job(job_id))

        base_url = str(request.base_url).rstrip("/")
        return JSONResponse(
            {
                "job_id": job_id,
                "status": job["status"],
                "created_at": job["created_at"],
                "poll_url": f"{base_url}/api/jobs/{job_id}/status",
                "stream_url": f"{base_url}/api/jobs/{job_id}/stream",
            },
            status_code=202,
            headers={
                "Location": f"{base_url}/api/jobs/{job_id}",
                "Retry-After": "2",
            },
        )

    async def _execute_job(self, job_id: str) -> None:
        """Execute a job using gateway-registered agents when available."""
        store = get_job_store()
        job = await _store_get(store, job_id)
        if not job:
            return

        # Mark as running
        job["status"] = JobStatus.RUNNING.value
        job["started_at"] = time.time()
        await _store_save(store, job)
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
                    await _store_save(store, job)
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
                        tool_names = job.get("config", {}).get("tools", [])
                        from praisonaiui.backends import resolve_tools

                        agent_tools = resolve_tools(tool_names) if tool_names else []
                        if tool_names and not agent_tools:
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
                            reflection=job.get("config", {}).get("reflection", False),
                        )
                    except ImportError:
                        agent = None

                if agent is not None:
                    job["progress_percentage"] = 10
                    job["progress_step"] = "Creating agent..."
                    await _store_save(store, job)
                    await self._notify_progress(job_id)

                    job["progress_percentage"] = 30
                    job["progress_step"] = "Executing agent..."
                    await _store_save(store, job)
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
                    from praisonaiui.backends import is_integrated_mode, resolve_tools

                    if is_integrated_mode():
                        job["status"] = JobStatus.FAILED.value
                        job["error"] = (
                            "Agent execution unavailable in integrated mode. "
                            "Install praisonaiagents and ensure the agent can be created."
                        )
                        job["completed_at"] = time.time()
                        await _store_save(store, job)
                        await self._notify_progress(job_id)
                        return

                    # Standalone mock fallback
                    logger.warning("No agent available, using mock execution")
                    for i in range(5):
                        if job.get("_cancel_requested"):
                            job["status"] = JobStatus.CANCELLED.value
                            job["completed_at"] = time.time()
                            await _store_save(store, job)
                            await self._notify_progress(job_id)
                            return

                        job["progress_percentage"] = (i + 1) * 20
                        job["progress_step"] = f"Step {i + 1}/5"
                        await _store_save(store, job)
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
        await _store_save(store, job)
        await self._notify_progress(job_id)

    def _get_executor(self):
        """Try to get JobExecutor from injected backend or praisonai.jobs."""
        try:
            if hasattr(self, "_sdk_executor"):
                return self._sdk_executor

            from praisonaiui.backends import get_jobs_executor_factory

            factory = get_jobs_executor_factory()
            if factory is not None:
                self._sdk_executor = factory()
                return self._sdk_executor

            from praisonai.jobs import JobExecutor
            from praisonai.jobs.store import InMemoryJobStore

            self._sdk_executor = JobExecutor(store=InMemoryJobStore())
            return self._sdk_executor
        except Exception:
            return None

    async def _notify_progress(self, job_id: str) -> None:
        """Notify all progress listeners."""
        if job_id in _progress_callbacks:
            job = await _store_get(get_job_store(), job_id)
            if job:
                for queue in _progress_callbacks[job_id]:
                    try:
                        queue.put_nowait(job)
                    except asyncio.QueueFull:
                        pass

    async def _get(self, request: Request) -> JSONResponse:
        """Get a job by ID."""
        job_id = request.path_params["job_id"]
        job = await _store_get(get_job_store(), job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        return JSONResponse(job)

    async def _status(self, request: Request) -> JSONResponse:
        """Get job status."""
        job_id = request.path_params["job_id"]
        job = await _store_get(get_job_store(), job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        retry_after = None
        if job["status"] == JobStatus.QUEUED.value:
            retry_after = 2
        elif job["status"] == JobStatus.RUNNING.value:
            retry_after = 5

        return JSONResponse(
            {
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
            }
        )

    async def _result(self, request: Request) -> JSONResponse:
        """Get job result."""
        job_id = request.path_params["job_id"]
        job = await _store_get(get_job_store(), job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        terminal_states = [
            JobStatus.SUCCEEDED.value,
            JobStatus.FAILED.value,
            JobStatus.CANCELLED.value,
        ]
        if job["status"] not in terminal_states:
            return JSONResponse(
                {"error": f"Job not complete. Status: {job['status']}"}, status_code=409
            )

        duration = None
        if job.get("started_at") and job.get("completed_at"):
            duration = job["completed_at"] - job["started_at"]

        return JSONResponse(
            {
                "job_id": job_id,
                "status": job["status"],
                "result": job.get("result"),
                "metrics": job.get("metrics"),
                "created_at": job.get("created_at"),
                "started_at": job.get("started_at"),
                "completed_at": job.get("completed_at"),
                "duration_seconds": duration,
                "error": job.get("error"),
            }
        )

    async def _cancel(self, request: Request) -> JSONResponse:
        """Cancel a running job."""
        job_id = request.path_params["job_id"]
        store = get_job_store()
        job = await _store_get(store, job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        terminal_states = [
            JobStatus.SUCCEEDED.value,
            JobStatus.FAILED.value,
            JobStatus.CANCELLED.value,
        ]
        if job["status"] in terminal_states:
            return JSONResponse(
                {"error": f"Job already complete. Status: {job['status']}"}, status_code=409
            )

        job["_cancel_requested"] = True
        job["status"] = JobStatus.CANCELLED.value
        job["completed_at"] = time.time()
        await _store_save(store, job)

        return JSONResponse(
            {
                "job_id": job_id,
                "status": job["status"],
                "message": "Job cancelled",
            }
        )

    async def _delete(self, request: Request) -> JSONResponse:
        """Delete a completed job."""
        store = get_job_store()
        job_id = request.path_params["job_id"]
        job = await _store_get(store, job_id)
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)

        terminal_states = [
            JobStatus.SUCCEEDED.value,
            JobStatus.FAILED.value,
            JobStatus.CANCELLED.value,
        ]
        if job["status"] not in terminal_states:
            return JSONResponse(
                {"error": "Cannot delete running job. Cancel first."}, status_code=409
            )

        await _store_delete(store, job_id)
        return JSONResponse({"deleted": job_id})

    async def _stream(self, request: Request) -> StreamingResponse:
        """Stream job progress via SSE."""
        job_id = request.path_params["job_id"]
        job = await _store_get(get_job_store(), job_id)
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
                    current_job = await _store_get(get_job_store(), job_id)
                    if not current_job:
                        yield 'event: error\ndata: {"error": "Job not found"}\n\n'
                        break

                    # Send status update
                    if current_job["status"] != last_status:
                        last_status = current_job["status"]
                        yield f'event: status\ndata: {{"status": "{last_status}", "job_id": "{job_id}"}}\n\n'

                    # Send progress update
                    progress = current_job.get("progress_percentage", 0)
                    if progress != last_progress:
                        last_progress = progress
                        step = current_job.get("progress_step", "")
                        yield f'event: progress\ndata: {{"percentage": {progress}, "step": "{step}"}}\n\n'

                    # Check terminal state
                    terminal_states = [
                        JobStatus.SUCCEEDED.value,
                        JobStatus.FAILED.value,
                        JobStatus.CANCELLED.value,
                    ]
                    if current_job["status"] in terminal_states:
                        if current_job["status"] == JobStatus.SUCCEEDED.value:
                            result = str(current_job.get("result", ""))[:500].replace('"', '\\"')
                            yield f'event: result\ndata: {{"result": "{result}"}}\n\n'
                        elif current_job["status"] == JobStatus.FAILED.value:
                            error = str(current_job.get("error", "")).replace('"', '\\"')
                            yield f'event: error\ndata: {{"error": "{error}"}}\n\n'
                        else:
                            yield 'event: cancelled\ndata: {"message": "Job cancelled"}\n\n'
                        break

                    # Wait for update or timeout
                    try:
                        await asyncio.wait_for(queue.get(), timeout=5.0)
                    except asyncio.TimeoutError:
                        yield f'event: heartbeat\ndata: {{"timestamp": "{datetime.utcnow().isoformat()}"}}\n\n'

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
            },
        )

    async def _stats(self, request: Request) -> JSONResponse:
        """Get executor statistics."""
        store = get_job_store()
        s = await _store_stats(store)
        s["max_concurrent"] = 10
        return JSONResponse(s)

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        store = get_job_store()
        jobs = store.list_all()
        if not jobs:
            return "No jobs"
        lines = []
        for j in jobs:
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
        store = get_job_store()
        if not job_id:
            s = store.stats()
            return f"Jobs: {s['total_jobs']} total, {s['status_counts'].get('running', 0)} running"
        job = store.get(job_id)
        if not job:
            return f"Job {job_id} not found"
        return f"Job {job_id}: {job.get('status')} ({job.get('progress_percentage', 0):.0f}%)"

    def _cli_stats(self) -> str:
        store = get_job_store()
        s = store.stats()
        parts = [f"{k}: {v}" for k, v in s["status_counts"].items()]
        return f"Jobs: {s['total_jobs']} total — " + ", ".join(parts) if parts else "No jobs"


# Backward-compat alias
PraisonAIJobs = JobsFeature
