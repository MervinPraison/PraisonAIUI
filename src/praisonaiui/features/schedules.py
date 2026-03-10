"""Schedules feature — protocol-driven scheduled job management for PraisonAIUI.

Architecture:
    ScheduleProtocol (ABC)           <- any backend implements this
      ├── _InMemoryScheduleStore     <- default in-memory (no deps)
      └── praisonaiagents.scheduler  <- SDK FileScheduleStore

    PraisonAISchedules (BaseFeatureProtocol)
      └── delegates to active ScheduleProtocol implementation
"""

from __future__ import annotations

import logging
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Schedule Protocol ────────────────────────────────────────────────


class ScheduleProtocol(ABC):
    """Protocol interface for schedule backends."""

    @abstractmethod
    def add(self, job_id: str, schedule: str, action: str, **kwargs) -> Dict[str, Any]: ...

    @abstractmethod
    def get(self, job_id: str) -> Optional[Dict[str, Any]]: ...

    @abstractmethod
    def list(self) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def remove(self, job_id: str) -> bool: ...

    @abstractmethod
    def update(self, job_id: str, **kwargs) -> Optional[Dict[str, Any]]: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# Lazy-loaded schedule store from praisonaiagents
_schedule_store: Optional[ScheduleProtocol] = None

# In-memory run history (newest first, capped at 200)
_run_history: list = []


