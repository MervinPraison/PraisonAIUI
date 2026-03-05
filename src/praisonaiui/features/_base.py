"""Base feature protocol — ABC that every feature module implements.

This is the extension point for protocol-driven feature wiring.
Custom backends implement this to add new capabilities without
changing server.py or cli.py.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List

from starlette.routing import Route


class BaseFeatureProtocol(ABC):
    """Protocol that every feature module must implement.

    Subclass this and implement the three required properties plus
    ``routes()`` to wire your feature into PraisonAIUI automatically.

    Example::

        class MyFeature(BaseFeatureProtocol):
            feature_name = "my_feature"
            feature_description = "Does something cool"

            @property
            def name(self) -> str:
                return self.feature_name

            @property
            def description(self) -> str:
                return self.feature_description

            def routes(self) -> List[Route]:
                return [Route("/api/my-feature", self._handler)]

            def cli_commands(self) -> List[dict]:
                return [{"name": "my-feature", "help": "My feature", "commands": {...}}]

            async def health(self) -> dict:
                return {"status": "ok"}
    """

    feature_name: str = ""
    feature_description: str = ""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique feature identifier (e.g. 'approvals')."""
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        """Human-readable description."""
        ...

    @abstractmethod
    def routes(self) -> List[Route]:
        """Return Starlette Route objects to mount on the server."""
        ...

    def cli_commands(self) -> List[Dict[str, Any]]:
        """Return CLI command metadata for Typer registration.

        Each dict should have:
          - name: subcommand group name
          - help: help text
          - commands: dict of {name: {"help": ..., "handler": callable}}

        Default: empty (no CLI commands).
        """
        return []

    async def health(self) -> Dict[str, Any]:
        """Health check for this feature. Default: ok."""
        return {"status": "ok", "feature": self.name}

    async def info(self) -> Dict[str, Any]:
        """Feature metadata for /api/features listing."""
        h = await self.health()
        return {
            "name": self.name,
            "description": self.description,
            "health": h,
            "routes": [r.path for r in self.routes()],
        }
