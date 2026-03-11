"""Usage analytics feature — protocol-driven token and cost tracking.

Architecture:
    UsageProtocol (ABC)              <- any backend implements this
      └── SimpleUsageManager         <- default in-memory with disk persistence

    SDK gap: no token/cost tracking API in praisonaiagents.

    PraisonAIUsage (BaseFeatureProtocol)
      └── delegates to module-level functions (SimpleUsageManager pattern)
"""

from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol


# ── Usage Protocol ───────────────────────────────────────────────────


class UsageProtocol(ABC):
    """Protocol interface for usage tracking backends."""

    @abstractmethod
    def track_usage(self, model: str, input_tokens: int, output_tokens: int,
                    session_id: str = "unknown", agent_name: str = "unknown") -> Dict[str, Any]: ...

    @abstractmethod
    def get_summary(self) -> Dict[str, Any]: ...

    @abstractmethod
    def list_records(self, *, limit: int = 100) -> List[Dict[str, Any]]: ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}

# Default cost table (USD per 1K tokens)
DEFAULT_COST_TABLE = {
    # OpenAI
    "gpt-4o": {"input": 0.0025, "output": 0.01},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4-turbo": {"input": 0.01, "output": 0.03},
    "gpt-4": {"input": 0.03, "output": 0.06},
    "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},
    "o1": {"input": 0.015, "output": 0.06},
    "o1-mini": {"input": 0.003, "output": 0.012},
    "o1-preview": {"input": 0.015, "output": 0.06},
    "o3-mini": {"input": 0.0011, "output": 0.0044},
    # Anthropic
    "claude-3-5-sonnet": {"input": 0.003, "output": 0.015},
    "claude-3-5-haiku": {"input": 0.0008, "output": 0.004},
    "claude-3-opus": {"input": 0.015, "output": 0.075},
    "claude-3-sonnet": {"input": 0.003, "output": 0.015},
    "claude-3-haiku": {"input": 0.00025, "output": 0.00125},
    # Google
    "gemini-2.0-flash": {"input": 0.0001, "output": 0.0004},
    "gemini-1.5-pro": {"input": 0.00125, "output": 0.005},
    "gemini-1.5-flash": {"input": 0.000075, "output": 0.0003},
    # Groq
    "llama-3.3-70b": {"input": 0.00059, "output": 0.00079},
    "llama-3.1-8b": {"input": 0.00005, "output": 0.00008},
    "mixtral-8x7b": {"input": 0.00024, "output": 0.00024},
    # Default fallback
    "default": {"input": 0.001, "output": 0.002},
}

# In-memory storage
_usage_records: deque = deque(maxlen=10000)  # Ring buffer for time-series
_aggregates: Dict[str, Any] = {
    "total_requests": 0,
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "total_cost": 0.0,
    "by_model": {},
    "by_session": {},
    "by_agent": {},
    "by_hour": {},  # Hourly aggregates for charts
}
_cost_table: Dict[str, Dict[str, float]] = DEFAULT_COST_TABLE.copy()
_data_file: Path | None = None


def _get_model_cost(model: str) -> Dict[str, float]:
    """Get cost rates for a model, with fuzzy matching."""
    model_lower = model.lower()
    
    # Exact match
    if model_lower in _cost_table:
        return _cost_table[model_lower]
    
    # Fuzzy match (check if model contains known model name)
    for known_model, costs in _cost_table.items():
        if known_model in model_lower or model_lower in known_model:
            return costs
    
    return _cost_table.get("default", {"input": 0.001, "output": 0.002})


