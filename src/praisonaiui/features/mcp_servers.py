"""MCP servers: the ``/api/mcp/*`` routes of the ``builtin.mcp`` catalog record.

Secrets never leave the server: header and env values, URL credentials and
query values are masked in every response, and log lines redact them
(``http_guard.register_secret``). The MCP SDK is imported only when a server
connects (``features/mcp.py``).
"""

from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import parse_qsl, urlsplit

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from praisonaiui.http_guard import install_secret_redaction, redact_secrets, register_secret

logger = logging.getLogger(__name__)

# Loggers that may print a server URL, header or error (filters do not inherit).
_LOGGERS = (__name__, "praisonaiui.features.mcp", "httpx", "httpx2") + tuple(
    f"mcp.client.{name}" for name in ("streamable_http", "sse", "stdio")
)
_INSTALL_HINT = "MCP feature not installed. Install with: pip install 'aiui[mcp]'"


def _mcp_stdio_connect_allowed(request: Request) -> bool:
    """Allow stdio MCP only from localhost, with auth, or explicit dev override."""
    if os.environ.get("PRAISONAIUI_ALLOW_REMOTE_MCP_STDIO", "").lower() in ("true", "1", "yes"):
        return True
    client = request.client
    if client and client.host in ("127.0.0.1", "::1", "localhost"):
        return True
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        try:
            from praisonaiui.features.auth import verify_api_key

            if verify_api_key(token):
                return True
        except ImportError:
            pass
        from praisonaiui.auth import validate_token  # core module: always importable

        if validate_token(token):
            return True
    return False


# ── Responses: secrets never leave the server ────────────────────────


def _masked_url(url: str) -> str:
    parts = urlsplit(url)
    netloc = parts.hostname or ""
    if parts.port:
        netloc += f":{parts.port}"
    query = "&".join(f"{k}=***" for k, _ in parse_qsl(parts.query, keep_blank_values=True))
    return redact_secrets(f"{parts.scheme}://{netloc}{parts.path}") + (f"?{query}" if query else "")


def public_view(server: Any) -> dict[str, Any]:
    """A server as browsers see it: header and env values masked, URL credentials dropped."""
    data = server.connection_data or {}
    conn: dict[str, Any] = {}
    if data.get("transport") or data.get("type"):
        conn["transport"] = data.get("transport") or data.get("type")
    if data.get("url"):
        conn["url"] = _masked_url(str(data["url"]))
    if data.get("command"):
        conn["command"] = data["command"]
        conn["args"] = [redact_secrets(str(a)) for a in data.get("args") or []]
    for key in ("headers", "env"):
        if isinstance(data.get(key), dict) and data[key]:
            conn[key] = {k: "***" for k in data[key]}
    return {
        "name": server.name,
        "transport": server.transport.value,
        "status": server.status.value,
        "tools": [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema}
            for t in server.tools
        ],
        "last_error": redact_secrets(server.last_error) if server.last_error else None,
        "connection_data": conn,
    }


# ── Routes ───────────────────────────────────────────────────────────


async def api_mcp_servers(request: Request) -> JSONResponse:
    """GET /api/mcp/servers — List all MCP servers with their status."""
    from praisonaiui.features.mcp import list_mcp_servers

    servers = await list_mcp_servers()
    return JSONResponse({"servers": [public_view(s) for s in servers]})


async def api_mcp_connect(request: Request) -> JSONResponse:
    """POST /api/mcp/connect — Connect to an MCP server."""
    body = await request.json()
    if "name" not in body:
        return JSONResponse({"error": "Missing required field: name"}, status_code=400)
    if "command" not in body and "url" not in body:
        return JSONResponse(
            {"error": "Either 'command' (for stdio) or 'url' (for Streamable HTTP or SSE) is required"},
            status_code=400,
        )
    if "command" in body and not _mcp_stdio_connect_allowed(request):
        return JSONResponse(
            {
                "error": "Remote stdio MCP connections are not permitted",
                "hint": "Use localhost, provide Authorization, or set PRAISONAIUI_ALLOW_REMOTE_MCP_STDIO=true",
            },
            status_code=403,
        )
    for key in ("headers", "env"):
        if isinstance(body.get(key), dict):
            for value in body[key].values():
                if isinstance(value, str):
                    register_secret(value)
    session_id = body.get("session_id") or request.query_params.get("session_id")
    try:
        from praisonaiui.features.mcp import connect_mcp_server

        server = await connect_mcp_server(body, session_context={"session_id": session_id})
    except ImportError:
        return JSONResponse({"error": _INSTALL_HINT}, status_code=400)
    except ValueError as exc:
        return JSONResponse({"error": redact_secrets(str(exc))}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        logger.exception("MCP connect failed for %s", body.get("name"))
        return JSONResponse({"error": redact_secrets(str(exc))}, status_code=500)
    return JSONResponse({"server": public_view(server)})


async def api_mcp_disconnect(request: Request) -> JSONResponse:
    """POST /api/mcp/disconnect/{server_id} — Disconnect an MCP server."""
    from praisonaiui.features.mcp import disconnect_mcp_server

    server_id = request.path_params["server_id"]
    session_id = request.query_params.get("session_id")
    if await disconnect_mcp_server(server_id, session_context={"session_id": session_id}):
        return JSONResponse({"success": True, "message": f"Disconnected from {server_id}"})
    return JSONResponse({"error": f"Server '{server_id}' not found"}, status_code=404)


def routes() -> list[Route]:
    """``builtin.mcp``'s routes; also puts the log redaction on the MCP loggers."""
    install_secret_redaction(*_LOGGERS)
    return [
        Route("/api/mcp/servers", api_mcp_servers, methods=["GET"]),
        Route("/api/mcp/connect", api_mcp_connect, methods=["POST"]),
        Route("/api/mcp/disconnect/{server_id}", api_mcp_disconnect, methods=["POST"]),
    ]
