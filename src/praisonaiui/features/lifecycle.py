"""Lifecycle hooks feature — server startup and shutdown hooks.

Provides lifecycle decorators @aiui.on_app_startup and @aiui.on_app_shutdown
for initializing resources at server start and cleaning up on graceful shutdown.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Callable, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

_log = logging.getLogger(__name__)

# Registry for lifecycle hooks
_startup_hooks: List[Callable] = []
_shutdown_hooks: List[Callable] = []
_lifecycle_state: Dict[str, Any] = {
    "startup_completed": False,
    "shutdown_initiated": False,
    "startup_time": 0,
    "shutdown_time": 0,
}


class LifecycleFeature(BaseFeatureProtocol):
    """Lifecycle hooks management for server startup and shutdown."""

    feature_name = "lifecycle"
    feature_description = "Server startup and shutdown hook management"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/lifecycle", self._status, methods=["GET"]),
            Route("/api/lifecycle/hooks", self._list_hooks, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "lifecycle",
            "help": "Manage server lifecycle hooks",
            "commands": {
                "status": {"help": "Show lifecycle status", "handler": self._cli_status},
                "hooks": {"help": "List registered hooks", "handler": self._cli_hooks},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "feature": self.name,
            "startup_hooks": len(_startup_hooks),
            "shutdown_hooks": len(_shutdown_hooks),
            "startup_completed": _lifecycle_state["startup_completed"],
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _status(self, request: Request) -> JSONResponse:
        return JSONResponse({
            "lifecycle": _lifecycle_state,
            "startup_hooks": len(_startup_hooks),
            "shutdown_hooks": len(_shutdown_hooks),
        })

    async def _list_hooks(self, request: Request) -> JSONResponse:
        startup_info = [
            {
                "name": getattr(hook, "__name__", str(hook)),
                "module": getattr(hook, "__module__", "unknown"),
            }
            for hook in _startup_hooks
        ]
        shutdown_info = [
            {
                "name": getattr(hook, "__name__", str(hook)),
                "module": getattr(hook, "__module__", "unknown"),
            }
            for hook in _shutdown_hooks
        ]
        return JSONResponse({
            "startup_hooks": startup_info,
            "shutdown_hooks": shutdown_info,
        })

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_status(self) -> str:
        state = _lifecycle_state
        lines = [
            f"Startup completed: {state['startup_completed']}",
            f"Shutdown initiated: {state['shutdown_initiated']}",
            f"Startup hooks: {len(_startup_hooks)}",
            f"Shutdown hooks: {len(_shutdown_hooks)}",
        ]
        if state["startup_time"]:
            lines.append(f"Startup time: {state['startup_time']:.3f}s")
        return "\n".join(lines)

    def _cli_hooks(self) -> str:
        lines = []
        if _startup_hooks:
            lines.append("Startup hooks:")
            for hook in _startup_hooks:
                name = getattr(hook, "__name__", str(hook))
                lines.append(f"  - {name}")
        if _shutdown_hooks:
            lines.append("Shutdown hooks:")
            for hook in _shutdown_hooks:
                name = getattr(hook, "__name__", str(hook))
                lines.append(f"  - {name}")
        return "\n".join(lines) if lines else "No hooks registered"


def register_startup_hook(func: Callable) -> Callable:
    """Register a startup hook function.
    
    Args:
        func: Function to call during server startup
        
    Returns:
        The original function (for use as decorator)
    """
    if func not in _startup_hooks:
        _startup_hooks.append(func)
        _log.debug(f"Registered startup hook: {getattr(func, '__name__', str(func))}")
    return func


def register_shutdown_hook(func: Callable) -> Callable:
    """Register a shutdown hook function.
    
    Args:
        func: Function to call during server shutdown
        
    Returns:
        The original function (for use as decorator)
    """
    if func not in _shutdown_hooks:
        _shutdown_hooks.append(func)
        _log.debug(f"Registered shutdown hook: {getattr(func, '__name__', str(func))}")
    return func


async def run_startup_hooks() -> None:
    """Execute all registered startup hooks.
    
    Called by the server during application startup.
    Blocks until all hooks complete.
    """
    if _lifecycle_state["startup_completed"]:
        _log.warning("Startup hooks already executed")
        return
        
    _log.info(f"Running {len(_startup_hooks)} startup hooks")
    start_time = time.time()
    
    for hook in _startup_hooks:
        try:
            _log.debug(f"Executing startup hook: {getattr(hook, '__name__', str(hook))}")
            result = hook()
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            _log.error(f"Startup hook failed: {getattr(hook, '__name__', str(hook))}: {e}")
            # Continue with other hooks - individual failures shouldn't break startup
    
    execution_time = time.time() - start_time
    _lifecycle_state.update({
        "startup_completed": True,
        "startup_time": execution_time,
    })
    _log.info(f"Startup hooks completed in {execution_time:.3f}s")


async def run_shutdown_hooks() -> None:
    """Execute all registered shutdown hooks.
    
    Called by the server during graceful shutdown.
    Has a timeout from AIUI_SHUTDOWN_TIMEOUT (default 30s).
    """
    if _lifecycle_state["shutdown_initiated"]:
        _log.warning("Shutdown hooks already executed")
        return
        
    _lifecycle_state["shutdown_initiated"] = True
    _log.info(f"Running {len(_shutdown_hooks)} shutdown hooks")
    start_time = time.time()
    
    # Get shutdown timeout from environment
    timeout = float(os.environ.get("AIUI_SHUTDOWN_TIMEOUT", "30.0"))
    
    async def _execute_hooks():
        for hook in _shutdown_hooks:
            try:
                _log.debug(f"Executing shutdown hook: {getattr(hook, '__name__', str(hook))}")
                result = hook()
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                _log.error(f"Shutdown hook failed: {getattr(hook, '__name__', str(hook))}: {e}")
                # Continue with other hooks
    
    try:
        await asyncio.wait_for(_execute_hooks(), timeout=timeout)
        execution_time = time.time() - start_time
        _lifecycle_state["shutdown_time"] = execution_time
        _log.info(f"Shutdown hooks completed in {execution_time:.3f}s")
    except asyncio.TimeoutError:
        _log.warning(f"Shutdown hooks timed out after {timeout}s")


def reset_lifecycle_state() -> None:
    """Reset lifecycle state to initial values.
    
    Used for testing - resets all hooks and state.
    """
    global _startup_hooks, _shutdown_hooks, _lifecycle_state
    _startup_hooks.clear()
    _shutdown_hooks.clear()
    _lifecycle_state.update({
        "startup_completed": False,
        "shutdown_initiated": False,
        "startup_time": 0,
        "shutdown_time": 0,
    })


# Public decorators
def on_app_startup(func: Callable) -> Callable:
    """Decorator to register a startup hook.
    
    The decorated function will be called during server startup,
    after config load but before the first request is accepted.
    
    Example::
    
        @aiui.on_app_startup
        async def warm():
            global vector_store
            vector_store = await VectorStore.connect()
            logger.info("vector store warm")
    """
    return register_startup_hook(func)


def on_app_shutdown(func: Callable) -> Callable:
    """Decorator to register a shutdown hook.
    
    The decorated function will be called during graceful server shutdown
    to drain connections and flush datastores.
    
    Example::
    
        @aiui.on_app_shutdown
        async def drain():
            await vector_store.close()
    """
    return register_shutdown_hook(func)