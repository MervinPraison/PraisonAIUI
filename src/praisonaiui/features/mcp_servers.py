"""MCP servers: the ``mcp:`` config, what users may add, and the ``/api/mcp/*`` routes.

Owned by the ``builtin.mcp`` catalog record (its ``host_routes``), so turning
the built-in off unmounts the routes and skips the startup connections.

* ``mcp.servers`` are connected in the background at startup. Their
  ``headers`` and ``env`` (``${NAME}`` reads an environment variable) stay on
  the server: API responses mask them and log lines redact them.
* ``mcp.allow.urls`` / ``mcp.allow.commands`` decide what a user may add from
  the UI. Both are empty by default, so nothing can be added until an admin
  says so. A wildcard URL pattern never reaches a private or loopback address.
* ``mcp.enabled: false`` turns MCP off.

The MCP SDK is imported only when a server connects (``features/mcp.py``).
"""

from __future__ import annotations

import asyncio
import contextlib
import fnmatch
import ipaddress
import logging
import os
import re
import sys
from typing import Any, Optional
from urllib.parse import parse_qsl, urlsplit

from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from praisonaiui.http_guard import install_secret_redaction, redact_secrets, register_secret
from praisonaiui.schema.models import McpConfig

logger = logging.getLogger(__name__)

# Loggers that may print a server URL, header or error (filters do not inherit).
_LOGGERS = (__name__, "praisonaiui.features.mcp", "httpx", "httpx2") + tuple(
    f"mcp.client.{name}" for name in ("streamable_http", "sse", "stdio")
)
_INSTALL_HINT = "MCP feature not installed. Install with: pip install 'aiui[mcp]'"
_DEFAULT_PORT = {"http": 80, "https": 443}
_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
# Older switch: any stdio command from the UI (same as allow.commands: ["*"]).
_LEGACY_STDIO_ENV = "PRAISONAIUI_ALLOW_REMOTE_MCP_STDIO"

_settings = McpConfig()
_declared: dict[str, dict[str, Any]] = {}  # name -> connect config, ${VAR} expanded
_startup_task: Optional[asyncio.Task] = None


