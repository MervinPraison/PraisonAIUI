"""Config hot-reload feature — file-watcher for live config changes (Gap 8).

Protocol-driven: watches the config YAML and notifies connected clients.
Config-driven: users just edit the YAML, changes apply automatically.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)


# ── Protocol ─────────────────────────────────────────────────────

class ConfigWatcherProtocol:
    """Protocol for config watchers."""

    def start(self) -> None:
        """Start watching for config changes."""
        ...

    def stop(self) -> None:
        """Stop watching."""
        ...

    def get_status(self) -> Dict[str, Any]:
        """Return current watcher status."""
        ...


# ── Implementation ───────────────────────────────────────────────

class ConfigWatcher(ConfigWatcherProtocol):
    """Watches a config file for changes and triggers reload callbacks."""

    def __init__(
        self,
        config_path: Optional[Path] = None,
        poll_interval: float = 2.0,
    ) -> None:
        self._config_path = config_path
        self._poll_interval = poll_interval
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_hash: Optional[str] = None
        self._last_reload: Optional[float] = None
        self._reload_count = 0
        self._callbacks: List = []

    def on_reload(self, callback) -> None:
        self._callbacks.append(callback)

    def _compute_hash(self) -> Optional[str]:
        if not self._config_path or not self._config_path.exists():
            return None
        try:
            content = self._config_path.read_bytes()
            return hashlib.md5(content).hexdigest()
        except Exception:
            return None

    async def _poll_loop(self) -> None:
        self._last_hash = self._compute_hash()

        while self._running:
            await asyncio.sleep(self._poll_interval)
            new_hash = self._compute_hash()

            if new_hash and new_hash != self._last_hash:
                logger.info("Config file changed, reloading...")
                self._last_hash = new_hash
                self._last_reload = time.time()
                self._reload_count += 1

                for cb in self._callbacks:
                    try:
                        result = cb()
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception as e:
                        logger.error(f"Config reload callback error: {e}")

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.ensure_future(self._poll_loop())

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    def get_status(self) -> Dict[str, Any]:
        return {
            "watching": self._running,
            "config_path": str(self._config_path) if self._config_path else None,
            "poll_interval": self._poll_interval,
            "last_reload": self._last_reload,
            "reload_count": self._reload_count,
            "last_hash": self._last_hash,
        }


_watcher: Optional[ConfigWatcher] = None


def get_config_watcher() -> ConfigWatcher:
    global _watcher
    if _watcher is None:
        _watcher = ConfigWatcher()
    return _watcher


def set_config_watcher(watcher: ConfigWatcher) -> None:
    global _watcher
    _watcher = watcher


# ── HTTP Handlers ────────────────────────────────────────────────

async def _watcher_status(request: Request) -> JSONResponse:
    w = get_config_watcher()
    return JSONResponse(w.get_status())


async def _watcher_start(request: Request) -> JSONResponse:
    w = get_config_watcher()
    w.start()
    return JSONResponse({"status": "started", **w.get_status()})


async def _watcher_stop(request: Request) -> JSONResponse:
    w = get_config_watcher()
    w.stop()
    return JSONResponse({"status": "stopped", **w.get_status()})


async def _force_reload(request: Request) -> JSONResponse:
    """Force a config reload by bumping the hash."""
    w = get_config_watcher()
    w._last_hash = None  # Force mismatch on next poll
    return JSONResponse({"status": "reload_queued", **w.get_status()})


# ── Feature ──────────────────────────────────────────────────────

class ConfigHotReloadFeature(BaseFeatureProtocol):
    """Config hot-reload feature — watches config files for changes."""

    feature_name = "config_hot_reload"
    feature_description = "File-watcher for live config changes"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/config/watcher", _watcher_status, methods=["GET"]),
            Route("/api/config/watcher/start", _watcher_start, methods=["POST"]),
            Route("/api/config/watcher/stop", _watcher_stop, methods=["POST"]),
            Route("/api/config/reload", _force_reload, methods=["POST"]),
        ]


# Backward-compat alias
PraisonAIConfigHotReload = ConfigHotReloadFeature
