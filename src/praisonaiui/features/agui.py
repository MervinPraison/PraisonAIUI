"""AG-UI protocol feature — POST /agui SSE streaming for CopilotKit clients."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Union

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol, sdk_installed
from ._gateway_helpers import gateway_health

logger = logging.getLogger(__name__)


def _resolve_agent(agent_name: Optional[str] = None, *, create: bool = True):
    """Resolve a PraisonAI agent instance for AG-UI runs.

    Lookup order:
      1. Explicitly registered agents (``praisonaiui.register_agent``)
      2. Active gateway agents (``AIUIGateway``)
      3. Existing provider agents (``provider._find_existing_agent`` / ``_agent`` / ``agents``)
      4. When *create* is True and ``praisonaiagents`` is installed, lazily
         build the default/CRUD agent via ``provider._get_or_create_agent``.
    """
    from praisonaiui.server import _agents

    if agent_name and agent_name in _agents:
        return _agents[agent_name]["agent"]

    if len(_agents) == 1:
        return next(iter(_agents.values()))["agent"]

    if _agents:
        first = next(iter(_agents.keys()))
        return _agents[first]["agent"]

    # 2. Gateway-registered agents
    try:
        from ._gateway_ref import get_gateway

        gw = get_gateway()
        if gw is not None:
            if agent_name:
                direct = gw.get_agent(agent_name)
                if direct is not None:
                    return direct
                for aid in gw.list_agents():
                    gw_agent = gw.get_agent(aid)
                    if gw_agent is not None and getattr(gw_agent, "name", None) == agent_name:
                        return gw_agent
            for aid in gw.list_agents():
                gw_agent = gw.get_agent(aid)
                if gw_agent is not None:
                    return gw_agent
    except Exception:
        pass

    # 3. Provider-held or lazily creatable agent
    try:
        from praisonaiui.server import get_provider

        provider = get_provider()
        finder = getattr(provider, "_find_existing_agent", None)
        if callable(finder):
            found = finder(agent_name=agent_name)
            if found is not None:
                return found
        single = getattr(provider, "_agent", None)
        if single is not None:
            return single
        for attr in ("agents", "_agents"):
            bag = getattr(provider, attr, None)
            if bag:
                if agent_name:
                    for item in bag:
                        if getattr(item, "name", None) == agent_name:
                            return item
                return bag[0]
        if create and sdk_installed():
            creator = getattr(provider, "_get_or_create_agent", None)
            if callable(creator):
                return creator(agent_name=agent_name)
    except Exception:
        pass

    return None


def _agent_available() -> bool:
    """Fast, side-effect-free check for whether AG-UI can serve an agent."""
    if _resolve_agent(create=False) is not None:
        return True
    if not sdk_installed():
        return False
    try:
        from praisonaiui.server import get_provider

        provider = get_provider()
        return callable(getattr(provider, "_get_or_create_agent", None))
    except Exception:
        return False


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
    available = _agent_available()
    return JSONResponse(
        {
            "status": "available" if available else "unavailable",
            "agent_registered": available,
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
        available = _agent_available()
        h: Dict[str, Any] = {
            "status": "ok" if available else "degraded",
            "feature": self.name,
            "agent_available": available,
        }
        h.update(gateway_health())
        return h
