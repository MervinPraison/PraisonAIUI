"""Request guards shared by the auth middlewares.

* ``is_public_http`` — the paths a logged-out browser needs (the HTML shell,
  static code, health). Auth middlewares gate everything else, deny by
  default, so a new route is protected without being listed anywhere.
* WebSocket credentials and rejection (``websocket_token``,
  ``reject_websocket``), plus short-lived single-use WebSocket tickets
  (``POST /api/auth/ws-ticket``) so browsers never put a long-lived key in a
  URL.
* ``OriginGuardMiddleware`` — refuses cross-site WebSocket handshakes and
  cross-site state-changing requests (CSRF, including ``text/plain`` "simple"
  requests that skip the CORS preflight).
* ``HostGuardMiddleware`` — refuses a request to a loopback or private-network
  server whose ``Host`` is a DNS name it does not know (DNS rebinding).
* ``install_secret_redaction`` — strips ``token=``/``ticket=`` values from
  uvicorn's access and error logs (and so from the Logs page buffer).
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re
import secrets
import socket
import threading
import time
from typing import Any, Callable, Iterable, Optional
from urllib.parse import parse_qs, urlsplit

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Match

# ── Public surface ───────────────────────────────────────────────────

#: Exact paths that never need credentials.
PUBLIC_EXACT_PATHS = frozenset(
    {
        "/",
        "/health",
        "/api/health",
        "/health/live",
        "/health/ready",
        "/api/health/live",
        "/api/health/ready",
        "/api/auth/login",
        "/login",
        "/api/protocol",
        "/api/protocol/negotiate",
        # Static boot files: the page, its icon and service worker, and the
        # configuration the HTML shell itself already carries.
        "/icon.svg",
        "/favicon.ico",
        "/robots.txt",
        "/manifest.json",
        "/sw.js",
        "/custom.js",
        "/ui-config.json",
        "/docs-nav.json",
        "/route-manifest.json",
    }
)

#: Path prefixes that serve static code and styles (no user data).
PUBLIC_PREFIXES = (
    "/assets/",
    "/plugins/",
    "/_aiui/externals/",
    "/_plugins/",
    "/dashboard-plugins/",
)

#: Attribute set on endpoints that answer a logged-out browser: True, or a
#: ``(Request) -> bool`` predicate (e.g. "only a browser page navigation").
PUBLIC_ATTR = "__aiui_public__"

_SAFE_METHODS = frozenset({"GET", "HEAD"})


def mark_public(endpoint: Any, when: Optional[Callable[[Request], bool]] = None) -> Any:
    """Mark *endpoint* (a route endpoint or ASGI app) as public.

    With *when*, only requests for which ``when(request)`` is true are public
    (the same function may also serve data, e.g. ``GET /sessions``).
    """
    setattr(endpoint, PUBLIC_ATTR, when if when is not None else True)
    return endpoint


def _matched_endpoint(scope: dict) -> Any:
    app = scope.get("app")
    router = getattr(app, "router", None)
    for route in getattr(router, "routes", ()):  # same order Starlette tries
        try:
            match, _child = route.matches(scope)
        except Exception:  # pragma: no cover - a broken route never matches
            continue
        if match == Match.FULL:
            return getattr(route, "endpoint", None) or getattr(route, "app", None)
    return None


def is_public_http(scope: dict) -> bool:
    """True if an HTTP request may proceed without credentials."""
    path = scope.get("path", "")
    if path in PUBLIC_EXACT_PATHS:
        return True
    if scope.get("method", "GET") not in _SAFE_METHODS:
        return False
    if path.startswith(PUBLIC_PREFIXES):
        return True
    if path.startswith("/api/"):
        return False
    endpoint = _matched_endpoint(scope)
    marker = getattr(endpoint, PUBLIC_ATTR, None)
    if marker is True:
        return True
    if callable(marker):
        try:
            return bool(marker(Request(scope)))
        except Exception:
            return False
    return False


# ── Credentials ──────────────────────────────────────────────────────


def header(scope: dict, name: bytes) -> str:
    for key, value in scope.get("headers") or ():
        if key == name:
            return value.decode("latin-1")
    return ""


def bearer_token(scope: dict) -> str:
    auth = header(scope, b"authorization")
    return auth[7:] if auth.startswith("Bearer ") else ""


def query_param(scope: dict, name: str) -> str:
    qs = parse_qs(scope.get("query_string", b"").decode("latin-1"))
    return (qs.get(name) or [""])[0]


def cookie(scope: dict, name: str) -> str:
    raw = header(scope, b"cookie")
    for part in raw.split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value
    return ""


def websocket_token(scope: dict) -> str:
    """A long-lived credential on a WebSocket handshake (header, then ``?token=``)."""
    return bearer_token(scope) or query_param(scope, "token")


async def reject_websocket(receive, send, reason: str = "Authorization required") -> None:
    """Refuse a WebSocket before it is accepted (HTTP 403 to the client)."""
    message = await receive()
    if message.get("type") == "websocket.connect":
        await send({"type": "websocket.close", "code": 1008, "reason": reason})


# ── WebSocket tickets ────────────────────────────────────────────────

WS_TICKET_TTL_S = 60.0
_MAX_TICKETS = 10_000
_tickets: dict[str, float] = {}
_tickets_lock = threading.Lock()


def issue_ws_ticket(ttl: float = WS_TICKET_TTL_S) -> str:
    ticket = secrets.token_urlsafe(24)
    now = time.monotonic()
    with _tickets_lock:
        if len(_tickets) >= _MAX_TICKETS:
            for key in [k for k, exp in _tickets.items() if exp <= now]:
                del _tickets[key]
            while len(_tickets) >= _MAX_TICKETS:
                del _tickets[next(iter(_tickets))]
        _tickets[ticket] = now + ttl
    return ticket


def consume_ws_ticket(ticket: str) -> bool:
    """True once for a live ticket; it is spent either way."""
    if not ticket:
        return False
    with _tickets_lock:
        expires = _tickets.pop(ticket, None)
    return expires is not None and expires > time.monotonic()


_TICKET_OK_KEY = "aiui_ws_ticket_ok"


def websocket_has_ticket(scope: dict) -> bool:
    """Does this handshake carry a live ``?ticket=``?

    The ticket is spent by the first gate that checks it, and the result is
    recorded on the scope, so every stacked auth middleware (AUTH_ENFORCE,
    URL token, require_auth) honours the same handshake. A ticket is only
    issued to a request that already passed all of the HTTP gates.
    """
    state = scope.setdefault("state", {})
    if state.get(_TICKET_OK_KEY):
        return True
    ok = consume_ws_ticket(query_param(scope, "ticket"))
    if ok:
        state[_TICKET_OK_KEY] = True
    return ok


async def ws_ticket_handler(request: Request) -> JSONResponse:
    """POST /api/auth/ws-ticket — a single-use credential for one handshake.

    The request itself passes the HTTP auth gates (Bearer key, URL-token
    cookie, session token), so holding a ticket proves the same access.
    """
    return JSONResponse(
        {"ticket": issue_ws_ticket(), "expires_in": int(WS_TICKET_TTL_S)},
        headers={"Cache-Control": "no-store"},
    )


# ── Cross-site guard ─────────────────────────────────────────────────

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})
_DEFAULT_PORTS = {"http": "80", "https": "443", "ws": "80", "wss": "443"}


def configured_origins(env: Optional[dict] = None) -> list[str]:
    """``AIUI_ALLOWED_ORIGINS`` (comma separated; ``*`` allows any origin)."""
    raw = (env if env is not None else os.environ).get("AIUI_ALLOWED_ORIGINS", "")
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


def _netloc(scheme: str, host: str) -> str:
    host = host.strip().lower()
    if not host:
        return ""
    if host.startswith("["):
        end = host.find("]")
        name, rest = host[: end + 1], host[end + 1 :]
    else:
        name, _, port = host.partition(":")
        rest = f":{port}" if port else ""
    port = rest[1:] if rest.startswith(":") else _DEFAULT_PORTS.get(scheme, "")
    return f"{name}:{port}"


def _hostname(netloc: str) -> str:
    return netloc.rsplit(":", 1)[0]


def origin_allowed(scope: dict, allowed: Iterable[str] = ()) -> bool:
    """Is this request same-origin (or from an allowed origin)?

    Browsers send ``Sec-Fetch-Site``, which is right behind any reverse proxy;
    without it the ``Origin`` header is compared with ``Host`` /
    ``X-Forwarded-Host``. A request with neither header is not from a browser
    page (curl, SDK clients, server-to-server) and is allowed.
    """
    allowed = list(allowed)
    if "*" in allowed:
        return True
    origin = header(scope, b"origin").strip().rstrip("/")
    if origin and origin.lower() in {a.lower() for a in allowed}:
        return True
    site = header(scope, b"sec-fetch-site").strip().lower()
    if site in ("same-origin", "none"):
        return True
    if not origin:
        return site == ""  # cross-site/same-site fetch with no Origin: refuse
    if origin == "null":
        return False
    parts = urlsplit(origin)
    origin_scheme = parts.scheme.lower()
    origin_loc = _netloc(origin_scheme, parts.netloc)
    if not origin_loc:
        return False
    req_scheme = {"ws": "http", "wss": "https"}.get(scope.get("scheme", "http"), scope.get("scheme", "http"))
    candidates = {_netloc(req_scheme, header(scope, b"host"))}
    for fwd in header(scope, b"x-forwarded-host").split(","):
        if fwd.strip():
            fwd_scheme = header(scope, b"x-forwarded-proto").split(",")[0].strip() or origin_scheme
            candidates.add(_netloc(fwd_scheme, fwd))
    if origin_loc in candidates:
        return True
    # Dev servers (Vite on :5173 proxying to :8000) and other local tools:
    # a loopback page talking to a loopback server.
    host_names = {_hostname(c) for c in candidates if c}
    return _hostname(origin_loc) in _LOOPBACK_HOSTS and bool(host_names & _LOOPBACK_HOSTS)


class OriginGuardMiddleware:
    """Refuse cross-site WebSocket handshakes and state-changing requests.

    Safe methods (GET/HEAD/OPTIONS) pass: their responses are protected from
    cross-site reads by CORS. ``AIUI_ALLOWED_ORIGINS`` lists extra origins.
    """

    def __init__(self, app, allowed_origins: Optional[Iterable[str]] = None):
        self.app = app
        self.allowed = list(allowed_origins) if allowed_origins is not None else configured_origins()

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind == "websocket" and not origin_allowed(scope, self.allowed):
            logging.getLogger(__name__).warning(
                "Refused cross-site WebSocket %s from %s",
                scope.get("path", ""),
                header(scope, b"origin") or "?",
            )
            await reject_websocket(receive, send, "Cross-site WebSocket refused")
            return
        if (
            kind == "http"
            and scope.get("method", "GET") not in ("GET", "HEAD", "OPTIONS")
            and not origin_allowed(scope, self.allowed)
        ):
            response = JSONResponse(
                {
                    "error": "Cross-site request refused",
                    "hint": "Add the page's origin to AIUI_ALLOWED_ORIGINS to allow it.",
                },
                status_code=403,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


# ── Host guard (DNS rebinding) ───────────────────────────────────────


def configured_hosts(env: Optional[dict] = None) -> list[str]:
    """``AIUI_ALLOWED_HOSTS`` (comma separated; ``*`` turns the check off).

    An entry starting with ``.`` also matches its subdomains
    (``.example.com`` matches ``example.com`` and ``a.example.com``).
    """
    raw = (env if env is not None else os.environ).get("AIUI_ALLOWED_HOSTS", "")
    return [h.strip().lower().rstrip(".") for h in raw.split(",") if h.strip()]


def _host_header_name(value: str) -> str:
    value = value.strip().lower()
    if value.startswith("["):
        return value[1 : value.find("]")] if "]" in value else value[1:]
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


def _ip(value: str):
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def _rebindable_server(scope: dict) -> bool:
    """Does this connection reach the server on a non-public address?

    Loopback, private, link-local, unspecified and other non-global ranges.
    That is the address DNS rebinding points a victim's browser at. A server
    reached on a public address can be called directly, so rebinding gains
    an attacker nothing there and the check is skipped.
    """
    server = scope.get("server")
    if not server:
        return False
    ip = _ip(str(server[0]).strip("[]"))
    if ip is None:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return not ip.is_global


def _machine_names() -> set[str]:
    try:
        name = socket.gethostname().strip().lower().rstrip(".")
    except OSError:
        return set()
    return {name, f"{name}.local"} if name else set()


def host_allowed(scope: dict, allowed: Iterable[str] = ()) -> bool:
    """Is the ``Host`` header one this server answers to?

    Always allowed: IP literals, ``localhost`` / ``*.localhost``, mDNS
    ``*.local`` names, this machine's hostname, a missing Host (not a
    browser), and anything in ``AIUI_ALLOWED_HOSTS``. Only checked when the
    connection reaches the server on a loopback or private address.
    """
    allowed = list(allowed)
    if "*" in allowed or not _rebindable_server(scope):
        return True
    name = _host_header_name(header(scope, b"host")).rstrip(".")
    if not name or _ip(name) is not None:
        return True
    if name == "localhost" or name.endswith((".localhost", ".local")):
        return True
    if name in _machine_names():
        return True
    for entry in allowed:
        if entry.startswith("."):
            if name == entry[1:] or name.endswith(entry):
                return True
        elif name == entry:
            return True
    return False


class HostGuardMiddleware:
    """Refuse requests whose ``Host`` names an unknown site (DNS rebinding).

    After a DNS rebind an attacker's page is "same-origin" with a local
    server, so the Origin check passes; the ``Host`` header still carries
    the attacker's name. Install it outermost. HTTP gets 400, a WebSocket
    handshake is closed with 1008. ``AIUI_ALLOWED_HOSTS`` lists the public
    names of a server behind a reverse proxy on the same machine.
    """

    def __init__(self, app, allowed_hosts: Optional[Iterable[str]] = None):
        self.app = app
        self.allowed = list(allowed_hosts) if allowed_hosts is not None else configured_hosts()
        self._warned: set[str] = set()

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind not in ("http", "websocket") or host_allowed(scope, self.allowed):
            await self.app(scope, receive, send)
            return
        host = header(scope, b"host")
        if host not in self._warned and len(self._warned) < 100:
            self._warned.add(host)
            logging.getLogger(__name__).warning(
                "Refused request for Host %r (possible DNS rebinding). If this is "
                "the server's own name, add it to AIUI_ALLOWED_HOSTS.",
                host,
            )
        if kind == "websocket":
            await reject_websocket(receive, send, "Host not allowed")
            return
        response = JSONResponse(
            {
                "error": "Host not allowed",
                "hint": "Add this host name to AIUI_ALLOWED_HOSTS to allow it.",
            },
            status_code=400,
        )
        await response(scope, receive, send)


# ── Log redaction ────────────────────────────────────────────────────

_SECRET_QS = re.compile(r"([?&](?:token|ticket|api_key|access_token)=)[^&\s\"']+", re.IGNORECASE)


def redact_secrets(text: str) -> str:
    return _SECRET_QS.sub(r"\1[redacted]", text)


class SecretRedactionFilter(logging.Filter):
    """Rewrites ``?token=…`` style query values in a log record to ``[redacted]``."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_secrets(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(redact_secrets(a) if isinstance(a, str) else a for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {
                k: redact_secrets(v) if isinstance(v, str) else v for k, v in record.args.items()
            }
        return True


_REDACTED_LOGGERS = ("uvicorn.access", "uvicorn.error", "uvicorn")


def install_secret_redaction() -> None:
    """Attach the redaction filter to uvicorn's loggers (idempotent).

    Logger-level filters run before a record propagates, so the root log
    buffer behind the Logs page never sees the secret either.
    """
    for name in _REDACTED_LOGGERS:
        target = logging.getLogger(name)
        if not any(isinstance(f, SecretRedactionFilter) for f in target.filters):
            target.addFilter(SecretRedactionFilter())