class Refused(Exception):
    """A connect request the policy turns down (HTTP *status*)."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# ── Config ───────────────────────────────────────────────────────────


def _expand(value: str, *, secret: bool = False) -> str:
    def sub(match: re.Match) -> str:
        found = os.environ.get(match.group(1))
        if found is None:
            logger.warning("mcp: environment variable %s is not set", match.group(1))
            return ""
        register_secret(found)
        return found

    out = _VAR.sub(sub, value)
    if secret:
        register_secret(out)
    return out


def configure(section: Any) -> McpConfig:
    """Apply an ``mcp:`` section. An invalid one turns MCP off (fail closed)."""
    global _settings
    try:
        settings = McpConfig.model_validate(section or {})
    except ValidationError as exc:
        # include_input=False: the input may hold a header token.
        problems = "; ".join(
            f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors(include_input=False)
        )
        logger.error("mcp: the config is invalid, MCP is off until it is fixed: %s", problems)
        settings = McpConfig(enabled=False)
    _settings = settings
    _declared.clear()
    for name, server in settings.servers.items():
        cfg: dict[str, Any] = {"name": name}
        if server.transport:
            cfg["transport"] = server.transport
        if server.url:
            cfg["url"] = _expand(server.url)
        if server.command:
            cfg["command"] = server.command
            cfg["args"] = [_expand(a) for a in server.args]
        if server.env:
            cfg["env"] = {k: _expand(v, secret=True) for k, v in server.env.items()}
        if server.headers:
            cfg["headers"] = {k: _expand(v, secret=True) for k, v in server.headers.items()}
        _declared[name] = cfg
    return settings


def settings() -> McpConfig:
    return _settings


def _config_section() -> Any:
    """``mcp:`` of the config ``create_app`` got, else of the data-dir config.yaml."""
    app_config = getattr(sys.modules.get("praisonaiui.server"), "_config_cache", None)
    if isinstance(app_config, dict) and "mcp" in app_config:
        return app_config["mcp"]
    try:
        from praisonaiui.config_store import get_config_store

        return get_config_store().get_section("mcp")
    except Exception:  # noqa: BLE001 - no data-dir config: defaults
        return None


# ── What users may add ───────────────────────────────────────────────


def _pattern(raw: str) -> tuple[Optional[str], str, Optional[int], str]:
    """``(scheme, host glob, port, path)`` of an allow.urls entry."""
    scheme, _, rest = raw.strip().rpartition("://")
    hostport, slash, path = rest.partition("/")
    host, _, port = hostport.partition(":")
    return (scheme.lower() or None), host.lower(), (int(port) if port else None), slash + path


def _path_ok(path: str, allowed: str) -> bool:
    if allowed in ("", "/", "/*"):
        return True
    if allowed.endswith("*"):
        return path.startswith(allowed[:-1])
    base = allowed.rstrip("/")
    return path == base or path.startswith(base + "/")


def match_url(url: str, patterns: list[str]) -> Optional[str]:
    """The ``allow.urls`` entry that admits *url*, or None.

    An entry is ``*`` (any host), a host (``mcp.example.com``, ``*.example.com``)
    or a URL whose path is a prefix (``https://example.com/mcp/``). The host is
    matched on its own, so ``*`` in it can never swallow a path or a query.
    Without a port the scheme's default port is required.
    """
    parts = urlsplit(url)
    scheme, host = parts.scheme.lower(), (parts.hostname or "").lower()
    if scheme not in _DEFAULT_PORT or not host:
        return None
    try:
        port = parts.port or _DEFAULT_PORT[scheme]
    except ValueError:
        return None
    for raw in patterns:
        if raw.strip() == "*":
            return raw
        try:
            p_scheme, p_host, p_port, p_path = _pattern(raw)
        except ValueError:
            continue
        if p_scheme is not None and p_scheme != scheme:
            continue
        if p_port is None:
            p_port = _DEFAULT_PORT.get(p_scheme or scheme)
        if p_port == port and fnmatch.fnmatchcase(host, p_host) and _path_ok(parts.path, p_path):
            return raw
    return None


async def _public_host(host: str) -> bool:
    """True when every address *host* resolves to is a public one."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    except OSError:
        return False
    addresses = {info[4][0].split("%", 1)[0] for info in infos}
    return bool(addresses) and all(ipaddress.ip_address(a).is_global for a in addresses)


def command_allowed(command: str) -> bool:
    """A stdio executable a user may start: listed exactly in allow.commands."""
    allowed = _settings.allow.commands
    if "*" in allowed:
        return True
    if os.environ.get(_LEGACY_STDIO_ENV, "").lower() in ("true", "1", "yes"):
        logger.warning("%s is set: any stdio command may be started from the UI", _LEGACY_STDIO_ENV)
        return True
    return command in allowed


def _strings(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise Refused(400, f"'{field}' must be a list of strings")
    return value


async def user_server(name: str, body: dict) -> dict[str, Any]:
    """The connect config for a server a user adds, or :class:`Refused`."""
    cfg: dict[str, Any] = {"name": name}
    transport = body.get("transport") or body.get("type")
    if transport:
        cfg["transport"] = str(transport)
    if body.get("command") and body.get("url"):
        raise Refused(400, "Give either 'command' or 'url', not both")
    if "command" in body:
        command = body.get("command")
        if not isinstance(command, str) or not command.strip():
            raise Refused(400, "'command' must be a non-empty string")
        if body.get("env"):
            raise Refused(403, "'env' can only be set for servers declared in the mcp config")
        if not command_allowed(command):
            raise Refused(
                403,
                f"Starting '{command}' from the UI is not allowed. "
                f"Declare the server under mcp.servers, or add it to mcp.allow.commands.",
            )
        cfg.update(command=command, args=_strings(body.get("args") or [], "args"))
    else:
        url = body.get("url")
        if not isinstance(url, str) or not url.strip():
            raise Refused(400, "'url' must be a non-empty string")
        headers = body.get("headers") or {}
        if not isinstance(headers, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in headers.items()
        ):
            raise Refused(400, "'headers' must map names to strings")
        from praisonaiui.features.mcp import url_label

        matched = match_url(url, _settings.allow.urls)
        if matched is None:
            raise Refused(403, f"{url_label(url)} is not in mcp.allow.urls")
        host = (urlsplit(url).hostname or "").lower()
        if (matched.strip() == "*" or "*" in _pattern(matched)[1]) and not await _public_host(host):
            raise Refused(
                403,
                f"{host} is not a public address. Name the host in mcp.allow.urls to allow it.",
            )
        for value in headers.values():
            register_secret(value)
        cfg.update(url=url, headers=headers)
    try:
        from praisonaiui.features.mcp import select_transport

        select_transport(cfg)
    except ValueError as exc:
        raise Refused(400, str(exc)) from None
    return cfg


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
        "source": "config" if server.name in _declared else "user",
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
    return JSONResponse(
        {
            "servers": [public_view(s) for s in servers],
            "enabled": _settings.enabled,
            "allow": {
                "urls": list(_settings.allow.urls),
                "commands": list(_settings.allow.commands),
            },
        }
    )


async def api_mcp_connect(request: Request) -> JSONResponse:
    """POST /api/mcp/connect — Connect a declared server by name, or add an allowed one."""
    if not _settings.enabled:
        return JSONResponse({"error": "MCP is turned off (mcp.enabled: false)"}, status_code=403)
    body = await request.json()
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return JSONResponse({"error": "Missing required field: name"}, status_code=400)
    name = name.strip()
    has_target = "url" in body or "command" in body
    try:
        if name in _declared:
            if has_target:
                raise Refused(
                    409, f"'{name}' is declared in the mcp config; send only its name to reconnect it"
                )
            cfg = dict(_declared[name])
        elif not has_target:
            raise Refused(
                400, "Either 'command' (for stdio) or 'url' (for Streamable HTTP or SSE) is required"
            )
        else:
            cfg = await user_server(name, body)
    except Refused as refused:
        return JSONResponse({"error": refused.message}, status_code=refused.status)

    session_id = body.get("session_id") or request.query_params.get("session_id")
    try:
        from praisonaiui.features.mcp import connect_mcp_server

        server = await connect_mcp_server(cfg, session_context={"session_id": session_id})
    except ImportError:
        return JSONResponse({"error": _INSTALL_HINT}, status_code=400)
    except ValueError as exc:
        return JSONResponse({"error": redact_secrets(str(exc))}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        logger.exception("MCP connect failed for %s", name)
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


# ── Startup and shutdown ─────────────────────────────────────────────


async def connect_declared() -> None:
    """Connect every server in ``mcp.servers`` at once; one failure never stops the rest."""
    if not _settings.enabled or not _declared:
        return
    from praisonaiui.features.mcp import connect_mcp_server

    async def one(cfg: dict[str, Any]) -> None:
        try:
            await connect_mcp_server(dict(cfg))
        except Exception:  # noqa: BLE001
            logger.exception("mcp: server %s from the config did not start", cfg["name"])

    await asyncio.gather(*(one(cfg) for cfg in _declared.values()))


def _on_startup() -> None:
    """In the background: a slow server never holds up the app."""
    global _startup_task
    if _settings.enabled and _declared:
        _startup_task = asyncio.get_running_loop().create_task(connect_declared())


async def _on_shutdown() -> None:
    global _startup_task
    task, _startup_task = _startup_task, None
    if task is not None and not task.done():
        task.cancel()
        with contextlib.suppress(BaseException):
            await task
    mcp = sys.modules.get("praisonaiui.features.mcp")
    if mcp is not None:
        await mcp.disconnect_all_mcp_servers()


def routes() -> list[Route]:
    """``builtin.mcp``'s routes; also reads the config and registers the lifecycle hooks."""
    configure(_config_section())
    install_secret_redaction(*_LOGGERS)
    from praisonaiui.features.lifecycle import register_shutdown_hook, register_startup_hook

    register_startup_hook(_on_startup)
    register_shutdown_hook(_on_shutdown)
    return [
        Route("/api/mcp/servers", api_mcp_servers, methods=["GET"]),
        Route("/api/mcp/connect", api_mcp_connect, methods=["POST"]),
        Route("/api/mcp/disconnect/{server_id}", api_mcp_disconnect, methods=["POST"]),
    ]
