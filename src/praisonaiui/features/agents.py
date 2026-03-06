"""Agents feature — full CRUD for agent management in PraisonAIUI.

Provides API endpoints for creating, reading, updating, and deleting agents
with persistence to YAML/JSON files.

DRY: Uses praisonaiagents.Agent for real agent execution.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

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

# In-memory agent definitions (persisted to file)
_agent_definitions: Dict[str, Dict[str, Any]] = {}
_data_file: Path | None = None


def _generate_agent_id() -> str:
    """Generate a unique agent ID."""
    return f"agent_{uuid.uuid4().hex[:8]}"


def _save_agents() -> None:
    """Save agent definitions to disk."""
    if not _data_file:
        return
    try:
        _data_file.parent.mkdir(parents=True, exist_ok=True)
        with open(_data_file, "w") as f:
            json.dump({
                "agents": _agent_definitions,
                "saved_at": time.time(),
            }, f, indent=2)
    except Exception:
        pass


def _load_agents() -> None:
    """Load agent definitions from disk."""
    global _agent_definitions
    if not _data_file or not _data_file.exists():
        return
    try:
        with open(_data_file) as f:
            data = json.load(f)
        _agent_definitions = data.get("agents", {})
    except Exception:
        pass


def set_agents_data_file(path: Path) -> None:
    """Set the data file path for persistence."""
    global _data_file
    _data_file = path
    _load_agents()


def create_agent(
    name: str,
    description: str = "",
    instructions: str = "",
    system_prompt: str = "",
    model: str = "gpt-4o-mini",
    temperature: float = 0.7,
    tools: List[str] | None = None,
    icon: str = "🤖",
    **kwargs,
) -> Dict[str, Any]:
    """Create a new agent definition."""
    agent_id = _generate_agent_id()
    now = time.time()
    
    agent = {
        "id": agent_id,
        "name": name,
        "description": description,
        "instructions": instructions,
        "system_prompt": system_prompt,
        "model": model,
        "temperature": temperature,
        "tools": tools or [],
        "icon": icon,
        "created_at": now,
        "updated_at": now,
        "status": "active",
        **kwargs,
    }
    
    _agent_definitions[agent_id] = agent
    _save_agents()
    return agent


def update_agent(agent_id: str, **updates) -> Dict[str, Any] | None:
    """Update an existing agent definition."""
    if agent_id not in _agent_definitions:
        return None
    
    agent = _agent_definitions[agent_id]
    
    # Update allowed fields
    allowed_fields = {
        "name", "description", "instructions", "system_prompt",
        "model", "temperature", "tools", "icon", "status"
    }
    
    for key, value in updates.items():
        if key in allowed_fields:
            agent[key] = value
    
    agent["updated_at"] = time.time()
    _agent_definitions[agent_id] = agent
    _save_agents()
    return agent


def delete_agent(agent_id: str) -> bool:
    """Delete an agent definition."""
    if agent_id not in _agent_definitions:
        return False
    
    del _agent_definitions[agent_id]
    _save_agents()
    return True


def get_agent(agent_id: str) -> Dict[str, Any] | None:
    """Get an agent definition by ID."""
    return _agent_definitions.get(agent_id)


def list_agents_definitions() -> List[Dict[str, Any]]:
    """List all agent definitions."""
    return list(_agent_definitions.values())


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
        active = sum(1 for a in _agent_definitions.values() if a.get("status") == "active")
        return {
            "status": "ok",
            "feature": self.name,
            "total_agents": len(_agent_definitions),
            "active_agents": active,
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all agent definitions."""
        status_filter = request.query_params.get("status")
        agents = list_agents_definitions()
        
        if status_filter:
            agents = [a for a in agents if a.get("status") == status_filter]
        
        # Sort by created_at descending
        agents.sort(key=lambda x: x.get("created_at", 0), reverse=True)
        
        return JSONResponse({
            "agents": agents,
            "count": len(agents),
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
        
        # Create a copy with new name
        new_agent = create_agent(
            name=f"{original['name']} (Copy)",
            description=original.get("description", ""),
            instructions=original.get("instructions", ""),
            system_prompt=original.get("system_prompt", ""),
            model=original.get("model", "gpt-4o-mini"),
            temperature=original.get("temperature", 0.7),
            tools=original.get("tools", []),
            icon=original.get("icon", "🤖"),
        )
        
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
            # Lazy import praisonaiagents.Agent (DRY)
            from praisonaiagents import Agent
            
            # Create real Agent from definition
            agent = Agent(
                name=agent_def.get("name", "assistant"),
                instructions=agent_def.get("instructions", "") or agent_def.get("system_prompt", ""),
                llm=agent_def.get("model", "gpt-4o-mini"),
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
