"""Code Execution feature — protocol-driven sandboxed code execution.

Architecture:
    CodeExecutionProtocol (ABC)
      └── SandboxExecutionManager  ← wraps SDK execute_code with approval hooks
"""

from __future__ import annotations

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

        # Try SDK execute_code first
        try:
            from praisonaiagents.tools.code import execute_code

            result = execute_code(code)
            entry = {
                "language": language,
                "status": "success",
                "output": str(result),
                "sandbox": self._sandbox,
            }
            self._history.append(entry)
            return entry
        except ImportError:
            pass
        except Exception as e:
            logger.warning("SDK execute_code failed: %s", e)

        from praisonaiui.backends import is_integrated_mode

        if is_integrated_mode():
            entry = {
                "language": language,
                "status": "degraded",
                "error": "Code execution unavailable (praisonaiagents.tools.code missing or failed)",
                "sandbox": self._sandbox,
            }
            self._history.append(entry)
            return entry

        # Standalone fallback: simulate execution for safety
        entry = {
            "language": language,
            "status": "simulated",
            "output": f"[Sandbox] Code received ({len(code)} chars, {language})",
            "sandbox": self._sandbox,
            "note": "Install praisonaiagents for real execution",
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


# ── Approval gate ────────────────────────────────────────────────────


async def _approval_gate(
    code: str, language: str, approval_id: Optional[str]
) -> Optional[JSONResponse]:
    """Return None if execution is approved, else the response to send.

    Each run is recorded via the approvals feature as a ``critical``
    ``execute_code`` request. A pending request returns 202 with its id;
    re-submit with ``approval_id`` once approved (single use, bound to
    the exact code/language).
    """
    from .approvals import _notify_subscribers, get_approval_manager

    approvals = get_approval_manager()
    arguments = {"code": code, "language": language}

    if approval_id:
        entry = approvals.get(approval_id)
        if (
            entry
            and entry.get("tool_name") == "execute_code"
            and entry.get("status") == "approved"
            and entry.get("arguments") == arguments
            and not entry.get("consumed")
        ):
            entry["consumed"] = True
            return None
        return JSONResponse(
            {
                "status": "error",
                "language": language,
                "error": "Approval not found, not approved, already used, "
                "or does not match this code",
            },
            status_code=403,
        )

    entry = approvals.request_approval(
        {
            "tool_name": "execute_code",
            "arguments": arguments,
            "risk_level": "critical",
            "description": f"Execute {language} code ({len(code)} chars)",
        }
    )
    status = entry.get("status")
    await _notify_subscribers("new" if status == "pending" else "resolved", entry)
    if status == "approved":
        entry["consumed"] = True
        return None
    if status == "denied":
        return JSONResponse(
            {
                "status": "error",
                "language": language,
                "approval_id": entry["id"],
                "error": entry.get("reason") or "Code execution denied",
            },
            status_code=403,
        )
    return JSONResponse(
        {
            "status": "pending_approval",
            "language": language,
            "approval_id": entry["id"],
            "output": f"Awaiting approval {entry['id']}. Approve it, then re-run "
            "with this approval_id.",
        },
        status_code=202,
    )


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
        allowed = {lang["id"] for lang in mgr.list_languages()}
        if language not in allowed:
            return JSONResponse(
                {"status": "error", "error": f"Language '{language}' not allowed"},
                status_code=400,
            )
        blocked = await _approval_gate(code, language, body.get("approval_id"))
        if blocked is not None:
            return blocked
        result = mgr.execute(
            code=code,
            language=language,
            timeout=body.get("timeout", 30),
        )
        status = 200 if result.get("status") != "error" else 400
        return JSONResponse(result, status_code=status)

    async def _languages(self, request: Request) -> JSONResponse:
        mgr = get_execution_manager()
        languages = mgr.list_languages()
        return JSONResponse({"languages": languages, "count": len(languages)})


# Backward-compat alias
PraisonAICodeExecution = CodeExecutionFeature
