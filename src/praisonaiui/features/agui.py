"""AG-UI protocol feature — POST /agui SSE streaming for CopilotKit clients."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Union

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


def _resolve_agent(agent_name: Optional[str] = None):
    """Resolve a registered PraisonAI agent instance."""
    from praisonaiui.server import _agents

    if agent_name and agent_name in _agents:
        return _agents[agent_name]["agent"]

    if len(_agents) == 1:
        return next(iter(_agents.values()))["agent"]

    if _agents:
        first = next(iter(_agents.keys()))
        return _agents[first]["agent"]

    try:
        from praisonaiui.server import get_provider

        provider = get_provider()
        if hasattr(provider, "agents") and provider.agents:
            return provider.agents[0]
    except Exception:
        pass

    return None


async def _post_agui(request: Request) -> Union[StreamingResponse, JSONResponse]:
    try:
        from praisonaiagents.ui.agui import AGUI
        from praisonaiagents.ui.agui.encoder import EventEncoder
        from praisonaiagents.ui.agui.types import RunAgentInput
    except ImportError:
        return JSONResponse(
            {"error": "AG-UI requires praisonaiagents. Install: pip install aiui[praisonai]"},
            status_code=503,
        )

    body = await request.json()
    agent_name = body.get("agent_name") or request.query_params.get("agent")
    agent = _resolve_agent(agent_name)
    if agent is None:
        return JSONResponse({"error": "No agent registered"}, status_code=503)

    try:
        run_input = RunAgentInput.model_validate(body)
    except Exception as exc:
        return JSONResponse({"error": f"Invalid AG-UI input: {exc}"}, status_code=400)

    agui = AGUI(agent=agent)
    encoder = EventEncoder()

    async def event_stream():
        async for event in agui._run_agent(run_input):
            yield encoder.encode(event)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    )


async def _agui_status(_request: Request) -> JSONResponse:
    agent = _resolve_agent()
    return JSONResponse(
        {
            "status": "available" if agent else "unavailable",
            "agent_registered": agent is not None,
        }
    )


async def _agui_options(_request: Request) -> Response:
    return JSONResponse({}, headers={"Access-Control-Allow-Origin": "*"})


class AguiFeature(BaseFeatureProtocol):
    """AG-UI SSE endpoint at POST /agui."""

    feature_name = "agui"
    feature_description = "AG-UI protocol (CopilotKit-compatible SSE)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/agui", _post_agui, methods=["POST"]),
            Route("/agui", _agui_options, methods=["OPTIONS"]),
            Route("/agui/status", _agui_status, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        agent = _resolve_agent()
        return {
            "status": "ok" if agent else "degraded",
            "feature": self.name,
            "agent_available": agent is not None,
        }
