"""Agents feature — protocol-driven agent CRUD for PraisonAIUI.

Architecture:
    AgentRegistryProtocol (ABC)     <- any backend implements this
      ├── SimpleAgentRegistry       <- default in-memory + file (no deps)
      └── SDKAgentRegistry          <- wraps praisonaiagents.Agent

    PraisonAIAgentsFeature (BaseFeatureProtocol)
      └── delegates to active AgentRegistryProtocol implementation
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

# Default models available
AVAILABLE_MODELS = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "o1",
    "o1-mini",
    "o3-mini",
]


# ── Agent Registry Protocol ─────────────────────────────────────────


class AgentRegistryProtocol(ABC):
    """Protocol interface for agent registry backends."""

    @abstractmethod
    def create(self, agent_def: Dict[str, Any]) -> Dict[str, Any]:
        ...

    @abstractmethod
    def get(self, agent_id: str) -> Optional[Dict[str, Any]]:
        ...

    @abstractmethod
    def update(self, agent_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ...

    @abstractmethod
    def delete(self, agent_id: str) -> bool:
        ...

    @abstractmethod
    def list_all(self) -> List[Dict[str, Any]]:
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Simple Agent Registry ──────────────────────────────────────────


class SimpleAgentRegistry(AgentRegistryProtocol):
    """In-memory registry backed by the unified YAML config store."""

    def __init__(self) -> None:
        self._definitions: Dict[str, Dict[str, Any]] = {}
        self._config_loaded = False

    def set_data_file(self, path: Path) -> None:
        """Legacy no-op — persistence is now via YAMLConfigStore."""
        pass

    def _ensure_loaded(self) -> None:
        """Lazy-load agents from config store on first access."""
        if self._config_loaded:
            return
        self._config_loaded = True
        try:
            from praisonaiui.config_store import get_config_store
            store = get_config_store()
            agents = store.get_section("agents")
            if isinstance(agents, dict) and agents:
                self._definitions = dict(agents)
                for agent_def in self._definitions.values():
                    if isinstance(agent_def, dict):
                        _sync_to_gateway(agent_def)
                logger.info("Loaded %d agents from config store", len(self._definitions))
        except Exception as e:
            logger.debug("Config store not available yet: %s", e)

    def _save(self) -> None:
        """Persist current definitions to the YAML config store."""
        try:
            from praisonaiui.config_store import get_config_store
            store = get_config_store()
            store.set_section("agents", self._definitions)
        except Exception as e:
            logger.warning("Failed to save agents to config store: %s", e)

    def create(self, agent_def: Dict[str, Any]) -> Dict[str, Any]:
        self._ensure_loaded()
        agent_id = agent_def.get("id", f"agent_{uuid.uuid4().hex[:8]}")
        now = time.time()
        agent = {
            "id": agent_id,
            "name": agent_def.get("name", "assistant"),
            "description": agent_def.get("description", ""),
            "instructions": agent_def.get("instructions", ""),
            "system_prompt": agent_def.get("system_prompt", ""),
            "model": agent_def.get("model", "gpt-4o-mini"),
            "temperature": agent_def.get("temperature", 0.7),
            "tools": agent_def.get("tools", []),
            "icon": agent_def.get("icon", "🤖"),
            "created_at": now,
            "updated_at": now,
            "status": "active",
        }
        # Include any extra kwargs
        for k, v in agent_def.items():
            if k not in agent:
                agent[k] = v
        self._definitions[agent_id] = agent
        self._save()
        _sync_to_gateway(agent)
        return agent

    def get(self, agent_id: str) -> Optional[Dict[str, Any]]:
        self._ensure_loaded()
        agent = self._definitions.get(agent_id)
        if agent is not None:
            return agent
        # Fallback: check gateway
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                gw_agent = gw.get_agent(agent_id)
                if gw_agent is not None:
                    return {
                        "id": agent_id,
                        "name": getattr(gw_agent, "name", agent_id),
                        "description": getattr(gw_agent, "backstory", ""),
                        "instructions": getattr(gw_agent, "instructions", ""),
                        "model": getattr(gw_agent, "llm", "gpt-4o-mini"),
                        "source": "gateway",
                        "status": "active",
                    }
        except Exception:
            pass
        return None

    def update(self, agent_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        self._ensure_loaded()
        if agent_id not in self._definitions:
            return None
        agent = self._definitions[agent_id]
        allowed_fields = {"name", "description", "instructions", "system_prompt",
                          "model", "temperature", "tools", "icon", "status"}
        for key, value in updates.items():
            if key in allowed_fields:
                agent[key] = value
        agent["updated_at"] = time.time()
        self._definitions[agent_id] = agent
        self._save()
        _sync_to_gateway(agent)
        return agent

    def delete(self, agent_id: str) -> bool:
        self._ensure_loaded()
        if agent_id not in self._definitions:
            return False
        _unsync_from_gateway(agent_id)
        del self._definitions[agent_id]
        self._save()
        return True

    def list_all(self) -> List[Dict[str, Any]]:
        self._ensure_loaded()
        return list(self._definitions.values())

    def health(self) -> Dict[str, Any]:
        self._ensure_loaded()
        active = sum(1 for a in self._definitions.values() if a.get("status") == "active")
        return {
            "status": "ok",
            "provider": "SimpleAgentRegistry",
            "total_agents": len(self._definitions),
            "active_agents": active,
        }


# ── SDK Agent Registry ────────────────────────────────────────────


class SDKAgentRegistry(AgentRegistryProtocol):
    """Wraps praisonaiagents.Agent for production use."""

    def __init__(self) -> None:
        from praisonaiagents import Agent  # noqa: F401
        self._simple = SimpleAgentRegistry()
        logger.info("SDKAgentRegistry initialized (praisonaiagents available)")

    def set_data_file(self, path: Path) -> None:
        self._simple.set_data_file(path)

    def create(self, agent_def: Dict[str, Any]) -> Dict[str, Any]:
        return self._simple.create(agent_def)

    def get(self, agent_id: str) -> Optional[Dict[str, Any]]:
        return self._simple.get(agent_id)

    def update(self, agent_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._simple.update(agent_id, updates)

    def delete(self, agent_id: str) -> bool:
        return self._simple.delete(agent_id)

    def list_all(self) -> List[Dict[str, Any]]:
        return self._simple.list_all()

    def health(self) -> Dict[str, Any]:
        h = self._simple.health()
        h["provider"] = "SDKAgentRegistry"
        h["sdk_available"] = True
        return h


# ── Registry singleton ───────────────────────────────────────────

_agent_registry: Optional[AgentRegistryProtocol] = None


def get_agent_registry() -> AgentRegistryProtocol:
    """Get the active agent registry (SDK-first, fallback to Simple)."""
    global _agent_registry
    if _agent_registry is None:
        try:
            _agent_registry = SDKAgentRegistry()
            logger.info("Using SDKAgentRegistry")
        except Exception as e:
            logger.debug("SDKAgentRegistry init failed (%s), using SimpleAgentRegistry", e)
            _agent_registry = SimpleAgentRegistry()
    return _agent_registry


def _sync_to_gateway(agent_def: Dict[str, Any]) -> None:
    """Create a real praisonaiagents.Agent and register it with the gateway."""
    try:
        from ._gateway_ref import get_gateway
        gw = get_gateway()
        if gw is None:
            return

        from praisonaiagents import Agent

        # Build Agent kwargs from definition
        agent_kwargs: Dict[str, Any] = {
            "name": agent_def.get("name", "assistant"),
            "instructions": (
                agent_def.get("instructions")
                or agent_def.get("system_prompt")
                or "You are a helpful assistant."
            ),
            "llm": agent_def.get("model", "gpt-4o-mini"),
            "memory": True,
            "reflection": agent_def.get("reflection", False),
        }

        # G8: Resolve tool name strings to callables via ToolResolver
        tool_names = agent_def.get("tools", [])
        if tool_names:
            agent_tools = []
            try:
                from praisonai.tool_resolver import ToolResolver
                resolver = ToolResolver()
                for tn in tool_names:
                    if isinstance(tn, str) and tn.strip():
                        resolved = resolver.resolve(tn.strip())
                        if resolved:
                            agent_tools.append(resolved)
                        else:
                            logger.warning(f"Tool '{tn}' not found for agent '{agent_def.get('id')}'")
            except ImportError:
                logger.debug("ToolResolver not available, skipping tool resolution")
            if agent_tools:
                agent_kwargs["tools"] = agent_tools

        agent = Agent(**agent_kwargs)
        gw.register_agent(agent, agent_id=agent_def["id"])
        logger.info(f"Agent synced to gateway: {agent_def['id']} ({agent_def.get('name')}, tools={len(agent_kwargs.get('tools', []))})")
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"Failed to sync agent to gateway: {e}")


def _unsync_from_gateway(agent_id: str) -> None:
    """Unregister an agent from the gateway."""
    try:
        from ._gateway_ref import get_gateway
        gw = get_gateway()
        if gw is None:
            return
        gw.unregister_agent(agent_id)
        logger.info(f"Agent unsynced from gateway: {agent_id}")
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"Failed to unsync agent from gateway: {e}")


# ── Module-level compatibility functions ───────────────────────────


def set_agents_data_file(path: Path) -> None:
    """Legacy shim — persistence is now via YAMLConfigStore."""
    pass


def create_agent(name: str, description: str = "", instructions: str = "",
                 system_prompt: str = "", model: str = "gpt-4o-mini",
                 temperature: float = 0.7, tools: Optional[List[str]] = None,
                 icon: str = "🤖", **kwargs) -> Dict[str, Any]:
    """Create a new agent definition."""
    return get_agent_registry().create({
        "name": name,
        "description": description,
        "instructions": instructions,
        "system_prompt": system_prompt,
        "model": model,
        "temperature": temperature,
        "tools": tools or [],
        "icon": icon,
        **kwargs,
    })


def update_agent(agent_id: str, **updates) -> Optional[Dict[str, Any]]:
    """Update an existing agent definition."""
    return get_agent_registry().update(agent_id, updates)


def delete_agent(agent_id: str) -> bool:
    """Delete an agent definition."""
    return get_agent_registry().delete(agent_id)


def get_agent(agent_id: str) -> Optional[Dict[str, Any]]:
    """Get an agent definition by ID."""
    return get_agent_registry().get(agent_id)


def list_agents_definitions() -> List[Dict[str, Any]]:
    """List all agent definitions."""
    return get_agent_registry().list_all()


class PraisonAIAgentsFeature(BaseFeatureProtocol):
    """Full CRUD for agent management."""

    feature_name = "agents_crud"
    feature_description = "Agent create, update, delete management"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/agents/definitions", self._list, methods=["GET"]),
            Route("/api/agents/definitions", self._create, methods=["POST"]),
            Route("/api/agents/definitions/{agent_id}", self._get, methods=["GET"]),
            Route("/api/agents/definitions/{agent_id}", self._update, methods=["PUT"]),
            Route("/api/agents/definitions/{agent_id}", self._delete, methods=["DELETE"]),
            Route("/api/agents/models", self._models, methods=["GET"]),
            Route("/api/agents/duplicate/{agent_id}", self._duplicate, methods=["POST"]),
            Route("/api/agents/run/{agent_id}", self._run, methods=["POST"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "agents",
            "help": "Manage agent definitions",
            "commands": {
                "list": {"help": "List all agents", "handler": self._cli_list},
                "create": {"help": "Create a new agent", "handler": self._cli_create},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health
        reg = get_agent_registry()
        h = reg.health()
        gateway_synced = 0
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                gw_ids = set(gw.list_agents())
                all_defs = reg.list_all()
                gateway_synced = sum(1 for a in all_defs if a.get("id") in gw_ids)
        except Exception:
            pass
        return {
            "status": "ok",
            "feature": self.name,
            **h,
            "gateway_synced": gateway_synced,
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all agent definitions, merged with gateway-registered agents."""
        status_filter = request.query_params.get("status")
        agents = list_agents_definitions()
        crud_ids = {a["id"] for a in agents}

        # Merge gateway-only agents (registered programmatically, not via CRUD)
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    if aid not in crud_ids:
                        gw_agent = gw.get_agent(aid)
                        agents.append({
                            "id": str(aid),
                            "name": str(getattr(gw_agent, "name", aid) if gw_agent else aid),
                            "description": str(getattr(gw_agent, "backstory", "") if gw_agent else ""),
                            "instructions": str(getattr(gw_agent, "instructions", "") if gw_agent else ""),
                            "model": str(getattr(gw_agent, "llm", "gpt-4o-mini") if gw_agent else "gpt-4o-mini"),
                            "source": "gateway",
                            "status": "active",
                            "created_at": time.time(),
                        })
        except Exception as e:
            logger.debug("Gateway merge failed: %s", e)

        if status_filter:
            agents = [a for a in agents if a.get("status") == status_filter]
        
        # Sort by created_at descending
        agents.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        
        # Defensive serialization — ensure all values are JSON-safe
        def _safe(v):
            if isinstance(v, (str, int, float, bool, type(None))):
                return v
            if isinstance(v, (list, tuple)):
                return [_safe(x) for x in v]
            if isinstance(v, dict):
                return {str(k): _safe(val) for k, val in v.items()}
            return str(v)

        safe_agents = [_safe(a) for a in agents]

        return JSONResponse({
            "agents": safe_agents,
            "count": len(safe_agents),
        })

    async def _create(self, request: Request) -> JSONResponse:
        """Create a new agent."""
        body = await request.json()
        
        name = body.get("name", "").strip()
        if not name:
            return JSONResponse({"error": "Agent name is required"}, status_code=400)
        
        agent = create_agent(
            name=name,
            description=body.get("description", ""),
            instructions=body.get("instructions", ""),
            system_prompt=body.get("system_prompt", ""),
            model=body.get("model", "gpt-4o-mini"),
            temperature=body.get("temperature", 0.7),
            tools=body.get("tools", []),
            icon=body.get("icon", "🤖"),
        )
        
        return JSONResponse(agent, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        """Get a specific agent."""
        agent_id = request.path_params["agent_id"]
        agent = get_agent(agent_id)
        
        if not agent:
            return JSONResponse({"error": "Agent not found"}, status_code=404)
        
        return JSONResponse(agent)

    async def _update(self, request: Request) -> JSONResponse:
        """Update an agent."""
        agent_id = request.path_params["agent_id"]
        body = await request.json()
        
        agent = update_agent(agent_id, **body)
        
        if not agent:
            return JSONResponse({"error": "Agent not found"}, status_code=404)
        
        return JSONResponse(agent)

    async def _delete(self, request: Request) -> JSONResponse:
        """Delete an agent."""
        agent_id = request.path_params["agent_id"]
        
        if not delete_agent(agent_id):
            return JSONResponse({"error": "Agent not found"}, status_code=404)
        
        return JSONResponse({"deleted": agent_id})

    async def _models(self, request: Request) -> JSONResponse:
        """List available models."""
        return JSONResponse({
            "models": AVAILABLE_MODELS,
            "default": "gpt-4o-mini",
        })

    async def _duplicate(self, request: Request) -> JSONResponse:
        """Duplicate an existing agent."""
        agent_id = request.path_params["agent_id"]
        original = get_agent(agent_id)
        
        if not original:
            return JSONResponse({"error": "Agent not found"}, status_code=404)
        
        # Copy all fields except id/timestamps, preserving any extra kwargs
        skip_fields = {"id", "created_at", "updated_at"}
        copy_kwargs = {k: v for k, v in original.items() if k not in skip_fields}
        copy_kwargs["name"] = f"{original['name']} (Copy)"
        
        new_agent = create_agent(**copy_kwargs)
        
        return JSONResponse(new_agent, status_code=201)

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        agents = list_agents_definitions()
        if not agents:
            return "No agents defined"
        lines = []
        for a in agents:
            status = "✓" if a.get("status") == "active" else "○"
            lines.append(f"  [{status}] {a['icon']} {a['name']} ({a['id']})")
        return "\n".join(lines)

    def _cli_create(self) -> str:
        return "Use the dashboard or API to create agents"

    # ── Agent Execution (DRY: uses praisonaiagents.Agent) ─────────────

    async def _run(self, request: Request) -> JSONResponse:
        """Execute an agent with a prompt using praisonaiagents.Agent."""
        agent_id = request.path_params["agent_id"]
        agent_def = get_agent(agent_id)
        
        if not agent_def:
            return JSONResponse({"error": "Agent not found"}, status_code=404)
        
        body = await request.json()
        prompt = body.get("prompt", "").strip()
        
        if not prompt:
            return JSONResponse({"error": "Prompt is required"}, status_code=400)
        
        try:
            agent = None

            # Prefer the gateway-registered agent (has memory, history)
            try:
                from ._gateway_ref import get_gateway
                gw = get_gateway()
                if gw is not None:
                    agent = gw.get_agent(agent_id)
            except ImportError:
                pass

            # G7: Fallback — create agent with tools from CRUD definition
            if agent is None:
                from praisonaiagents import Agent

                # Resolve tools from CRUD definition
                agent_tools = []
                tool_names = agent_def.get("tools", [])
                if tool_names:
                    try:
                        from praisonai.tool_resolver import ToolResolver
                        resolver = ToolResolver()
                        for tn in tool_names:
                            if isinstance(tn, str) and tn.strip():
                                resolved = resolver.resolve(tn.strip())
                                if resolved:
                                    agent_tools.append(resolved)
                    except ImportError:
                        pass

                agent = Agent(
                    name=agent_def.get("name", "assistant"),
                    instructions=agent_def.get("instructions", "") or agent_def.get("system_prompt", ""),
                    llm=agent_def.get("model", "gpt-4o-mini"),
                    tools=agent_tools if agent_tools else None,
                    reflection=agent_def.get("reflection", False),
                )

            # Execute in thread pool to not block event loop
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, agent.start, prompt)
            
            return JSONResponse({
                "agent_id": agent_id,
                "prompt": prompt,
                "result": result,
                "model": agent_def.get("model", "gpt-4o-mini"),
                "timestamp": time.time(),
            })
            
        except ImportError:
            logger.warning("praisonaiagents not available for agent execution")
            return JSONResponse({
                "error": "praisonaiagents not installed",
                "hint": "pip install praisonaiagents",
            }, status_code=501)
        except Exception as e:
            logger.exception("Agent execution failed")
            return JSONResponse({
                "error": str(e),
                "agent_id": agent_id,
            }, status_code=500)