def _getattr_or_get(obj, key, default=None):
    """Get attribute from both dict and dataclass/pydantic objects."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)



def _get_schedule_store() -> ScheduleProtocol:
    """Lazy-load the praisonaiagents schedule store (DRY)."""
    global _schedule_store
    if _schedule_store is None:
        try:
            from praisonaiagents.scheduler import FileScheduleStore
            _schedule_store = FileScheduleStore()
            logger.info("Using praisonaiagents.scheduler.FileScheduleStore for persistence")
        except ImportError:
            logger.warning("praisonaiagents.scheduler not available, using in-memory fallback")
            _schedule_store = _InMemoryScheduleStore()
    return _schedule_store


# ── Background scheduler loop ────────────────────────────────────────

_scheduler_task: Optional[Any] = None  # asyncio.Task
_scheduler_running = False


def _is_job_due(job) -> bool:
    """Check if a job is due to run based on its schedule config."""
    if not _getattr_or_get(job, "enabled", True):
        return False
    schedule = _getattr_or_get(job, "schedule", {})
    if not isinstance(schedule, dict):
        return False

    now = time.time()
    last_run = _getattr_or_get(job, "last_run_at") or _getattr_or_get(job, "created_at", 0)

    # Interval-based: every_seconds
    every_seconds = schedule.get("every_seconds")
    if every_seconds and every_seconds > 0:
        return (now - last_run) >= every_seconds

    # Cron-based: cron_expr (requires croniter)
    cron_expr = schedule.get("cron_expr")
    if cron_expr:
        try:
            from croniter import croniter
            cron = croniter(cron_expr, last_run)
            next_run = cron.get_next(float)
            return now >= next_run
        except ImportError:
            logger.debug("croniter not installed — cron_expr scheduling unavailable")
        except Exception as e:
            logger.debug(f"Cron parse error for '{cron_expr}': {e}")

    return False


async def _get_agent_for_execution(job_id: str, agent_name: Optional[str] = None) -> tuple:
    """Get or create agent for job execution (DRY helper).
    
    Returns:
        tuple: (agent, gateway, error_message)
        - agent: The agent instance or None
        - gateway: The gateway instance or None
        - error_message: Error string if agent creation failed, else None
    """
    from praisonaiui.features._gateway_ref import get_gateway
    
    gw = get_gateway()
    agent = None
    error = None
    
    # Try gateway-registered agents first
    if gw is not None:
        for aid in gw.list_agents():
            gw_agent = gw.get_agent(aid)
            if agent_name and gw_agent and getattr(gw_agent, "name", None) == agent_name:
                agent = gw_agent
                break
        if agent is None:
            agent_ids = gw.list_agents()
            if agent_ids:
                agent = gw.get_agent(agent_ids[0])
    
    # Fallback: create agent via provider (same path as chat)
    if agent is None:
        try:
            from praisonaiui.server import get_provider
            provider = get_provider()
            agent = provider._get_or_create_agent(
                agent_name=agent_name,
                session_id=f"cron_{job_id}",
            )
            # Register with gateway for future calls
            if agent is not None and gw is not None:
                a_name = getattr(agent, "name", None) or "cron_agent"
                gw.register_agent(agent, agent_id=a_name)
        except Exception as prov_err:
            logger.debug("Provider agent fallback failed: %s", prov_err)
            error = str(prov_err)
    
    # Set error message if no agent found
    if agent is None and error is None:
        if gw is None:
            error = "No gateway available — agent provider not configured"
        else:
            error = f"No agent found for job '{job_id}'"
    
    return agent, gw, error


async def _execute_job(job_id: str, job) -> None:
    """Execute a scheduled job (same logic as _run endpoint)."""
    started_at = time.time()
    action = _getattr_or_get(job, "action", "") or _getattr_or_get(job, "message", "")
    agent_name = _getattr_or_get(job, "agent_name", None)
    result = None
    status = "succeeded"

    if action:
        try:
            agent, gw, error = await _get_agent_for_execution(job_id, agent_name)
            
            if agent is not None:
                import asyncio
                result = await asyncio.to_thread(agent.chat, action)
                result = str(result)
            else:
                status = "failed"
                result = error or f"No agent found to execute action: '{action}'"
        except (ImportError, Exception) as e:
            logger.warning("Scheduled job '%s' execution failed: %s", job_id, e)
            status = "failed"
            result = str(e)
    else:
        status = "skipped"
        result = "No action configured"

    # Update job metadata
    if hasattr(job, "last_run_at"):
        job.last_run_at = started_at
        store = _get_schedule_store()
        if hasattr(store, "update"):
            store.update(job)
    elif isinstance(job, dict):
        job["last_run_at"] = started_at
        job["run_count"] = job.get("run_count", 0) + 1

    duration = round(time.time() - started_at, 2)
    _run_history.insert(0, {
        "job_id": job_id,
        "name": _getattr_or_get(job, "name", ""),
        "action": action,
        "status": status,
        "result": result,
        "timestamp": started_at,
        "duration": duration,
        "auto": True,
    })
    if len(_run_history) > 200:
        _run_history[:] = _run_history[:200]
    logger.info("Auto-executed job '%s': %s (%.1fs)", job_id, status, duration)


async def _scheduler_loop() -> None:
    """Background loop that checks and triggers due jobs every 15s."""
    global _scheduler_running
    import asyncio
    _scheduler_running = True
    logger.info("Background scheduler started")
    try:
        while _scheduler_running:
            try:
                store = _get_schedule_store()
                jobs = store.list() if hasattr(store, "list") else []
                for j in jobs:
                    jid = _getattr_or_get(j, "id", "")
                    if jid and _is_job_due(j):
                        asyncio.create_task(_execute_job(jid, j))
            except Exception as e:
                logger.debug("Scheduler tick error: %s", e)
            await asyncio.sleep(15)
    except asyncio.CancelledError:
        pass
    finally:
        _scheduler_running = False
        logger.info("Background scheduler stopped")


def _ensure_scheduler_started() -> None:
    """Start the scheduler loop if not already running."""
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        return
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        _scheduler_task = loop.create_task(_scheduler_loop())
    except RuntimeError:
        pass  # no event loop — scheduler will start on first async call


def _create_schedule_job(job_dict: Dict[str, Any]):
    """Create a ScheduleJob from a dict, using praisonaiagents if available."""
    try:
        from praisonaiagents.scheduler import ScheduleJob, Schedule
        sched_data = job_dict.get("schedule", {})
        schedule = Schedule(
            kind=sched_data.get("kind", "every"),
            every_seconds=sched_data.get("every_seconds"),
            cron_expr=sched_data.get("cron_expr"),
            at=sched_data.get("at"),
        )
        return ScheduleJob(
            id=job_dict.get("id", uuid.uuid4().hex[:12]),
            name=job_dict.get("name", ""),
            schedule=schedule,
            message=job_dict.get("message", ""),
            agent_id=job_dict.get("agent_id"),
            session_target=job_dict.get("session_target", "isolated"),
            enabled=job_dict.get("enabled", True),
            delete_after_run=job_dict.get("delete_after_run", False),
        )
    except ImportError:
        return job_dict


def _to_dict(obj) -> Dict[str, Any]:
    """Convert dataclass/pydantic object to dict for JSON serialization."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, 'model_dump'):
        return obj.model_dump()
    if hasattr(obj, '__dataclass_fields__'):
        from dataclasses import asdict
        return asdict(obj)
    if hasattr(obj, '__dict__'):
        return vars(obj)
    return {"value": str(obj)}


