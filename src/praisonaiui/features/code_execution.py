"""Code Execution feature — protocol-driven sandboxed code execution.

Architecture:
    CodeExecutionProtocol (ABC)
      └── SandboxExecutionManager  ← wraps SDK execute_code with approval hooks

POST /api/code/execute runs through the SDK's own approval gate on
``execute_code`` (``@require_approval(risk_level="critical")``), wired to the
UI approvals queue: the request waits for a human, and deny or timeout is 403.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Code Execution Protocol ──────────────────────────────────────────


class CodeExecutionProtocol(ABC):
    """Protocol interface for code execution backends."""

    @abstractmethod
    def execute(
        self, code: str, *, language: str = "python", timeout: int = 30
    ) -> Dict[str, Any]: ...

    @abstractmethod
    def list_languages(self) -> List[Dict[str, str]]: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Sandbox Execution Manager ────────────────────────────────────────


class SandboxExecutionManager(CodeExecutionProtocol):
    """Sandboxed code execution — wraps SDK execute_code if available."""

    LANGUAGES = [
        {"id": "python", "name": "Python", "version": "3.x"},
        {"id": "javascript", "name": "JavaScript", "version": "ES2020"},
        {"id": "bash", "name": "Bash", "version": "5.x"},
    ]

    def __init__(
        self,
        *,
        sandbox: bool = True,
        timeout: int = 30,
        allowed_languages: Optional[List[str]] = None,
    ) -> None:
        self._sandbox = sandbox
        self._timeout = timeout
        self._allowed = set(allowed_languages or ["python", "javascript", "bash"])
        self._history: List[Dict[str, Any]] = []

    def execute(self, code: str, *, language: str = "python", timeout: int = 30) -> Dict[str, Any]:
        if language not in self._allowed:
            return {
                "status": "error",
                "error": f"Language '{language}' not allowed",
                "allowed": list(self._allowed),
            }

        try:
            from praisonaiagents.tools.python_tools import execute_code
        except ImportError:
            entry = {
                "language": language,
                "status": "degraded",
                "error": "Code execution needs the praisonaiagents package "
                "(pip install praisonaiagents). Nothing was run.",
                "sandbox": self._sandbox,
            }
            self._history.append(entry)
            return entry

        if language != "python":
            return {
                "status": "error",
                "error": f"Language '{language}' cannot run here: the sandbox runs Python only",
                "language": language,
            }

        # execute_code carries the SDK's @require_approval(risk_level="critical"):
        # this call blocks until a human approves it and raises PermissionError
        # on deny or timeout. Call it from a worker thread, never the event loop.
        result = execute_code(
            code,
            timeout=timeout,
            sandbox_mode="sandbox" if self._sandbox else "direct",
        )
        entry = {
            "language": language,
            "status": "success" if result.get("success") else "failed",
            "output": result.get("stdout", ""),
            "error": result.get("stderr", ""),
            "result": result.get("result"),
            "sandbox": self._sandbox,
        }
        self._history.append(entry)
        return entry

    def list_languages(self) -> List[Dict[str, str]]:
        return [l for l in self.LANGUAGES if l["id"] in self._allowed]

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SandboxExecutionManager",
            "sandbox": self._sandbox,
            "allowed_languages": list(self._allowed),
            "executions": len(self._history),
        }


# ── Manager singleton ────────────────────────────────────────────────

_execution_manager: Optional[CodeExecutionProtocol] = None


def get_execution_manager() -> CodeExecutionProtocol:
    global _execution_manager
    if _execution_manager is None:
        _execution_manager = SandboxExecutionManager()
    return _execution_manager


def set_execution_manager(manager: CodeExecutionProtocol) -> None:
    global _execution_manager
    _execution_manager = manager


# ── Feature class ────────────────────────────────────────────────────


class CodeExecutionFeature(BaseFeatureProtocol):
    """Code execution — sandboxed with approval hooks integration."""

    feature_name = "code_execution"
    feature_description = "Sandboxed code execution with language support"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/code/execute", self._execute, methods=["POST"]),
            Route("/api/code/languages", self._languages, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        mgr = get_execution_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    async def _execute(self, request: Request) -> JSONResponse:
        mgr = get_execution_manager()
        body = await request.json()
        code = body.get("code", "")
        language = body.get("language", "python")
        try:
            timeout = max(1, min(int(body.get("timeout", 30)), 300))
        except (TypeError, ValueError):
            return JSONResponse({"status": "error", "error": "timeout must be a number"}, 400)
        # Wire the SDK approval registry to the UI approvals queue before the
        # run, so a human decides in the Approvals page: one run, one approval.
        from .approvals import get_approval_manager

        get_approval_manager()
        try:
            # A fresh context: no approval cached by an earlier run is reused.
            result = await asyncio.to_thread(
                contextvars.Context().run, mgr.execute, code, language=language, timeout=timeout
            )
        except PermissionError as e:
            return JSONResponse(
                {"status": "denied", "language": language, "error": f"Not run: {e}"}, 403
            )
        status = {"error": 400, "degraded": 503}.get(result.get("status"), 200)
        return JSONResponse(result, status_code=status)

    async def _languages(self, request: Request) -> JSONResponse:
        mgr = get_execution_manager()
        languages = mgr.list_languages()
        return JSONResponse({"languages": languages, "count": len(languages)})


# Backward-compat alias
PraisonAICodeExecution = CodeExecutionFeature
