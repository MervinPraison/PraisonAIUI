"""Browser automation dashboard feature — expose browser agent (Gap 22).

Protocol-driven: wraps praisonai.browser capabilities.
Config-driven: users configure browser tasks via API/UI.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Protocol ─────────────────────────────────────────────────────

class BrowserAutomationProtocol:
    """Protocol for browser automation features."""

    def get_status(self) -> Dict[str, Any]:
        ...

    async def execute_task(self, task: str, url: str = "") -> Dict[str, Any]:
        ...


# ── Implementation ───────────────────────────────────────────────

class BrowserAutomationManager(BrowserAutomationProtocol):
    """Wraps praisonai.browser capabilities for dashboard exposure."""

    def __init__(self) -> None:
        self._available = False
        self._tasks_run = 0
        self._check_availability()

    def _check_availability(self) -> None:
        try:
            from praisonai.browser import protocol  # noqa: F401
            self._available = True
        except ImportError:
            self._available = False

    def get_status(self) -> Dict[str, Any]:
        return {
            "available": self._available,
            "tasks_run": self._tasks_run,
            "backends": self._get_backends(),
        }

    def _get_backends(self) -> List[str]:
        backends = []
        try:
            import playwright  # noqa: F401
            backends.append("playwright")
        except ImportError:
            pass
        try:
            from praisonai.browser import cdp_agent  # noqa: F401
            backends.append("cdp")
        except ImportError:
            pass
        return backends

    async def execute_task(self, task: str, url: str = "") -> Dict[str, Any]:
        if not self._available:
            return {"error": "Browser automation not available. Install praisonai[browser]"}

        self._tasks_run += 1
        try:
            from praisonai.browser.agent import BrowserAgent
            agent = BrowserAgent()
            result = await agent.run(task=task, url=url)
            return {"status": "completed", "result": str(result)}
        except Exception as e:
            return {"status": "error", "error": str(e)}


_browser_manager = None


def get_browser_manager():
    global _browser_manager
    if _browser_manager is None:
        _browser_manager = BrowserAutomationManager()
    return _browser_manager


# ── HTTP Handlers ────────────────────────────────────────────────

async def _browser_status(request: Request) -> JSONResponse:
    mgr = get_browser_manager()
    return JSONResponse(mgr.get_status())


async def _browser_run(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    task = body.get("task", "")
    url = body.get("url", "")
    if not task:
        return JSONResponse({"error": "task required"}, status_code=400)

    mgr = get_browser_manager()
    result = await mgr.execute_task(task, url)
    return JSONResponse(result)


# ── Feature ──────────────────────────────────────────────────────

class BrowserAutomationFeature(BaseFeatureProtocol):
    """Browser automation feature — expose browser agent in dashboard."""

    feature_name = "browser_automation"
    feature_description = "Browser automation via CDP/Playwright"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/browser/status", _browser_status, methods=["GET"]),
            Route("/api/browser/run", _browser_run, methods=["POST"]),
        ]


# Backward-compat alias
PraisonAIBrowserAutomation = BrowserAutomationFeature
