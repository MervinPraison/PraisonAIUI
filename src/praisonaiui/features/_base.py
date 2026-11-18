"""Base feature protocol — ABC that every feature module implements.

This is the extension point for protocol-driven feature wiring.
Custom backends implement this to add new capabilities without
changing server.py or cli.py.
"""

from __future__ import annotations

import sys
from abc import ABC, abstractmethod
from typing import Any, Dict, List

from starlette.routing import Route


def warn_unwired_hook(name: str) -> None:
    """Deprecation warning for a hook no built-in route ever calls (R7 shim).

    Raised when the hook is used, not when it is imported, so
    ``from praisonaiui import *`` stays quiet.
    """
    import warnings

    warnings.warn(
        f"aiui.{name} is deprecated and does nothing: no route delivers "
        "window messages or microphone audio to it. It will be removed in "
        "a future release.",
        DeprecationWarning,
        stacklevel=3,
    )


def sdk_installed(package: str = "praisonaiagents") -> bool:
    """True when *package* can be imported, checked without importing it.

    For ``health()``: reports SDK availability without paying for the import.
    """
    try:
        import importlib.util

        return importlib.util.find_spec(package) is not None
    except ValueError:  # loaded without a __spec__ (a stub module): present
        return sys.modules.get(package) is not None
    except ImportError:
        return False


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
        """Health check for this feature. Default: ok.

        Runs on the event loop for every ``/api/features`` and ``/api/health``
        request, so it must be cheap: report state already known, and never
        start an SDK backend, import a heavy library, make a network call or
        scan a large directory here. Those block every other request.
        """
        return {"status": "ok", "feature": self.name}

    def on_config_reload(self) -> None:
        """Drop state cached from the config store; it was just reloaded.

        Called by the config hot-reload watcher (``builtin.config``) on every
        registered feature after the YAML file changes. Default: nothing.
        """

    async def info(self) -> Dict[str, Any]:
        """Feature metadata for /api/features listing."""
        h = await self.health()
        return {
            "name": self.name,
            "description": self.description,
            "health": h,
            "routes": [r.path for r in self.routes()],
        }
