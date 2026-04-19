"""Eval feature — protocol-driven evaluation for PraisonAIUI.

Architecture:
    EvalProtocol (ABC)          <- any backend implements this
      ├── SimpleEvalManager     <- default in-memory (no deps)
      └── SDKEvalManager        <- wraps praisonaiagents.eval

    PraisonAIEval (BaseFeatureProtocol)
      └── delegates to active EvalProtocol implementation
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from collections import deque
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Eval Protocol ────────────────────────────────────────────────────


class EvalProtocol(ABC):
    """Protocol interface for evaluation backends."""

    @abstractmethod
    def list_results(
        self, *, limit: int = 50, agent_id: Optional[str] = None
    ) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def run_evaluation(self, eval_data: Dict[str, Any]) -> Dict[str, Any]:
        """Run or record an evaluation. Returns the result dict."""
        ...

    @abstractmethod
    def list_judges(self) -> List[Dict[str, Any]]: ...

    @abstractmethod
    def get_scores(self) -> List[Dict[str, Any]]:
        """Get aggregated scores by agent."""
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Simple Eval Manager ──────────────────────────────────────────────


class SimpleEvalManager(EvalProtocol):
    """In-memory eval manager — zero dependencies, volatile."""

    def __init__(self) -> None:
        self._results: deque = deque(maxlen=500)
        self._judges: Dict[str, Dict[str, Any]] = {}

    def list_results(
        self, *, limit: int = 50, agent_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        items = list(self._results)
        if agent_id:
            items = [e for e in items if e.get("agent_id") == agent_id]
        return items[-limit:]

    def run_evaluation(self, eval_data: Dict[str, Any]) -> Dict[str, Any]:
        result = {
            "id": f"eval_{int(time.time() * 1000)}",
            "agent_id": eval_data.get("agent_id", "unknown"),
            "evaluator": eval_data.get("evaluator", "manual"),
            "input": eval_data.get("input", ""),
            "output": eval_data.get("output", ""),
            "expected": eval_data.get("expected", ""),
            "score": eval_data.get("score", None),
            "passed": eval_data.get("passed", None),
            "feedback": eval_data.get("feedback", ""),
            "timestamp": time.time(),
        }
        self._results.append(result)
        return result

    def list_judges(self) -> List[Dict[str, Any]]:
        return [{"name": n, "source": "local", **info} for n, info in self._judges.items()]

    def get_scores(self) -> List[Dict[str, Any]]:
        scores: Dict[str, Dict[str, Any]] = {}
        for ev in self._results:
            aid = ev.get("agent_id", "unknown")
            if aid not in scores:
                scores[aid] = {
                    "agent_id": aid,
                    "total": 0,
                    "scored": 0,
                    "sum_score": 0.0,
                    "passed": 0,
                    "failed": 0,
                }
            scores[aid]["total"] += 1
            if ev.get("score") is not None:
                scores[aid]["scored"] += 1
                scores[aid]["sum_score"] += float(ev["score"])
            if ev.get("passed") is True:
                scores[aid]["passed"] += 1
            elif ev.get("passed") is False:
                scores[aid]["failed"] += 1
        for s in scores.values():
            s["avg_score"] = (s["sum_score"] / s["scored"]) if s["scored"] > 0 else None
        return list(scores.values())

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "SimpleEvalManager",
            "total_evaluations": len(self._results),
            "active_judges": len(self._judges),
        }


# ── SDK Eval Manager ─────────────────────────────────────────────────


class SDKEvalManager(EvalProtocol):
    """Wraps praisonaiagents.eval for production use."""

    def __init__(self) -> None:
        from praisonaiagents.eval import AccuracyEvaluator, BaseEvaluator  # noqa: F401

        self._evaluator_classes = ["AccuracyEvaluator", "BaseEvaluator"]
        try:
            from praisonaiagents.eval import LLMEvaluator  # noqa: F401

            self._evaluator_classes.append("LLMEvaluator")
        except ImportError:
            pass
        self._simple = SimpleEvalManager()
        logger.info("SDKEvalManager initialized (evaluators: %s)", self._evaluator_classes)

    def list_results(
        self, *, limit: int = 50, agent_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        return self._simple.list_results(limit=limit, agent_id=agent_id)

    def run_evaluation(self, eval_data: Dict[str, Any]) -> Dict[str, Any]:
        result = self._simple.run_evaluation(eval_data)
        # Try actual SDK evaluation if score not provided
        if result["score"] is None:
            try:
                from praisonaiagents.eval import AccuracyEvaluator

                evaluator = AccuracyEvaluator()
                eval_result = evaluator.evaluate(
                    input_text=result["input"],
                    output_text=result["output"],
                    expected_text=result["expected"],
                )
                result["score"] = getattr(eval_result, "score", None)
                result["passed"] = getattr(eval_result, "passed", None)
                result["feedback"] = getattr(eval_result, "feedback", "")
            except (ImportError, Exception) as e:
                result["feedback"] = f"Auto-eval unavailable: {e}"
        return result

    def list_judges(self) -> List[Dict[str, Any]]:
        judges = list(self._simple.list_judges())
        try:
            from praisonaiagents.eval import get_judges

            sdk_judges = get_judges()
            if isinstance(sdk_judges, dict):
                for name, judge in sdk_judges.items():
                    judges.append({"name": name, "type": type(judge).__name__, "source": "sdk"})
        except (ImportError, AttributeError, Exception):
            pass
        return judges

    def get_scores(self) -> List[Dict[str, Any]]:
        return self._simple.get_scores()

    def health(self) -> Dict[str, Any]:
        h = self._simple.health()
        h["provider"] = "SDKEvalManager"
        h["sdk_available"] = True
        h["evaluator_classes"] = self._evaluator_classes
        return h


# ── Manager singleton ────────────────────────────────────────────────

_eval_manager: Optional[EvalProtocol] = None


def get_eval_manager() -> EvalProtocol:
    """Get the active eval manager (SDK-first, fallback to Simple)."""
    global _eval_manager
    if _eval_manager is None:
        try:
            _eval_manager = SDKEvalManager()
            logger.info("Using SDKEvalManager")
        except Exception as e:
            logger.debug("SDKEvalManager init failed (%s), using SimpleEvalManager", e)
            _eval_manager = SimpleEvalManager()
    return _eval_manager


class EvalFeature(BaseFeatureProtocol):
    """Agent evaluation and accuracy feature."""

    feature_name = "eval"
    feature_description = "Agent evaluation and accuracy monitoring"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        mgr = get_eval_manager()
        return {
            "status": "ok",
            "feature": self.name,
            **mgr.health(),
            **gateway_health(),
        }

    def routes(self) -> List[Route]:
        return [
            Route("/api/eval", self._list, methods=["GET"]),
            Route("/api/eval/status", self._status, methods=["GET"]),
            Route("/api/eval/run", self._run_eval, methods=["POST"]),
            Route("/api/eval/judges", self._list_judges, methods=["GET"]),
            Route("/api/eval/scores", self._scores, methods=["GET"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "eval",
                "help": "Manage agent evaluations (list, scores, judges, run)",
                "commands": {
                    "status": {
                        "help": "Show eval status and judge count",
                        "handler": self._cli_status,
                    },
                    "list": {
                        "help": "List recent evaluations",
                        "handler": self._cli_list,
                    },
                    "scores": {
                        "help": "Show aggregated scores by agent",
                        "handler": self._cli_scores,
                    },
                    "judges": {
                        "help": "List registered judges",
                        "handler": self._cli_judges,
                    },
                    "run": {
                        "help": "Run an evaluation (--input, --output, --expected)",
                        "handler": self._cli_run,
                    },
                },
            }
        ]

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_status(self) -> str:
        mgr = get_eval_manager()
        h = mgr.health()
        lines = ["Eval Status:"]
        lines.append(f"  Provider: {h.get('provider', 'unknown')}")
        lines.append(f"  Total evaluations: {h.get('total_evaluations', 0)}")
        lines.append(f"  Active judges: {h.get('active_judges', 0)}")
        if h.get("sdk_available"):
            lines.append(f"  SDK: available ({', '.join(h.get('evaluator_classes', []))})")
        return "\n".join(lines)

    def _cli_list(self, limit: int = 20, agent_id: str = "") -> str:
        mgr = get_eval_manager()
        items = mgr.list_results(limit=limit, agent_id=agent_id or None)
        if not items:
            return "No evaluations recorded yet."
        lines = [f"Evaluations ({len(items)}):"]
        for ev in items:
            score = ev.get("score", "—")
            passed = "✓" if ev.get("passed") else ("✗" if ev.get("passed") is False else "—")
            agent = ev.get("agent_id", "unknown")
            lines.append(f"  [{ev.get('id', '')}] agent={agent} score={score} passed={passed}")
        return "\n".join(lines)

    def _cli_scores(self) -> str:
        mgr = get_eval_manager()
        scores = mgr.get_scores()
        if not scores:
            return "No scores yet — run some evaluations first."
        lines = ["Agent Scores:"]
        for s in scores:
            avg = f"{s['avg_score']:.2f}" if s.get("avg_score") is not None else "—"
            lines.append(f"  {s['agent_id']}: avg={avg} passed={s['passed']}/{s['total']}")
        return "\n".join(lines)

    def _cli_judges(self) -> str:
        mgr = get_eval_manager()
        judges = mgr.list_judges()
        if not judges:
            return "No judges registered."
        lines = [f"Judges ({len(judges)}):"]
        for j in judges:
            lines.append(f"  {j.get('name', '?')} (source={j.get('source', '?')})")
        return "\n".join(lines)

    def _cli_run(
        self, input: str = "", output: str = "", expected: str = "", agent_id: str = "cli"
    ) -> str:
        if not input:
            return "Usage: eval run --input <text> --output <text> --expected <text>"
        mgr = get_eval_manager()
        result = mgr.run_evaluation(
            {
                "agent_id": agent_id,
                "input": input,
                "output": output,
                "expected": expected,
            }
        )
        score = result.get("score", "—")
        passed = "✓" if result.get("passed") else ("✗" if result.get("passed") is False else "—")
        return f"✓ Evaluation {result['id']}: score={score} passed={passed}\n  Feedback: {result.get('feedback', '—')}"

    async def _list(self, request: Request) -> JSONResponse:
        mgr = get_eval_manager()
        limit = int(request.query_params.get("limit", "50"))
        agent_id = request.query_params.get("agent_id", None)
        items = mgr.list_results(limit=limit, agent_id=agent_id)
        return JSONResponse(
            {
                "evaluations": items,
                "count": len(items),
                "total": len(items),
            }
        )

    async def _status(self, request: Request) -> JSONResponse:
        health = await self.health()
        return JSONResponse(health)

    async def _run_eval(self, request: Request) -> JSONResponse:
        mgr = get_eval_manager()
        body = await request.json()
        result = mgr.run_evaluation(body)
        return JSONResponse({"result": result})

    async def _list_judges(self, request: Request) -> JSONResponse:
        mgr = get_eval_manager()
        judges = mgr.list_judges()
        return JSONResponse({"judges": judges, "count": len(judges)})

    async def _scores(self, request: Request) -> JSONResponse:
        mgr = get_eval_manager()
        scores = mgr.get_scores()
        return JSONResponse({"scores": scores})


# Backward-compat alias
PraisonAIEval = EvalFeature