class _InMemoryScheduleStore(ScheduleProtocol):
    """Fallback in-memory store with unified YAML persistence."""

    _SECTION = "schedules"

    def __init__(self):
        from ._persistence import load_section
        saved = load_section(self._SECTION)
        self._jobs: Dict[str, Dict[str, Any]] = saved.get("jobs", {}) if isinstance(saved, dict) else {}

    def _persist(self) -> None:
        from ._persistence import save_section
        save_section(self._SECTION, {"jobs": dict(self._jobs)})

    def add(self, job_id_or_obj=None, schedule=None, action=None, **kwargs) -> Dict[str, Any]:
        # Accept single dict/object (from _add handler) or positional args (from CLI)
        if schedule is None and action is None and job_id_or_obj is not None:
            # Single argument: treat as a job dict or dataclass
            if isinstance(job_id_or_obj, dict):
                obj = job_id_or_obj
            elif hasattr(job_id_or_obj, '__dict__'):
                obj = vars(job_id_or_obj)
            else:
                obj = {"id": str(job_id_or_obj)}
            jid = obj.get("id", f"j_{int(time.time())}")
            self._jobs[jid] = obj
            self._persist()
            return obj
        # Old positional-arg pattern
        job = {
            "id": job_id_or_obj or f"j_{int(time.time())}",
            "schedule": schedule,
            "action": action,
            "enabled": True,
            "created_at": time.time(),
            "last_run": None,
            "run_count": 0,
            **kwargs,
        }
        self._jobs[job["id"]] = job
        self._persist()
        return job

    def get(self, job_id: str) -> Dict[str, Any]:
        self._reload()
        return self._jobs.get(job_id)

    def list(self) -> List[Dict[str, Any]]:
        self._reload()
        return list(self._jobs.values())

    def _reload(self) -> None:
        """Reload from persistence to pick up external changes."""
        from ._persistence import load_section
        saved = load_section(self._SECTION)
        if isinstance(saved, dict):
            self._jobs = saved.get("jobs", {})

    def remove(self, job_id: str) -> bool:
        if job_id in self._jobs:
            del self._jobs[job_id]
            self._persist()
            return True
        return False

    def update(self, job_id: str, **kwargs) -> Dict[str, Any]:
        if job_id in self._jobs:
            self._jobs[job_id].update(kwargs)
            self._persist()
            return self._jobs[job_id]
        return None


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
            Route("/api/schedules/history", self._history, methods=["GET"]),
            Route("/api/schedules/{job_id}", self._get, methods=["GET"]),
            Route("/api/schedules/{job_id}", self._update, methods=["PUT"]),
            Route("/api/schedules/{job_id}", self._delete, methods=["DELETE"]),
            Route("/api/schedules/{job_id}/toggle", self._toggle, methods=["POST"]),
            Route("/api/schedules/{job_id}/run", self._run, methods=["POST"]),
            Route("/api/schedules/{job_id}/stop", self._stop, methods=["POST"]),
            Route("/api/schedules/{job_id}/stats", self._stats, methods=["GET"]),
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
        from ._gateway_helpers import gateway_health

        store = _get_schedule_store()
        jobs = store.list() if hasattr(store, 'list') else []
        enabled = sum(1 for j in jobs if _getattr_or_get(j, "enabled", True))
        return {
            "status": "ok",
            "feature": self.name,
            "total_jobs": len(jobs),
            "enabled_jobs": enabled,
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        _ensure_scheduler_started()
        store = _get_schedule_store()
        jobs_raw = store.list() if hasattr(store, 'list') else []
        jobs = [_to_dict(j) for j in jobs_raw]
        return JSONResponse({"schedules": jobs, "count": len(jobs)})

    async def _add(self, request: Request) -> JSONResponse:
        _ensure_scheduler_started()
        body = await request.json()
        job_id = uuid.uuid4().hex[:12]
        schedule = body.get("schedule", {})
        if not isinstance(schedule, dict):
            schedule = {"kind": "every", "every_seconds": 60}
        job = {
            "id": job_id,
            "name": body.get("name", ""),
            "schedule": {
                "kind": schedule.get("kind", "every"),
                "every_seconds": schedule.get("every_seconds"),
                "cron_expr": schedule.get("cron_expr"),
                "at": schedule.get("at"),
            },
            "action": body.get("action", "") or body.get("message", ""),
            "message": body.get("message", "") or body.get("action", ""),
            "agent_id": body.get("agent_id"),
            "agent_name": body.get("agent_name"),
            "channel": body.get("channel"),
            "session_target": body.get("session_target", "isolated"),
            "enabled": body.get("enabled", True),
            "delete_after_run": body.get("delete_after_run", False),
            "created_at": time.time(),
            "last_run_at": None,
            "run_count": 0,
        }
        store = _get_schedule_store()
        if hasattr(store, 'add'):
            schedule_job = _create_schedule_job(job)
            try:
                store.add(schedule_job)
            except Exception as e:
                logger.warning(f"Failed to add schedule to store: {e}")
        return JSONResponse(job, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        store = _get_schedule_store()
        job = store.get(job_id) if hasattr(store, 'get') else None
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        return JSONResponse(_to_dict(job))

    async def _delete(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        store = _get_schedule_store()
        if hasattr(store, 'remove'):
            if not store.remove(job_id):
                return JSONResponse({"error": "Job not found"}, status_code=404)
        return JSONResponse({"deleted": job_id})

    async def _toggle(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        store = _get_schedule_store()
        job = store.get(job_id) if hasattr(store, 'get') else None
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        # Toggle enabled state
        if hasattr(job, 'enabled'):
            job.enabled = not job.enabled
            if hasattr(store, 'update'):
                store.update(job)
        else:
            job["enabled"] = not job.get("enabled", True)
        return JSONResponse(_to_dict(job))

    async def _history(self, request: Request) -> JSONResponse:
        """Return execution history for all scheduled jobs."""
        return JSONResponse({"history": _run_history})

    async def _run(self, request: Request) -> JSONResponse:
        job_id = request.path_params["job_id"]
        store = _get_schedule_store()
        job = store.get(job_id) if hasattr(store, 'get') else None
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        started_at = time.time()
        # Update last_run_at on the job
        if hasattr(job, 'last_run_at'):
            job.last_run_at = started_at
            if hasattr(store, 'update'):
                store.update(job)
        elif isinstance(job, dict):
            job["last_run_at"] = started_at
            job["run_count"] = job.get("run_count", 0) + 1

        # Try to execute the action via a gateway-registered agent (DRY: uses shared helper)
        result = None
        status = "succeeded"
        action = _getattr_or_get(job, "action", "") or _getattr_or_get(job, "message", "")
        agent_name = _getattr_or_get(job, "agent_name", None)
        if action:
            try:
                agent, gw, error = await _get_agent_for_execution(job_id, agent_name)
                
                if agent is not None:
                    import asyncio
                    result = await asyncio.to_thread(agent.chat, action)
                    result = str(result)
                else:
                    status = "failed"
                    result = error or f"No agent found to execute action: '{action}'"
            except (ImportError, Exception) as e:
                logger.warning("Schedule execution failed: %s", e)
                status = "failed"
                result = str(e)
        else:
            status = "skipped"
            result = "No action configured"

        duration = round(time.time() - started_at, 2)

        # Store run in history
        history_entry = {
            "job_id": job_id,
            "name": _getattr_or_get(job, "name", ""),
            "action": action,
            "status": status,
            "result": result,
            "timestamp": started_at,
            "duration": duration,
        }
        _run_history.insert(0, history_entry)
        # Cap history at 200 entries
        if len(_run_history) > 200:
            _run_history[:] = _run_history[:200]

        return JSONResponse({
            "triggered": job_id,
            "last_run_at": started_at,
            "result": result,
            "status": status,
            "duration": duration,
        })

    async def _update(self, request: Request) -> JSONResponse:
        """Update a schedule configuration."""
        job_id = request.path_params["job_id"]
        store = _get_schedule_store()
        job = store.get(job_id) if hasattr(store, 'get') else None
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        body = await request.json()
        # Update fields on the job object
        for key in ("name", "message", "agent_id", "session_target", "enabled"):
            if key in body:
                if hasattr(job, key):
                    setattr(job, key, body[key])
                elif isinstance(job, dict):
                    job[key] = body[key]
        if hasattr(store, 'update'):
            store.update(job)
        return JSONResponse(_to_dict(job))

    async def _stop(self, request: Request) -> JSONResponse:
        """Stop a running scheduled job."""
        job_id = request.path_params["job_id"]
        store = _get_schedule_store()
        job = store.get(job_id) if hasattr(store, 'get') else None
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        
        # Mark as stopped
        if hasattr(job, 'enabled'):
            job.enabled = False
            if hasattr(store, 'update'):
                store.update(job)
        elif isinstance(job, dict):
            job["enabled"] = False
        
        # Try to stop via AgentScheduler if connected
        scheduler = job.get("_scheduler") if isinstance(job, dict) else None
        if scheduler and hasattr(scheduler, 'stop'):
            try:
                scheduler.stop()
            except Exception as e:
                return JSONResponse({
                    "id": job_id,
                    "status": "error",
                    "error": str(e),
                }, status_code=500)
        
        return JSONResponse({
            "id": job_id,
            "status": "stopped",
            "stopped_at": job["stopped_at"],
        })

    async def _stats(self, request: Request) -> JSONResponse:
        """Get execution statistics for a scheduled job."""
        job_id = request.path_params["job_id"]
        store = _get_schedule_store()
        job = store.get(job_id) if hasattr(store, 'get') else None
        if not job:
            return JSONResponse({"error": "Job not found"}, status_code=404)
        
        # Get stats from AgentScheduler if available
        scheduler = job.get("_scheduler")
        if scheduler and hasattr(scheduler, 'get_stats'):
            try:
                stats = scheduler.get_stats()
                return JSONResponse({
                    "id": job_id,
                    "name": job.get("name", ""),
                    **stats,
                })
            except Exception:
                pass
        
        # Return basic stats from job record
        created_at = job.get("created_at", 0)
        last_run_at = job.get("last_run_at")
        run_count = job.get("run_count", 0)
        
        return JSONResponse({
            "id": job_id,
            "name": job.get("name", ""),
            "enabled": job.get("enabled", True),
            "total_runs": run_count,
            "successful_runs": job.get("success_count", run_count),
            "failed_runs": job.get("failure_count", 0),
            "created_at": created_at,
            "last_run_at": last_run_at,
            "next_run_at": self._calculate_next_run(job),
            "uptime_seconds": time.time() - created_at if created_at else 0,
        })

    def _calculate_next_run(self, job: Dict[str, Any]) -> float | None:
        """Calculate next scheduled run time."""
        if not job.get("enabled", True):
            return None
        schedule = job.get("schedule", {})
        every_seconds = schedule.get("every_seconds")
        if every_seconds:
            last_run = job.get("last_run_at") or job.get("created_at", time.time())
            return last_run + every_seconds
        return None

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        store = _get_schedule_store()
        jobs = store.list() if hasattr(store, 'list') else []
        if not jobs:
            return "No scheduled jobs"
        lines = []
        for j in jobs:
            status = "✓" if _getattr_or_get(j, "enabled", True) else "✗"
            sched = _getattr_or_get(j, 'schedule', {})
            kind = sched.get('kind', 'unknown') if isinstance(sched, dict) else str(sched)
            lines.append(f"  [{status}] {_getattr_or_get(j, 'id', '?')} — {_getattr_or_get(j, 'name', '')} ({kind})")
        return "\n".join(lines)

    def _cli_add(self, name: str, message: str, every_seconds: int = 60) -> str:
        job_id = uuid.uuid4().hex[:12]
        store = _get_schedule_store()
        job = {
            "id": job_id, "name": name, "message": message,
            "schedule": {"kind": "every", "every_seconds": every_seconds},
            "enabled": True, "created_at": time.time(), "last_run_at": None,
        }
        if hasattr(store, 'add'):
            store.add(job_id, f"*/{every_seconds}s", message, **job)
        return f"Added job {job_id}: {name}"

    def _cli_remove(self, job_id: str) -> str:
        store = _get_schedule_store()
        if hasattr(store, 'remove'):
            if not store.remove(job_id):
                return f"Job {job_id} not found"
        return f"Removed job {job_id}"

    def _cli_status(self) -> str:
        store = _get_schedule_store()
        jobs = store.list() if hasattr(store, 'list') else []
        enabled = sum(1 for j in jobs if _getattr_or_get(j, "enabled", True))
        return f"Jobs: {len(jobs)} total, {enabled} enabled"
