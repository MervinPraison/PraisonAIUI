"""Connect: put this app's MCP server in Cursor, VS Code, Claude, Codex…

The Connect page (``builtin.connect``, React, app shell) reads two routes:

- ``GET /api/connect?tools=a,b``: the client catalog with each client's
  one-click link, command and config snippet, scoped to ``tools``; what each
  client on this machine has (installed / connected); and the clients that
  connected (MCP ``clientInfo``, last active).
- ``GET /api/connect/tools``: the server's tool names from a real MCP
  ``tools/list``, for the scope picker. Cached for five minutes.

The catalog, the config reader and the handshake come from PraisonAI's
``praisonai_mcp.connect`` (``praisonai connect`` uses the same code), so
there is one list of clients. Zero config: with ``praisonai-mcp`` installed
the page connects to its local stdio server. One line: ``AIUI_MCP_URL``
points every client at a running HTTP MCP server instead. Without
``praisonai-mcp`` the page says how to install it.
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

INSTALL_HINT = "pip install praisonai-mcp"
TOOLS_TTL = 300.0


def _connect_pkg():
    """``praisonai_mcp.connect`` or ``None`` (optional dependency)."""
    try:
        from praisonai_mcp.connect import catalog, probe

        return catalog, probe
    except ImportError:
        return None


def _scope(raw: Optional[str]) -> List[str]:
    return [t.strip() for t in (raw or "").split(",") if t.strip()][:200]


class ConnectFeature(BaseFeatureProtocol):
    feature_name = "connect"
    feature_description = "Connect editors and agents to this app's MCP server"

    def __init__(self) -> None:
        self._tools_cache: Dict[str, Any] = {}

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/connect", self._catalog, methods=["GET"]),
            Route("/api/connect/tools", self._tools, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        return {"status": "ok", "feature": self.name, "available": _connect_pkg() is not None}

    # ── helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _spec(pkg, tools: List[str]):
        catalog, _ = pkg
        url = os.environ.get("AIUI_MCP_URL", "").strip()
        if url:
            return catalog.ServerSpec(url=url)
        return catalog.local_spec(tools=tools)

    @staticmethod
    def _local_status(home: Path) -> Dict[str, Any]:
        """Per client on this machine: installed / connected, last active."""
        try:
            from praisonai_mcp.cli.commands.connect import status_rows
        except ImportError:
            return {}
        return {
            r["id"]: {k: r[k] for k in ("status", "last_active", "plaintext_secrets")}
            for r in status_rows(home)
        }

    # ── routes ───────────────────────────────────────────────────────

    async def _catalog(self, request: Request) -> JSONResponse:
        pkg = _connect_pkg()
        if pkg is None:
            url = os.environ.get("AIUI_MCP_URL", "").strip()
            return JSONResponse(
                {"available": False, "install": INSTALL_HINT, "server": {"url": url} if url else None}
            )
        catalog, probe = pkg
        tools = _scope(request.query_params.get("tools"))
        spec = self._spec(pkg, tools)
        home = Path.home()
        clients, status = await asyncio.to_thread(
            lambda: (catalog.export_catalog(spec, home), self._local_status(home))
        )
        connections = [
            {**row, "client_id": catalog.client_for(str(row.get("name", "")))}
            for row in probe.connections()
        ]
        return JSONResponse(
            {
                "available": True,
                "server": {**spec.to_dict(), "transport": "http" if spec.url else "stdio"},
                "scopable": not spec.url,
                "scope": tools,
                "clients": clients,
                "status": status,
                "connections": connections,
            }
        )

    async def _tools(self, request: Request) -> JSONResponse:
        pkg = _connect_pkg()
        if pkg is None:
            return JSONResponse({"ok": False, "error": INSTALL_HINT, "tools": []})
        _, probe = pkg
        spec = self._spec(pkg, [])
        key = repr(spec)
        hit = self._tools_cache.get(key)
        if not hit or time.monotonic() - hit[0] > TOOLS_TTL:
            result = await asyncio.to_thread(probe.verify, spec)
            hit = (time.monotonic(), result)
            if result.ok:  # a failure is retried on the next read
                self._tools_cache[key] = hit
        result = hit[1]
        return JSONResponse(
            {
                "ok": result.ok,
                "server": result.server,
                "tools": list(getattr(result, "names", []) or []),
                "count": result.tools,
                "error": result.error,
            }
        )
