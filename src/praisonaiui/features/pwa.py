"""PWA feature — Progressive Web App support (manifest + service worker).

Architecture:
    PWAProtocol (ABC)
      └── DefaultPWAManager  ← generates manifest.json + service worker from config
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── PWA Protocol ─────────────────────────────────────────────────────


class PWAProtocol(ABC):
    """Protocol interface for PWA support."""

    @abstractmethod
    def get_manifest(self) -> Dict[str, Any]:
        ...

    @abstractmethod
    def get_service_worker(self) -> str:
        ...

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": self.__class__.__name__}


# ── Default PWA Manager ─────────────────────────────────────────────


class DefaultPWAManager(PWAProtocol):
    """Generates PWA manifest and service worker from config."""

    def __init__(self, *, name: str = "PraisonAI", short_name: str = "AI",
                 theme_color: str = "#1a1a2e", bg_color: str = "#16213e",
                 display: str = "standalone") -> None:
        self._name = name
        self._short_name = short_name
        self._theme_color = theme_color
        self._bg_color = bg_color
        self._display = display

    def get_manifest(self) -> Dict[str, Any]:
        return {
            "name": self._name,
            "short_name": self._short_name,
            "start_url": "/",
            "display": self._display,
            "theme_color": self._theme_color,
            "background_color": self._bg_color,
            "icons": [
                {"src": "/api/pwa/icon/192", "sizes": "192x192", "type": "image/png"},
                {"src": "/api/pwa/icon/512", "sizes": "512x512", "type": "image/png"},
            ],
            "orientation": "portrait-primary",
            "scope": "/",
        }

    def get_service_worker(self) -> str:
        return """// PraisonAI Service Worker — cache-first for offline shell
const CACHE_NAME = 'praisonai-v1';
const OFFLINE_URL = '/';
const PRECACHE_URLS = ['/', '/api/health'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
  }
});
"""

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "provider": "DefaultPWAManager", "app_name": self._name}


# ── Manager singleton ────────────────────────────────────────────────

_pwa_manager: Optional[PWAProtocol] = None


def get_pwa_manager() -> PWAProtocol:
    global _pwa_manager
    if _pwa_manager is None:
        _pwa_manager = DefaultPWAManager()
    return _pwa_manager


def set_pwa_manager(manager: PWAProtocol) -> None:
    global _pwa_manager
    _pwa_manager = manager


# ── Feature class ────────────────────────────────────────────────────


class PWAFeature(BaseFeatureProtocol):
    """Progressive Web App — manifest, service worker, offline support."""

    feature_name = "pwa"
    feature_description = "Progressive Web App support (manifest, service worker, offline)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/manifest.json", self._manifest, methods=["GET"]),
            Route("/sw.js", self._service_worker, methods=["GET"]),
            Route("/api/pwa/config", self._config, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        mgr = get_pwa_manager()
        h = mgr.health()
        h["feature"] = self.name
        return h

    async def _manifest(self, request: Request) -> Response:
        mgr = get_pwa_manager()
        manifest = mgr.get_manifest()
        return Response(
            content=json.dumps(manifest, indent=2),
            media_type="application/manifest+json",
        )

    async def _service_worker(self, request: Request) -> Response:
        mgr = get_pwa_manager()
        sw = mgr.get_service_worker()
        return Response(content=sw, media_type="application/javascript")

    async def _config(self, request: Request) -> JSONResponse:
        mgr = get_pwa_manager()
        return JSONResponse({"manifest": mgr.get_manifest(), "has_sw": True})


# Backward-compat alias
PraisonAIPWA = PWAFeature
