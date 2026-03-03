"""Integration module for connecting PraisonAIUI with praisonai backend.

This module provides utilities to use PraisonAIUI's React frontend
with the praisonai WebSocketGateway backend instead of the standalone server.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from praisonaiagents import Agent

logger = logging.getLogger(__name__)

# Check if praisonai is available
try:
    from praisonai.gateway import WebSocketGateway
    from praisonaiagents import Agent as PraisonAgent
    HAS_PRAISONAI = True
except ImportError:
    HAS_PRAISONAI = False
    WebSocketGateway = None
    PraisonAgent = None


def check_praisonai_available() -> bool:
    """Check if praisonai package is available."""
    return HAS_PRAISONAI


class AIUIGateway:
    """Extended WebSocketGateway with static file serving for PraisonAIUI.

    This class wraps the praisonai WebSocketGateway and adds:
    - Static file serving for the React SPA
    - REST API endpoints for UI configuration
    - Integration with PraisonAIUI's YAML compiler

    Example:
        from praisonaiui.integration import AIUIGateway
        from praisonaiagents import Agent

        gateway = AIUIGateway(port=8080, static_dir="./dist")
        agent = Agent(name="assistant", instructions="You are helpful.")
        gateway.register_agent(agent)

        await gateway.start()
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8080,
        static_dir: Optional[str] = None,
        ui_config: Optional[Dict[str, Any]] = None,
    ):
        """Initialize the AIUI Gateway.

        Args:
            host: Host to bind to
            port: Port to listen on
            static_dir: Directory containing the React SPA build
            ui_config: UI configuration dict (from compiler output)
        """
        if not HAS_PRAISONAI:
            raise ImportError(
                "praisonai package is required for integration mode. "
                "Install with: pip install praisonai"
            )

        self._host = host
        self._port = port
        self._static_dir = Path(static_dir) if static_dir else None
        self._ui_config = ui_config or {}

        # Internal gateway instance
        self._gateway: Optional[WebSocketGateway] = None
        self._is_running = False
        self._server = None

    def register_agent(self, agent: "Agent", agent_id: Optional[str] = None) -> str:
        """Register an agent with the gateway."""
        if self._gateway is None:
            self._init_gateway()
        return self._gateway.register_agent(agent, agent_id)

    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the gateway."""
        if self._gateway:
            return self._gateway.unregister_agent(agent_id)
        return False

    def list_agents(self) -> List[str]:
        """List all registered agent IDs."""
        if self._gateway:
            return self._gateway.list_agents()
        return []

    def set_ui_config(self, config: Dict[str, Any]) -> None:
        """Set the UI configuration."""
        self._ui_config = config

    def _init_gateway(self) -> None:
        """Initialize the internal WebSocketGateway."""
        from praisonaiagents.gateway import GatewayConfig

        config = GatewayConfig(host=self._host, port=self._port)
        self._gateway = WebSocketGateway(
            host=self._host,
            port=self._port,
            config=config,
        )

    async def start(self) -> None:
        """Start the gateway server with static file serving."""
        if self._is_running:
            logger.warning("Gateway already running")
            return

        if self._gateway is None:
            self._init_gateway()

        try:
            import uvicorn
            from starlette.applications import Starlette
            from starlette.responses import FileResponse, JSONResponse, Response
            from starlette.routing import Mount, Route, WebSocketRoute
            from starlette.staticfiles import StaticFiles
            from starlette.websockets import WebSocket, WebSocketDisconnect
        except ImportError:
            raise ImportError(
                "Gateway requires starlette and uvicorn. "
                "Install with: pip install starlette uvicorn"
            )

        # Build routes
        routes = []

        # Health endpoint
        async def health(request):
            return JSONResponse(self._gateway.health())
        routes.append(Route("/health", health, methods=["GET"]))

        # Info endpoint
        async def info(request):
            return JSONResponse({
                "name": "PraisonAIUI Gateway",
                "version": "1.0.0",
                "agents": self._gateway.list_agents(),
                "sessions": len(self._gateway._sessions),
                "clients": len(self._gateway._clients),
            })
        routes.append(Route("/info", info, methods=["GET"]))

        # UI config endpoint
        async def ui_config(request):
            return JSONResponse(self._ui_config)
        routes.append(Route("/ui-config.json", ui_config, methods=["GET"]))

        # Agents list endpoint (REST API)
        async def agents_list(request):
            agents = []
            for aid in self._gateway.list_agents():
                agent = self._gateway.get_agent(aid)
                if agent:
                    agents.append({
                        "id": aid,
                        "name": getattr(agent, "name", aid),
                        "description": getattr(agent, "instructions", "")[:100],
                    })
            return JSONResponse({"agents": agents})
        routes.append(Route("/agents", agents_list, methods=["GET"]))

        # WebSocket endpoint - delegate to gateway
        async def websocket_endpoint(websocket: WebSocket):
            await self._gateway._handle_websocket(websocket)

        # Override gateway's websocket handler
        import uuid

        async def ws_handler(websocket: WebSocket):
            await websocket.accept()
            client_id = str(uuid.uuid4())
            self._gateway._clients[client_id] = websocket

            logger.info(f"Client connected: {client_id}")

            from praisonaiagents.gateway import EventType, GatewayEvent
            await self._gateway.emit(GatewayEvent(
                type=EventType.CONNECT,
                data={"client_id": client_id},
                source=client_id,
            ))

            try:
                while True:
                    data = await websocket.receive_json()
                    await self._gateway._handle_client_message(client_id, data)
            except WebSocketDisconnect:
                logger.info(f"Client disconnected: {client_id}")
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
            finally:
                self._gateway._clients.pop(client_id, None)
                session_id = self._gateway._client_sessions.pop(client_id, None)
                if session_id:
                    self._gateway.close_session(session_id)

                await self._gateway.emit(GatewayEvent(
                    type=EventType.DISCONNECT,
                    data={"client_id": client_id},
                    source=client_id,
                ))

        routes.append(WebSocketRoute("/ws", ws_handler))

        # Static files for React SPA
        if self._static_dir and self._static_dir.exists():
            # Serve index.html for SPA routes
            async def spa_fallback(request):
                index_path = self._static_dir / "index.html"
                if index_path.exists():
                    return FileResponse(index_path)
                return Response("Not Found", status_code=404)

            # Mount static assets
            assets_dir = self._static_dir / "assets"
            if assets_dir.exists():
                routes.append(
                    Mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
                )

            # Serve specific static files
            for static_file in ["icon.svg", "favicon.ico", "manifest.json"]:
                file_path = self._static_dir / static_file
                if file_path.exists():
                    async def serve_file(request, path=file_path):
                        return FileResponse(path)
                    routes.append(Route(f"/{static_file}", serve_file, methods=["GET"]))

            # SPA fallback for all other routes
            routes.append(Route("/{path:path}", spa_fallback, methods=["GET"]))
            routes.append(Route("/", spa_fallback, methods=["GET"]))

        app = Starlette(routes=routes)

        config = uvicorn.Config(
            app,
            host=self._host,
            port=self._port,
            log_level="info",
        )
        self._server = uvicorn.Server(config)

        self._is_running = True
        logger.info(f"AIUI Gateway started on http://{self._host}:{self._port}")

        await self._server.serve()

    async def stop(self) -> None:
        """Stop the gateway server."""
        if not self._is_running:
            return

        self._is_running = False

        if self._gateway:
            await self._gateway.stop()

        if self._server:
            self._server.should_exit = True

        logger.info("AIUI Gateway stopped")


def create_gateway_from_yaml(
    config_path: str,
    static_dir: Optional[str] = None,
) -> AIUIGateway:
    """Create an AIUIGateway from a YAML configuration file.

    Args:
        config_path: Path to aiui.template.yaml or gateway.yaml
        static_dir: Directory containing the React SPA build

    Returns:
        Configured AIUIGateway instance
    """
    import yaml

    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config not found: {config_path}")

    with open(config_path) as f:
        config = yaml.safe_load(f)

    # Extract gateway settings
    gateway_cfg = config.get("gateway", {})
    host = gateway_cfg.get("host", "127.0.0.1")
    port = gateway_cfg.get("port", 8080)

    # Create gateway
    gateway = AIUIGateway(
        host=host,
        port=port,
        static_dir=static_dir,
        ui_config=config,
    )

    # Create agents from config
    agents_cfg = config.get("agents", {})
    for agent_id, agent_def in agents_cfg.items():
        if not HAS_PRAISONAI:
            logger.warning("praisonai not available, skipping agent creation")
            break

        agent = PraisonAgent(
            name=agent_id,
            instructions=agent_def.get("instructions", ""),
            llm=agent_def.get("model"),
            memory=agent_def.get("memory", False),
        )
        gateway.register_agent(agent, agent_id=agent_id)
        logger.info(f"Created agent '{agent_id}'")

    return gateway


async def run_with_praisonai(
    app_module: str,
    static_dir: str,
    host: str = "127.0.0.1",
    port: int = 8080,
) -> None:
    """Run PraisonAIUI with praisonai backend.

    This function:
    1. Imports the user's app module to get registered agents/callbacks
    2. Creates an AIUIGateway with static file serving
    3. Registers agents and starts the server

    Args:
        app_module: Path to user's app.py
        static_dir: Directory containing the React SPA build
        host: Host to bind to
        port: Port to listen on
    """
    import importlib.util

    # Load user's app module
    spec = importlib.util.spec_from_file_location("user_app", app_module)
    if spec and spec.loader:
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

    # Create gateway
    gateway = AIUIGateway(
        host=host,
        port=port,
        static_dir=static_dir,
    )

    # Check if user defined agents
    if hasattr(module, "agent"):
        gateway.register_agent(module.agent)
    elif hasattr(module, "agents"):
        for agent in module.agents:
            gateway.register_agent(agent)

    # Start gateway
    await gateway.start()
