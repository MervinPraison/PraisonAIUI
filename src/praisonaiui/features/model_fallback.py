"""Model fallback feature — expose LiteLLM routing config in UI (Gap 10).

Protocol-driven: config for model fallback chains.
Config-driven: users specify fallback order in YAML.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Protocol ─────────────────────────────────────────────────────


class ModelFallbackProtocol:
    """Protocol for model fallback configuration."""

    def get_models(self) -> List[Dict[str, Any]]: ...

    def get_fallback_chain(self) -> List[str]: ...

    def set_fallback_chain(self, models: List[str]) -> None: ...


# ── Implementation ───────────────────────────────────────────────


class ModelFallbackManager(ModelFallbackProtocol):
    """Default model fallback manager."""

    def __init__(self) -> None:
        self._fallback_chain: List[str] = []
        self._models: List[Dict[str, Any]] = []

    def get_models(self) -> List[Dict[str, Any]]:
        if not self._models:
            self._discover_models()
        return self._models

    def _discover_models(self) -> None:
        """Try to discover available models from litellm."""
        try:
            import litellm

            self._models = [
                {"id": m, "provider": "litellm"} for m in getattr(litellm, "model_list", []) or []
            ]
        except ImportError:
            pass

        if not self._models:
            # Fallback: list common models
            self._models = [
                {"id": "gpt-4o", "provider": "openai"},
                {"id": "gpt-4o-mini", "provider": "openai"},
                {"id": "claude-3-5-sonnet", "provider": "anthropic"},
                {"id": "gemini-2.0-flash", "provider": "google"},
            ]

    def get_fallback_chain(self) -> List[str]:
        return self._fallback_chain

    def set_fallback_chain(self, models: List[str]) -> None:
        self._fallback_chain = models


_fallback_manager: Optional[ModelFallbackManager] = None


def get_fallback_manager() -> ModelFallbackManager:
    global _fallback_manager
    if _fallback_manager is None:
        _fallback_manager = ModelFallbackManager()
    return _fallback_manager


# ── HTTP Handlers ────────────────────────────────────────────────


async def _list_models(request: Request) -> JSONResponse:
    mgr = get_fallback_manager()
    return JSONResponse(
        {
            "models": mgr.get_models(),
            "fallback_chain": mgr.get_fallback_chain(),
        }
    )


async def _set_fallback(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    models = body.get("models", [])
    if not isinstance(models, list):
        return JSONResponse({"error": "models must be a list"}, status_code=400)

    mgr = get_fallback_manager()
    mgr.set_fallback_chain(models)
    return JSONResponse(
        {
            "status": "ok",
            "fallback_chain": mgr.get_fallback_chain(),
        }
    )


# ── Feature ──────────────────────────────────────────────────────


class ModelFallbackFeature(BaseFeatureProtocol):
    """Model fallback feature — configure model fallback chains."""

    feature_name = "model_fallback"
    feature_description = "Model fallback chain configuration"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/models", _list_models, methods=["GET"]),
            Route("/api/models/fallback", _set_fallback, methods=["PUT"]),
        ]


# Backward-compat alias
PraisonAIModelFallback = ModelFallbackFeature
