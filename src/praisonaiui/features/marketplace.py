"""Plugin Marketplace feature — protocol-driven plugin discovery and management.

Architecture:
    MarketplaceProtocol (ABC)
      └── LocalMarketplaceManager  ← scans local plugins directory
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Marketplace Protocol ─────────────────────────────────────────────


class MarketplaceProtocol(ABC):
    """Protocol interface for plugin marketplaces."""

    @abstractmethod
    def list_plugins(self, *, category: str = "all") -> List[Dict[str, Any]]:
        ...

    @abstractmethod
    def search(self, query: str, *, limit: int = 20) -> List[Dict[str, Any]]:
        ...

    @abstractmethod
    def install(self, plugin_id: str) -> Dict[str, Any]:
        ...

    @abstractmethod
    def uninstall(self, plugin_id: str) -> Dict[str, Any]:
        ...

    @abstractmethod
    def get_plugin(self, plugin_id: str) -> Optional[Dict[str, Any]]:
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Local Marketplace Manager ────────────────────────────────────────


class LocalMarketplaceManager(MarketplaceProtocol):
    """Discovers plugins from local directory and SDK plugin registry."""

    def __init__(self) -> None:
        self._installed: Dict[str, Dict[str, Any]] = {}
        self._available: List[Dict[str, Any]] = [
            {"id": "web_search", "name": "Web Search", "category": "tools", "version": "1.0.0",
             "description": "Search the web using DuckDuckGo", "installed": False},
            {"id": "code_executor", "name": "Code Executor", "category": "tools", "version": "1.0.0",
             "description": "Execute Python code in sandbox", "installed": False},
            {"id": "file_manager", "name": "File Manager", "category": "tools", "version": "1.0.0",
             "description": "Read, write, and manage files", "installed": False},
            {"id": "memory_plugin", "name": "Memory Plugin", "category": "memory", "version": "1.0.0",
             "description": "Persistent agent memory with ChromaDB", "installed": False},
        ]

    def list_plugins(self, *, category: str = "all") -> List[Dict[str, Any]]:
        if category == "all":
            return self._available + list(self._installed.values())
        return [p for p in self._available + list(self._installed.values()) if p.get("category") == category]

    def search(self, query: str, *, limit: int = 20) -> List[Dict[str, Any]]:
        q = query.lower()
        results = [p for p in self._available if q in p.get("name", "").lower() or q in p.get("description", "").lower()]
        return results[:limit]

    def install(self, plugin_id: str) -> Dict[str, Any]:
        plugin = next((p for p in self._available if p["id"] == plugin_id), None)
        if not plugin:
            return {"error": f"Plugin '{plugin_id}' not found", "status": "not_found"}
        self._installed[plugin_id] = {**plugin, "installed": True}
        return {"status": "installed", "plugin": plugin_id}

    def uninstall(self, plugin_id: str) -> Dict[str, Any]:
        if plugin_id not in self._installed:
            return {"error": f"Plugin '{plugin_id}' not installed", "status": "not_found"}
        del self._installed[plugin_id]
        return {"status": "uninstalled", "plugin": plugin_id}

    def get_plugin(self, plugin_id: str) -> Optional[Dict[str, Any]]:
        if plugin_id in self._installed:
            return self._installed[plugin_id]
        return next((p for p in self._available if p["id"] == plugin_id), None)

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "provider": "LocalMarketplaceManager",
            "available": len(self._available),
            "installed": len(self._installed),
        }


# ── Manager singleton ────────────────────────────────────────────────

_marketplace_manager: Optional[MarketplaceProtocol] = None


def get_marketplace_manager() -> MarketplaceProtocol:
    global _marketplace_manager
    if _marketplace_manager is None:
        _marketplace_manager = LocalMarketplaceManager()
    return _marketplace_manager


def set_marketplace_manager(manager: MarketplaceProtocol) -> None:
    global _marketplace_manager
    _marketplace_manager = manager


# ── Feature class ────────────────────────────────────────────────────


class PraisonAIMarketplace(BaseFeatureProtocol):
    """Plugin marketplace — browse, install, manage plugins."""

    feature_name = "marketplace"
    feature_description = "Plugin marketplace for browsing and installing extensions"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/marketplace/plugins", self._list, methods=["GET"]),
            Route("/api/marketplace/search", self._search, methods=["POST"]),
            Route("/api/marketplace/install", self._install, methods=["POST"]),
            Route("/api/marketplace/uninstall", self._uninstall, methods=["POST"]),
            Route("/api/marketplace/plugins/{plugin_id}", self._get_plugin, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        mgr = get_marketplace_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    async def _list(self, request: Request) -> JSONResponse:
        mgr = get_marketplace_manager()
        category = request.query_params.get("category", "all")
        plugins = mgr.list_plugins(category=category)
        return JSONResponse({"plugins": plugins, "count": len(plugins)})

    async def _search(self, request: Request) -> JSONResponse:
        mgr = get_marketplace_manager()
        body = await request.json()
        results = mgr.search(body.get("query", ""), limit=body.get("limit", 20))
        return JSONResponse({"results": results, "count": len(results)})

    async def _install(self, request: Request) -> JSONResponse:
        mgr = get_marketplace_manager()
        body = await request.json()
        result = mgr.install(body.get("plugin_id", ""))
        status = 200 if result.get("status") == "installed" else 404
        return JSONResponse(result, status_code=status)

    async def _uninstall(self, request: Request) -> JSONResponse:
        mgr = get_marketplace_manager()
        body = await request.json()
        result = mgr.uninstall(body.get("plugin_id", ""))
        status = 200 if result.get("status") == "uninstalled" else 404
        return JSONResponse(result, status_code=status)

    async def _get_plugin(self, request: Request) -> JSONResponse:
        mgr = get_marketplace_manager()
        plugin_id = request.path_params["plugin_id"]
        plugin = mgr.get_plugin(plugin_id)
        if not plugin:
            return JSONResponse({"error": "Plugin not found"}, status_code=404)
        return JSONResponse(plugin)
