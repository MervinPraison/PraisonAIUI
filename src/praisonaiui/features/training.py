"""Training Lab feature — read-mostly proxy for praisonai-train sessions.

Architecture:
    TrainingFeature (BaseFeatureProtocol)
      ├── reads JSON session files from ~/.praison/train/*.json
      └── optionally delegates apply to praisonai_train.train.agents.apply_training

The praisonai-train package is an optional dependency. When it is not installed
the feature degrades gracefully: session listing/detail still work from the raw
JSON storage, while apply returns a 503 with an install hint.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

_EARLY_STOP_THRESHOLD = 9.5


def _storage_dir() -> Path:
    """Resolve the praisonai-train JSON storage directory."""
    override = os.environ.get("PRAISON_TRAIN_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".praison" / "train"


def _train_available() -> bool:
    """Return True when the praisonai-train package can be imported."""
    import importlib.util

    return importlib.util.find_spec("praisonai_train") is not None


def _train_version() -> str | None:
    try:
        from importlib.metadata import version

        return version("praisonai-train")
    except Exception:
        return None


def _iter_scores(iterations: list[dict[str, Any]]) -> list[float]:
    scores: list[float] = []
    for it in iterations:
        score = it.get("score")
        if isinstance(score, (int, float)):
            scores.append(float(score))
    return scores


def _best_iteration_index(iterations: list[dict[str, Any]]) -> int | None:
    best_idx: int | None = None
    best_score = float("-inf")
    for idx, it in enumerate(iterations):
        score = it.get("score")
        if isinstance(score, (int, float)) and float(score) > best_score:
            best_score = float(score)
            best_idx = idx
    return best_idx


def _summarize_session(session_id: str, path: Path, data: dict[str, Any]) -> dict[str, Any]:
    """Build a session summary row (parity with praisonai-train list)."""
    report = data.get("report") or {}
    metadata = report.get("metadata") or data.get("metadata") or {}
    iterations = data.get("iterations") or report.get("iterations") or []

    completed = int(report.get("total_iterations", len(iterations)) or 0)
    requested = metadata.get("target_iterations")
    requested = int(requested) if isinstance(requested, (int, float)) else completed
    mode = metadata.get("mode", "llm")

    scores = _iter_scores(iterations)
    avg_score = report.get("avg_score")
    if avg_score is None and scores:
        avg_score = sum(scores) / len(scores)
    improvement = report.get("improvement")
    if improvement is None and len(scores) >= 2:
        improvement = scores[-1] - scores[0]
    passed = report.get("passed")

    early_stopped = bool(requested > completed and mode == "llm")

    try:
        stat = path.stat()
        size_bytes = stat.st_size
        modified_at = _iso_from_mtime(stat.st_mtime)
    except OSError:
        size_bytes = 0
        modified_at = None

    return {
        "session_id": session_id,
        "completed_iterations": completed,
        "requested_iterations": requested,
        "early_stopped": early_stopped,
        "avg_score": round(float(avg_score), 4) if avg_score is not None else None,
        "improvement": round(float(improvement), 4) if improvement is not None else None,
        "passed": passed,
        "status_label": _status_label(passed, completed),
        "mode": mode,
        "size_bytes": size_bytes,
        "modified_at": modified_at,
    }


def _iso_from_mtime(mtime: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(mtime, tz=timezone.utc).replace(microsecond=0).isoformat()


def _status_label(passed: Any, completed: int) -> str:
    if completed == 0:
        return "INCOMPLETE"
    if passed is True:
        return "PASSED"
    if passed is False:
        return "NEEDS WORK"
    return "UNKNOWN"


def _load_session_file(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


class TrainingFeature(BaseFeatureProtocol):
    """Training Lab — inspect praisonai-train agent sessions and apply profiles."""

    feature_name = "training"
    feature_description = "Inspect praisonai-train agent sessions and apply training profiles"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> list[Route]:
        return [
            Route("/api/training/status", self._status, methods=["GET"]),
            Route("/api/training/sessions", self._list_sessions, methods=["GET"]),
            Route("/api/training/sessions/{session_id}", self._get_session, methods=["GET"]),
            Route("/api/training/sessions/{session_id}/apply", self._apply, methods=["POST"]),
        ]

    async def health(self) -> dict[str, Any]:
        available = _train_available()
        return {
            "status": "ok" if available else "degraded",
            "feature": self.name,
            "train_package_available": available,
        }

    # ── storage helpers ──────────────────────────────────────────────

    def _read_sessions(self, storage: Path) -> list[dict[str, Any]]:
        if not storage.exists():
            return []
        summaries: list[dict[str, Any]] = []
        for path in storage.glob("*.json"):
            session_id = path.stem
            try:
                data = _load_session_file(path)
            except (OSError, json.JSONDecodeError):
                logger.warning("Skipping unreadable training session: %s", path)
                continue
            summaries.append(_summarize_session(session_id, path, data))
        summaries.sort(key=lambda s: s.get("modified_at") or "", reverse=True)
        return summaries

    # ── route handlers ───────────────────────────────────────────────

    async def _status(self, request: Request) -> JSONResponse:
        storage = _storage_dir()
        available = _train_available()
        sessions = self._read_sessions(storage)
        warnings: list[str] = []
        if not available:
            warnings.append(
                "praisonai-train not installed. Install with: pip install praisonai-train"
            )
        return JSONResponse(
            {
                "status": "ok" if available else "degraded",
                "feature": self.name,
                "train_package_available": available,
                "train_package_version": _train_version(),
                "storage_dir": str(storage),
                "storage_backend": "json",
                "session_count": len(sessions),
                "sqlite_supported": False,
                "warnings": warnings,
            }
        )

    async def _list_sessions(self, request: Request) -> JSONResponse:
        storage = _storage_dir()
        try:
            limit = int(request.query_params.get("limit", "50"))
        except ValueError:
            limit = 50
        agent_id = request.query_params.get("agent_id")

        sessions = self._read_sessions(storage)
        if agent_id:
            sessions = [s for s in sessions if s.get("agent_id") == agent_id]
        limited = sessions[: max(limit, 0)]
        return JSONResponse({"sessions": limited, "count": len(limited)})

    async def _get_session(self, request: Request) -> JSONResponse:
        session_id = request.path_params["session_id"]
        storage = _storage_dir()
        path = storage / f"{session_id}.json"
        if not path.exists():
            return JSONResponse(
                {"error": f"Session not found: {session_id}"}, status_code=404
            )
        try:
            data = _load_session_file(path)
        except (OSError, json.JSONDecodeError):
            return JSONResponse(
                {"error": f"Corrupt session JSON: {session_id}"}, status_code=422
            )

        report = data.get("report") or {}
        iterations = list(data.get("iterations") or report.get("iterations") or [])
        best_idx = _best_iteration_index(iterations)
        for idx, it in enumerate(iterations):
            it["is_best"] = idx == best_idx

        summary = _summarize_session(session_id, path, data)
        best_iteration = iterations[best_idx] if best_idx is not None else None

        return JSONResponse(
            {
                "session_id": session_id,
                "report": report,
                "iterations": iterations,
                "best_iteration": best_iteration,
                "best_iteration_num": (
                    best_iteration.get("iteration_num", best_idx + 1)
                    if best_iteration is not None
                    else None
                ),
                "early_stopped": summary["early_stopped"],
                "early_stop_reason": (
                    "score_threshold"
                    if summary["early_stopped"]
                    and _iter_scores(iterations)
                    and _iter_scores(iterations)[-1] >= _EARLY_STOP_THRESHOLD
                    else None
                ),
                "requested_iterations": summary["requested_iterations"],
                "completed_iterations": summary["completed_iterations"],
                "avg_score": summary["avg_score"],
                "improvement": summary["improvement"],
                "passed": summary["passed"],
                "mode": summary["mode"],
                "scenarios": data.get("scenarios") or [],
            }
        )

    async def _apply(self, request: Request) -> JSONResponse:
        session_id = request.path_params["session_id"]
        storage = _storage_dir()
        path = storage / f"{session_id}.json"
        if not path.exists():
            return JSONResponse(
                {"error": f"Session not found: {session_id}"}, status_code=404
            )

        if not _train_available():
            return JSONResponse(
                {
                    "error": "praisonai-train is not installed",
                    "hint": "pip install praisonai-train",
                },
                status_code=503,
            )

        try:
            body = await request.json()
        except Exception:
            body = {}
        agent_id = body.get("agent_id")
        if not agent_id:
            return JSONResponse({"error": "agent_id is required"}, status_code=422)
        iteration = body.get("iteration")

        from .agents import get_agent_registry

        registry = get_agent_registry()
        agent_def = registry.get(agent_id)
        if agent_def is None:
            return JSONResponse(
                {"error": f"Agent not found: {agent_id}"}, status_code=404
            )

        try:
            result = self._apply_training(agent_def, session_id, iteration)
        except Exception as exc:
            logger.exception("apply_training failed for session %s", session_id)
            return JSONResponse({"error": str(exc)}, status_code=500)

        return JSONResponse(
            {
                "success": True,
                "session_id": session_id,
                "agent_id": agent_id,
                "iteration_applied": result.get("iteration_applied"),
                "quality_score": result.get("quality_score"),
                "suggestions_count": result.get("suggestions_count", 0),
                "hook_id": result.get("hook_id", f"training_hook_{session_id}"),
                "message": f"Training profile applied to agent '{agent_id}'",
            }
        )

    def _apply_training(
        self, agent_def: dict[str, Any], session_id: str, iteration: int | None
    ) -> dict[str, Any]:
        from praisonai_train.train.agents import apply_training  # type: ignore
        from praisonaiagents import Agent  # type: ignore

        agent = Agent(
            name=agent_def.get("name", agent_def.get("id", "agent")),
            instructions=agent_def.get("instructions", agent_def.get("description", "")),
            llm=agent_def.get("model"),
        )
        apply_training(agent, session_id=session_id, iteration=iteration)
        hook_id = getattr(agent, "_training_hook_id", f"training_hook_{session_id}")

        storage = _storage_dir()
        applied_iteration = iteration
        quality_score = None
        suggestions_count = 0
        try:
            data = _load_session_file(storage / f"{session_id}.json")
            iterations = list(data.get("iterations") or [])
            idx = _best_iteration_index(iterations) if iteration is None else None
            chosen = None
            if idx is not None:
                chosen = iterations[idx]
                applied_iteration = chosen.get("iteration_num", idx + 1)
            elif iteration is not None:
                for it in iterations:
                    if it.get("iteration_num") == iteration:
                        chosen = it
                        break
            if chosen is not None:
                quality_score = chosen.get("score")
                suggestions_count = len(chosen.get("suggestions") or [])
        except (OSError, json.JSONDecodeError):
            pass

        return {
            "iteration_applied": applied_iteration,
            "quality_score": quality_score,
            "suggestions_count": suggestions_count,
            "hook_id": hook_id,
        }
