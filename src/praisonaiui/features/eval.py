"""Eval feature — agent evaluation and accuracy monitoring for PraisonAIUI.

Surfaces evaluation scores, judge results, and quality metrics from
the praisonaiagents.eval module via gateway.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory evaluation store
_eval_results: deque = deque(maxlen=500)
_eval_judges: Dict[str, Dict[str, Any]] = {}


class PraisonAIEval(BaseFeatureProtocol):
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
        gateway_connected = False
        gateway_agent_count = 0
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                gateway_connected = True
                gateway_agent_count = len(list(gw.list_agents()))
        except (ImportError, Exception):
            pass

        # Check if eval module is available
        eval_available = False
        evaluator_classes = []
        try:
            from praisonaiagents.eval import (
                AccuracyEvaluator, BaseEvaluator, LLMEvaluator,
            )
            eval_available = True
            evaluator_classes = ["AccuracyEvaluator", "BaseEvaluator", "LLMEvaluator"]
        except ImportError:
            pass

        return {
            "status": "ok",
            "feature": self.name,
            "eval_available": eval_available,
            "evaluator_classes": evaluator_classes,
            "total_evaluations": len(_eval_results),
            "active_judges": len(_eval_judges),
            "gateway_connected": gateway_connected,
            "gateway_agent_count": gateway_agent_count,
        }

    def routes(self) -> List[Route]:
        return [
            Route("/api/eval", self._list, methods=["GET"]),
            Route("/api/eval/status", self._status, methods=["GET"]),
            Route("/api/eval/run", self._run_eval, methods=["POST"]),
            Route("/api/eval/judges", self._list_judges, methods=["GET"]),
            Route("/api/eval/scores", self._scores, methods=["GET"]),
        ]

    async def _list(self, request: Request) -> JSONResponse:
        """List recent evaluation results."""
        limit = int(request.query_params.get("limit", "50"))
        agent_id = request.query_params.get("agent_id", None)

        items = list(_eval_results)
        if agent_id:
            items = [e for e in items if e.get("agent_id") == agent_id]
        items = items[-limit:]

        return JSONResponse({
            "evaluations": items,
            "count": len(items),
            "total": len(_eval_results),
        })

    async def _status(self, request: Request) -> JSONResponse:
        """Eval system status."""
        health = await self.health()
        return JSONResponse(health)

    async def _run_eval(self, request: Request) -> JSONResponse:
        """Run an evaluation (or record an evaluation result)."""
        body = await request.json()
        result = {
            "id": f"eval_{int(time.time() * 1000)}",
            "agent_id": body.get("agent_id", "unknown"),
            "evaluator": body.get("evaluator", "manual"),
            "input": body.get("input", ""),
            "output": body.get("output", ""),
            "expected": body.get("expected", ""),
            "score": body.get("score", None),
            "passed": body.get("passed", None),
            "feedback": body.get("feedback", ""),
            "timestamp": time.time(),
        }

        # Try to run actual evaluation if evaluator available
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

        _eval_results.append(result)
        return JSONResponse({"result": result})

    async def _list_judges(self, request: Request) -> JSONResponse:
        """List registered judges."""
        judges = []

        # Try to get judges from SDK
        try:
            from praisonaiagents.eval import get_judges
            sdk_judges = get_judges()
            if isinstance(sdk_judges, dict):
                for name, judge in sdk_judges.items():
                    judges.append({
                        "name": name,
                        "type": type(judge).__name__,
                        "source": "sdk",
                    })
        except (ImportError, AttributeError, Exception):
            pass

        # Local judges
        for name, info in _eval_judges.items():
            judges.append({"name": name, "source": "local", **info})

        return JSONResponse({"judges": judges, "count": len(judges)})

    async def _scores(self, request: Request) -> JSONResponse:
        """Get aggregated scores by agent."""
        scores: Dict[str, Dict[str, Any]] = {}
        for ev in _eval_results:
            aid = ev.get("agent_id", "unknown")
            if aid not in scores:
                scores[aid] = {"agent_id": aid, "total": 0, "scored": 0,
                               "sum_score": 0.0, "passed": 0, "failed": 0}
            scores[aid]["total"] += 1
            if ev.get("score") is not None:
                scores[aid]["scored"] += 1
                scores[aid]["sum_score"] += float(ev["score"])
            if ev.get("passed") is True:
                scores[aid]["passed"] += 1
            elif ev.get("passed") is False:
                scores[aid]["failed"] += 1

        # Compute averages
        for s in scores.values():
            s["avg_score"] = (s["sum_score"] / s["scored"]) if s["scored"] > 0 else None

        return JSONResponse({"scores": list(scores.values())})