def _calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate cost in USD for a request."""
    costs = _get_model_cost(model)
    input_cost = (input_tokens / 1000) * costs["input"]
    output_cost = (output_tokens / 1000) * costs["output"]
    return round(input_cost + output_cost, 6)


def _get_hour_key(timestamp: float) -> str:
    """Get hour key for time-series aggregation."""
    dt = datetime.fromtimestamp(timestamp)
    return dt.strftime("%Y-%m-%d-%H")


def track_usage(
    model: str = "unknown",
    input_tokens: int = 0,
    output_tokens: int = 0,
    session_id: str = "unknown",
    agent_name: str = "unknown",
) -> Dict[str, Any]:
    """Track a usage event with cost calculation.
    
    Returns the recorded usage entry.
    """
    timestamp = time.time()
    total_tokens = input_tokens + output_tokens
    cost = _calculate_cost(model, input_tokens, output_tokens)
    hour_key = _get_hour_key(timestamp)
    
    # Create record
    record = {
        "timestamp": timestamp,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "cost": cost,
        "session_id": session_id,
        "agent_name": agent_name,
    }
    
    # Add to ring buffer
    _usage_records.append(record)
    
    # Update aggregates
    _aggregates["total_requests"] += 1
    _aggregates["total_input_tokens"] += input_tokens
    _aggregates["total_output_tokens"] += output_tokens
    _aggregates["total_cost"] += cost
    
    # By model
    if model not in _aggregates["by_model"]:
        _aggregates["by_model"][model] = {
            "requests": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0
        }
    _aggregates["by_model"][model]["requests"] += 1
    _aggregates["by_model"][model]["input_tokens"] += input_tokens
    _aggregates["by_model"][model]["output_tokens"] += output_tokens
    _aggregates["by_model"][model]["cost"] += cost
    
    # By session
    if session_id not in _aggregates["by_session"]:
        _aggregates["by_session"][session_id] = {
            "requests": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0
        }
    _aggregates["by_session"][session_id]["requests"] += 1
    _aggregates["by_session"][session_id]["input_tokens"] += input_tokens
    _aggregates["by_session"][session_id]["output_tokens"] += output_tokens
    _aggregates["by_session"][session_id]["cost"] += cost
    
    # By agent
    if agent_name not in _aggregates["by_agent"]:
        _aggregates["by_agent"][agent_name] = {
            "requests": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0
        }
    _aggregates["by_agent"][agent_name]["requests"] += 1
    _aggregates["by_agent"][agent_name]["input_tokens"] += input_tokens
    _aggregates["by_agent"][agent_name]["output_tokens"] += output_tokens
    _aggregates["by_agent"][agent_name]["cost"] += cost
    
    # By hour (for time-series)
    if hour_key not in _aggregates["by_hour"]:
        _aggregates["by_hour"][hour_key] = {
            "requests": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0
        }
    _aggregates["by_hour"][hour_key]["requests"] += 1
    _aggregates["by_hour"][hour_key]["input_tokens"] += input_tokens
    _aggregates["by_hour"][hour_key]["output_tokens"] += output_tokens
    _aggregates["by_hour"][hour_key]["cost"] += cost
    
    # Persist periodically (every 10 requests)
    if _data_file and _aggregates["total_requests"] % 10 == 0:
        _save_data()
    
    return record


def _save_data() -> None:
    """Save usage data to disk."""
    if not _data_file:
        return
    try:
        data = {
            "aggregates": _aggregates,
            "records": list(_usage_records)[-1000:],  # Last 1000 records
            "saved_at": time.time(),
        }
        _data_file.parent.mkdir(parents=True, exist_ok=True)
        with open(_data_file, "w") as f:
            json.dump(data, f)
    except Exception:
        pass  # Silently fail


def _load_data() -> None:
    """Load usage data from disk."""
    global _aggregates, _usage_records
    if not _data_file or not _data_file.exists():
        return
    try:
        with open(_data_file) as f:
            data = json.load(f)
        _aggregates.update(data.get("aggregates", {}))
        for record in data.get("records", []):
            _usage_records.append(record)
    except Exception:
        pass


def set_data_file(path: Path) -> None:
    """Set the data file path for persistence."""
    global _data_file
    _data_file = path
    _load_data()


def set_cost_table(table: Dict[str, Dict[str, float]]) -> None:
    """Update the cost table with custom pricing."""
    _cost_table.update(table)


class UsageFeature(BaseFeatureProtocol):
    """Enhanced usage analytics with cost tracking and time-series data."""

    feature_name = "usage"
    feature_description = "Token usage and cost analytics"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/usage", self._summary, methods=["GET"]),
            Route("/api/usage/summary", self._summary, methods=["GET"]),
            Route("/api/usage/details", self._details, methods=["GET"]),
            Route("/api/usage/models", self._models, methods=["GET"]),
            Route("/api/usage/sessions", self._sessions, methods=["GET"]),
            Route("/api/usage/agents", self._agents, methods=["GET"]),
            Route("/api/usage/timeseries", self._timeseries, methods=["GET"]),
            Route("/api/usage/costs", self._costs, methods=["GET"]),
            Route("/api/usage/track", self._track, methods=["POST"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "usage",
            "help": "View usage statistics",
            "commands": {
                "summary": {"help": "Show usage summary", "handler": self._cli_summary},
                "models": {"help": "Show per-model usage", "handler": self._cli_models},
                "cost": {"help": "Show total cost", "handler": self._cli_cost},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        return {
            "status": "ok",
            "feature": self.name,
            "total_requests": _aggregates["total_requests"],
            "total_cost": round(_aggregates["total_cost"], 4),
            "models_tracked": len(_aggregates["by_model"]),
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _summary(self, request: Request) -> JSONResponse:
        """Return usage summary with totals and averages.
        
        Response format matches the dashboard frontend expectations:
        {"usage": {..., "by_model": {...}, "by_session": {...}}, "sessions": {...}}
        """
        total_reqs = _aggregates["total_requests"]
        total_cost = _aggregates["total_cost"]
        total_tokens = _aggregates["total_input_tokens"] + _aggregates["total_output_tokens"]
        avg_cost = total_cost / total_reqs if total_reqs > 0 else 0
        
        # Build by_model with 'tokens' key for dashboard compatibility
        by_model = {}
        for model, stats in _aggregates["by_model"].items():
            by_model[model] = {
                "requests": stats["requests"],
                "tokens": stats["input_tokens"] + stats["output_tokens"],
                "input_tokens": stats["input_tokens"],
                "output_tokens": stats["output_tokens"],
                "cost": round(stats["cost"], 4),
            }
        
        # Build by_session with 'tokens' key for dashboard compatibility
        by_session = {}
        for session_id, stats in _aggregates["by_session"].items():
            by_session[session_id] = {
                "requests": stats["requests"],
                "tokens": stats["input_tokens"] + stats["output_tokens"],
                "input_tokens": stats["input_tokens"],
                "output_tokens": stats["output_tokens"],
                "cost": round(stats["cost"], 4),
            }
        
        return JSONResponse({
            # Top-level fields for direct API consumers
            "total_requests": total_reqs,
            "total_input_tokens": _aggregates["total_input_tokens"],
            "total_output_tokens": _aggregates["total_output_tokens"],
            "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost, 4),
            "avg_cost_per_request": round(avg_cost, 6),
            "models_count": len(_aggregates["by_model"]),
            "sessions_count": len(_aggregates["by_session"]),
            "agents_count": len(_aggregates["by_agent"]),
            # Dashboard-compatible nested structure
            "usage": {
                "total_requests": total_reqs,
                "total_tokens": total_tokens,
                "total_cost": round(total_cost, 4),
                "total_input_tokens": _aggregates["total_input_tokens"],
                "total_output_tokens": _aggregates["total_output_tokens"],
                "by_model": by_model,
                "by_session": by_session,
            },
            "sessions": {
                "total": len(_aggregates["by_session"]),
                "active": 0,  # Feature doesn't track active tasks
            },
        })

    async def _details(self, request: Request) -> JSONResponse:
        """Return detailed usage records for analysis."""
        limit = int(request.query_params.get("limit", 100))
        records = list(_usage_records)[-limit:]
        return JSONResponse({
            "records": records,
            "count": len(records),
            "total_available": len(_usage_records),
        })

    async def _models(self, request: Request) -> JSONResponse:
        """Return per-model breakdown."""
        models = []
        for model, stats in _aggregates["by_model"].items():
            models.append({
                "model": model,
                "requests": stats["requests"],
                "input_tokens": stats["input_tokens"],
                "output_tokens": stats["output_tokens"],
                "total_tokens": stats["input_tokens"] + stats["output_tokens"],
                "cost_usd": round(stats["cost"], 4),
            })
        # Sort by cost descending
        models.sort(key=lambda x: x["cost_usd"], reverse=True)
        return JSONResponse({"models": models, "count": len(models)})

    async def _sessions(self, request: Request) -> JSONResponse:
        """Return per-session breakdown."""
        sessions = []
        for session_id, stats in _aggregates["by_session"].items():
            sessions.append({
                "session_id": session_id,
                "requests": stats["requests"],
                "input_tokens": stats["input_tokens"],
                "output_tokens": stats["output_tokens"],
                "cost_usd": round(stats["cost"], 4),
            })
        sessions.sort(key=lambda x: x["cost_usd"], reverse=True)
        return JSONResponse({"sessions": sessions[:50], "count": len(sessions)})

    async def _agents(self, request: Request) -> JSONResponse:
        """Return per-agent breakdown."""
        agents = []
        for agent_name, stats in _aggregates["by_agent"].items():
            agents.append({
                "agent": agent_name,
                "requests": stats["requests"],
                "input_tokens": stats["input_tokens"],
                "output_tokens": stats["output_tokens"],
                "cost_usd": round(stats["cost"], 4),
            })
        agents.sort(key=lambda x: x["cost_usd"], reverse=True)
        return JSONResponse({"agents": agents, "count": len(agents)})

    async def _timeseries(self, request: Request) -> JSONResponse:
        """Return time-series data for charts."""
        hours = int(request.query_params.get("hours", 24))
        now = datetime.now()
        
        # Generate hour keys for the requested range
        data_points = []
        for i in range(hours, -1, -1):
            dt = now - timedelta(hours=i)
            hour_key = dt.strftime("%Y-%m-%d-%H")
            hour_label = dt.strftime("%H:00")
            
            stats = _aggregates["by_hour"].get(hour_key, {
                "requests": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0
            })
            
            data_points.append({
                "hour": hour_label,
                "hour_key": hour_key,
                "requests": stats["requests"],
                "tokens": stats["input_tokens"] + stats["output_tokens"],
                "cost": round(stats["cost"], 4),
            })
        
        return JSONResponse({
            "timeseries": data_points,
            "hours": hours,
            "total_cost": round(sum(p["cost"] for p in data_points), 4),
            "total_requests": sum(p["requests"] for p in data_points),
        })

    async def _costs(self, request: Request) -> JSONResponse:
        """Return the cost table."""
        return JSONResponse({
            "cost_table": _cost_table,
            "currency": "USD",
            "unit": "per 1K tokens",
        })

    async def _track(self, request: Request) -> JSONResponse:
        """Manually track a usage event (for testing/integration)."""
        body = await request.json()
        record = track_usage(
            model=body.get("model", "unknown"),
            input_tokens=body.get("input_tokens", 0),
            output_tokens=body.get("output_tokens", 0),
            session_id=body.get("session_id", "unknown"),
            agent_name=body.get("agent_name", "unknown"),
        )
        return JSONResponse(record, status_code=201)

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_summary(self) -> str:
        total = _aggregates["total_requests"]
        cost = _aggregates["total_cost"]
        tokens = _aggregates["total_input_tokens"] + _aggregates["total_output_tokens"]
        return f"Requests: {total} | Tokens: {tokens:,} | Cost: ${cost:.4f}"

    def _cli_models(self) -> str:
        if not _aggregates["by_model"]:
            return "No model usage tracked"
        lines = []
        for model, stats in sorted(
            _aggregates["by_model"].items(),
            key=lambda x: x[1]["cost"],
            reverse=True
        ):
            lines.append(f"  {model}: {stats['requests']} reqs, ${stats['cost']:.4f}")
        return "\n".join(lines)

    def _cli_cost(self) -> str:
        return f"Total cost: ${_aggregates['total_cost']:.4f} USD"


# Backward-compat alias
PraisonAIUsage = UsageFeature
