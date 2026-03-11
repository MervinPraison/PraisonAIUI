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
    def add(self, job_id: str, schedule: str, message: str, **kwargs) -> Dict[str, Any]: ...

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
_schedule_runner: Optional[Any] = None  # ScheduleRunner from SDK

# In-memory run history (newest first, capped at 200)
_run_history: list = []


def _getattr_or_get(obj, key, default=None):
    """Get attribute from both dict and dataclass/pydantic objects."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _get_schedule_store() -> ScheduleProtocol:
    """Lazy-load the config.yaml-backed schedule store.

    Uses _InMemoryScheduleStore (backed by unified config.yaml) as the
    primary store so that schedules live alongside agents, guardrails, etc.
    On first load, migrates any jobs from the old FileScheduleStore.
    """
    global _schedule_store
    if _schedule_store is None:
        _schedule_store = _InMemoryScheduleStore()
        logger.info("Using config.yaml-backed schedule store for persistence")
        # One-time migration from old SDK FileScheduleStore
        try:
            from praisonaiagents.scheduler import FileScheduleStore
            old_store = FileScheduleStore()
            old_jobs = old_store.list()
            if old_jobs and not _schedule_store.list():
                logger.info(f"Migrating {len(old_jobs)} jobs from FileScheduleStore → config.yaml")
                for job in old_jobs:
                    _schedule_store.add(job)
        except ImportError:
            pass
        except Exception as e:
            logger.debug(f"FileScheduleStore migration skipped: {e}")
    return _schedule_store


def _get_schedule_runner():
    """Lazy-load the SDK ScheduleRunner.

    Returns None when using the config-backed dict store, because the
    SDK ScheduleRunner expects ScheduleJob dataclasses with attribute
    access (.enabled, .schedule, etc.) — dicts would cause AttributeError.
    The fallback _is_job_due() handles both dicts and dataclasses.
    """
    global _schedule_runner
    if _schedule_runner is None:
        store = _get_schedule_store()
        # Only use SDK runner with FileScheduleStore (returns ScheduleJob objects)
        if isinstance(store, _InMemoryScheduleStore):
            logger.debug("Config-backed store uses dict jobs — skipping SDK ScheduleRunner")
            return None
        try:
            from praisonaiagents.scheduler import ScheduleRunner
            _schedule_runner = ScheduleRunner(store)
            logger.info("SDK ScheduleRunner wired for due-job checking")
        except ImportError:
            logger.debug("ScheduleRunner not available — using fallback _is_job_due")
    return _schedule_runner


# ── Background scheduler loop ────────────────────────────────────────

_scheduler_task: Optional[Any] = None  # asyncio.Task
_scheduler_running = False


def _is_job_due(job) -> bool:
    """Fallback due-check for when SDK ScheduleRunner is not available."""
    if not _getattr_or_get(job, "enabled", True):
        return False
    schedule = _getattr_or_get(job, "schedule", {})
    # Convert Schedule dataclass to dict for uniform handling
    if hasattr(schedule, "to_dict"):
        schedule = schedule.to_dict()
    elif not isinstance(schedule, dict):
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


async def _get_agent_for_execution(
    job_id: str,
    agent_name: Optional[str] = None,
    session_id: Optional[str] = None,
) -> tuple:
    """Get or create agent for job execution (DRY helper).

    Args:
        job_id: The job ID (used for fallback session).
        agent_name: Optional agent name to look up.
        session_id: Optional session ID from delivery target. When provided,
                    the agent is created with this session to preserve
                    conversation context. Falls back to ``cron_{job_id}``.

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
            effective_session = session_id or f"cron_{job_id}"
            agent = provider._get_or_create_agent(
                agent_name=agent_name,
                session_id=effective_session,
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


async def _deliver_result(delivery_dict: dict, text: str) -> bool:
    """Deliver scheduled job result to the originating platform.

    Looks up a running bot from the channels registry that matches the
    delivery platform, then calls ``bot.send_message()``.

    Returns:
        True if delivery succeeded, False otherwise.
    """
    try:
        from .channels import _live_bots, _channels
    except ImportError:
        logger.warning("Cannot deliver: channels module not available")
        return False

    platform = delivery_dict.get("channel", "")
    channel_id = delivery_dict.get("channel_id", "")
    thread_id = delivery_dict.get("thread_id")

    if not platform or not channel_id:
        logger.warning("Delivery skipped: missing channel or channel_id")
        return False

    # Find a running bot whose platform matches the delivery channel
    bot = None
    for ch_id, info in _live_bots.items():
        ch_entry = _channels.get(ch_id, {})
        ch_platform = ch_entry.get("platform", ch_id).lower()
        if ch_platform == platform.lower():
            bot = info.get("bot")
            if bot is not None:
                break

    if bot is None:
        logger.warning("No running %s bot for scheduled delivery to %s", platform, channel_id)
        return False

    try:
        await bot.send_message(channel_id, text, thread_id=thread_id)
        logger.info("Delivered scheduled result to %s/%s", platform, channel_id)
        return True
    except Exception as e:
        logger.error("Delivery to %s/%s failed: %s", platform, channel_id, e)
        return False


def _extract_delivery_dict(job) -> Optional[dict]:
    """Extract delivery info from a job as a plain dict (works for both dataclass and dict jobs)."""
    delivery = _getattr_or_get(job, "delivery", None)
    if delivery is None:
        return None
    if isinstance(delivery, dict):
        return delivery if delivery.get("channel_id") else None
    if hasattr(delivery, "to_dict"):
        d = delivery.to_dict()
        return d if d.get("channel_id") else None
    return None


async def _execute_job(job_id: str, job) -> None:
    """Execute a scheduled job and deliver the result to the originating platform."""
    started_at = time.time()
    message = _getattr_or_get(job, "message", "")
    agent_name = _getattr_or_get(job, "agent_name", None) or _getattr_or_get(job, "agent_id", None)
    result = None
    status = "succeeded"
    delivered = False

    # Extract delivery target for session + routing
    delivery_dict = _extract_delivery_dict(job)
    session_id = delivery_dict.get("session_id") if delivery_dict else None

    if message:
        try:
            agent, gw, error = await _get_agent_for_execution(
                job_id, agent_name, session_id=session_id,
            )

            if agent is not None:
                import asyncio
                result = await asyncio.to_thread(agent.chat, message)
                result = str(result)
            else:
                status = "failed"
                result = error or f"No agent found to execute message: '{message}'"
        except (ImportError, Exception) as e:
            logger.warning("Scheduled job '%s' execution failed: %s", job_id, e)
            status = "failed"
            result = str(e)
    else:
        status = "skipped"
        result = "No message configured"

    # Deliver result to originating platform
    if result and status == "succeeded" and delivery_dict:
        delivered = await _deliver_result(delivery_dict, str(result))

    # Update job metadata and persist
    store = _get_schedule_store()
    if isinstance(job, dict):
        job["last_run_at"] = started_at
        job["run_count"] = job.get("run_count", 0) + 1
        if hasattr(store, "update"):
            store.update(job)
    elif hasattr(job, "last_run_at"):
        job.last_run_at = started_at
        if hasattr(store, "update"):
            store.update(job)

    duration = round(time.time() - started_at, 2)
    _run_history.insert(0, {
        "job_id": job_id,
        "name": _getattr_or_get(job, "name", ""),
        "message": message,
        "status": status,
        "result": result,
        "delivered": delivered,
        "timestamp": started_at,
        "duration": duration,
        "auto": True,
    })
    if len(_run_history) > 200:
        _run_history[:] = _run_history[:200]
    logger.info("Auto-executed job '%s': %s delivered=%s (%.1fs)", job_id, status, delivered, duration)


async def _scheduler_loop() -> None:
    """Background loop that checks and triggers due jobs every 15s.

    Uses SDK ScheduleRunner.get_due_jobs() when available (handles
    ScheduleJob dataclasses + cron/interval/at natively), falling
    back to the local _is_job_due() for in-memory stores.
    """
    global _scheduler_running
    import asyncio
    _scheduler_running = True
    logger.info("Background scheduler started")
    try:
        while _scheduler_running:
            try:
                runner = _get_schedule_runner()
                if runner is not None:
                    # ── SDK path: delegate to ScheduleRunner ────────
                    due_jobs = runner.get_due_jobs()
                    for job in due_jobs:
                        jid = _getattr_or_get(job, "id", "")
                        if jid:
                            asyncio.create_task(_execute_job(jid, job))
                            runner.mark_run(job)
                else:
                    # ── Fallback: in-memory store, manual due-check ─
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
    """Create a ScheduleJob from a dict, using praisonaiagents if available.

    Maps the ``delivery`` dict (if present) to the SDK's ``DeliveryTarget``
    dataclass for structured serialization and roundtrip support.
    """
    try:
        from praisonaiagents.scheduler import ScheduleJob, Schedule, DeliveryTarget
        sched_data = job_dict.get("schedule", {})
        schedule = Schedule(
            kind=sched_data.get("kind", "every"),
            every_seconds=sched_data.get("every_seconds"),
            cron_expr=sched_data.get("cron_expr"),
            at=sched_data.get("at"),
        )
        # Map delivery dict → SDK DeliveryTarget
        delivery_data = job_dict.get("delivery")
        delivery = None
        if isinstance(delivery_data, dict) and delivery_data.get("channel_id"):
            delivery = DeliveryTarget.from_dict(delivery_data)
        return ScheduleJob(
            id=job_dict.get("id", uuid.uuid4().hex[:12]),
            name=job_dict.get("name", ""),
            schedule=schedule,
            message=job_dict.get("message", ""),
            agent_id=job_dict.get("agent_id"),
            session_target=job_dict.get("session_target", "isolated"),
            enabled=job_dict.get("enabled", True),
            delete_after_run=job_dict.get("delete_after_run", False),
            delivery=delivery,
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

    def add(self, job_id_or_obj=None, schedule=None, message=None, **kwargs) -> Dict[str, Any]:
        # Accept single dict/object (from _add handler) or positional args (from CLI)
        if schedule is None and message is None and job_id_or_obj is not None:
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
            "message": message,
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

    def update(self, job_id_or_obj=None, **kwargs) -> Dict[str, Any]:
        # Accept a single job object (dict or dataclass) or (job_id, **kwargs)
        if isinstance(job_id_or_obj, str):
            job_id = job_id_or_obj
            if job_id in self._jobs:
                self._jobs[job_id].update(kwargs)
                self._persist()
                return self._jobs[job_id]
            return None
        # Single object: extract id and store as dict
        obj = job_id_or_obj
        if obj is None:
            return None
        d = _to_dict(obj) if not isinstance(obj, dict) else obj
        jid = d.get("id")
        if jid and jid in self._jobs:
            self._jobs[jid] = d
            self._persist()
            return d
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
        if isinstance(schedule, str):
            # Frontend may send cron as a raw string — parse it
            schedule = {"kind": "cron", "cron_expr": schedule}
        elif not isinstance(schedule, dict):
            schedule = {"kind": "every", "every_seconds": 60}
        # Build delivery target dict (matches SDK gateway.yaml schema)
        delivery = None
        channel = body.get("channel", "")
        channel_id = body.get("channel_id", "")
        if channel_id:
            delivery = {
                "channel": channel,
                "channel_id": channel_id,
                "session_id": body.get("session_id"),
                "thread_id": body.get("thread_id"),
            }
        job = {
            "id": job_id,
            "name": body.get("name", ""),
            "schedule": {
                "kind": schedule.get("kind", "every"),
                "every_seconds": schedule.get("every_seconds"),
                "cron_expr": schedule.get("cron_expr"),
                "at": schedule.get("at"),
            },
            "message": body.get("message", "") or body.get("action", ""),
            "agent_id": body.get("agent_id"),
            "agent_name": body.get("agent_name"),
            "session_target": body.get("session_target", "isolated"),
            "enabled": body.get("enabled", True),
            "delete_after_run": body.get("delete_after_run", False),
            "delivery": delivery,
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
        if hasattr(job, 'enabled') and not isinstance(job, dict):
            job.enabled = not job.enabled
            if hasattr(store, 'update'):
                store.update(job)
        else:
            job["enabled"] = not job.get("enabled", True)
            if hasattr(store, 'update'):
                store.update(job)
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
        delivered = False
        message = _getattr_or_get(job, "message", "")
        agent_name = _getattr_or_get(job, "agent_name", None) or _getattr_or_get(job, "agent_id", None)
        delivery_dict = _extract_delivery_dict(job)
        session_id = delivery_dict.get("session_id") if delivery_dict else None

        if message:
            try:
                agent, gw, error = await _get_agent_for_execution(
                    job_id, agent_name, session_id=session_id,
                )

                if agent is not None:
                    import asyncio
                    result = await asyncio.to_thread(agent.chat, message)
                    result = str(result)
                else:
                    status = "failed"
                    result = error or f"No agent found to execute message: '{message}'"
            except (ImportError, Exception) as e:
                logger.warning("Schedule execution failed: %s", e)
                status = "failed"
                result = str(e)
        else:
            status = "skipped"
            result = "No message configured"

        # Deliver result to originating platform
        if result and status == "succeeded" and delivery_dict:
            delivered = await _deliver_result(delivery_dict, str(result))

        duration = round(time.time() - started_at, 2)

        # Store run in history
        history_entry = {
            "job_id": job_id,
            "name": _getattr_or_get(job, "name", ""),
            "message": message,
            "status": status,
            "result": result,
            "delivered": delivered,
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
            "delivered": delivered,
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
        # Update simple fields on the job object
        for key in ("name", "message", "agent_id", "session_target", "enabled"):
            if key in body:
                if hasattr(job, key):
                    setattr(job, key, body[key])
                elif isinstance(job, dict):
                    job[key] = body[key]
        # Update delivery target (structured dict → SDK DeliveryTarget)
        if "delivery" in body:
            delivery_data = body["delivery"]
            if hasattr(job, "delivery") and not isinstance(job, dict):
                # SDK ScheduleJob — set DeliveryTarget from dict
                try:
                    from praisonaiagents.scheduler import DeliveryTarget
                    if isinstance(delivery_data, dict) and delivery_data.get("channel_id"):
                        job.delivery = DeliveryTarget.from_dict(delivery_data)
                    else:
                        job.delivery = None
                except ImportError:
                    setattr(job, "delivery", delivery_data)
            elif isinstance(job, dict):
                job["delivery"] = delivery_data
        # Also support flat channel/channel_id fields for convenience
        if "channel_id" in body and "delivery" not in body:
            delivery_data = {
                "channel": body.get("channel", ""),
                "channel_id": body["channel_id"],
                "session_id": body.get("session_id"),
                "thread_id": body.get("thread_id"),
            }
            if isinstance(job, dict):
                job["delivery"] = delivery_data
            elif hasattr(job, "delivery"):
                try:
                    from praisonaiagents.scheduler import DeliveryTarget
                    job.delivery = DeliveryTarget.from_dict(delivery_data)
                except ImportError:
                    setattr(job, "delivery", delivery_data)
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
