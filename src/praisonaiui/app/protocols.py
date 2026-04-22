"""Protocol and data structures for agent/team discovery.

This module defines structured data classes that providers use to advertise
their capabilities to third-party frontends. The dataclasses provide a stable
contract for REST API responses and ensure consistent shape across providers.

Key types:
- AgentDetails: Individual agent metadata
- TeamDetails: Team/multi-agent metadata
- ModelInfo: LLM model information
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class ModelInfo:
    """LLM model information for display in frontends.

    Attributes:
        name: Human-readable model name (e.g., "GPT-4", "Claude")
        model: Technical model identifier (e.g., "gpt-4-turbo", "claude-3-sonnet")
        provider: Provider name (e.g., "openai", "anthropic", "local")
    """
    name: str
    model: str
    provider: str

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary for JSON responses."""
        return {
            "name": self.name,
            "model": self.model,
            "provider": self.provider,
        }


@dataclass
class AgentDetails:
    """Agent metadata for discovery endpoints.

    Provides structured information about individual agents that third-party
    frontends can use to display agent cards, route runs by ID, and show
    model/storage capabilities.

    Attributes:
        agent_id: Unique identifier for routing runs via POST /agents/{agent_id}/runs
        name: Human-readable agent name
        description: Optional agent description/purpose
        model: Optional model information for display
        storage: Whether agent maintains conversation history
    """
    agent_id: str
    name: str
    description: str = ""
    model: Optional[ModelInfo] = None
    storage: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary for JSON responses."""
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "description": self.description,
            "model": self.model.to_dict() if self.model else None,
            "storage": self.storage,
        }


@dataclass
class TeamDetails:
    """Team metadata for discovery endpoints.

    Similar to AgentDetails but for multi-agent teams. Enables frontends
    to discover and route to team-based conversations.

    Attributes:
        team_id: Unique identifier for routing runs via POST /teams/{team_id}/runs
        name: Human-readable team name
        description: Optional team description/purpose
        model: Optional model information (may represent primary coordinator)
        storage: Whether team maintains conversation history
    """
    team_id: str
    name: str
    description: str = ""
    model: Optional[ModelInfo] = None
    storage: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary for JSON responses."""
        return {
            "team_id": self.team_id,
            "name": self.name,
            "description": self.description,
            "model": self.model.to_dict() if self.model else None,
            "storage": self.storage,
        }
