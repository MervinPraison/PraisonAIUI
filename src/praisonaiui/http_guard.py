"""Request guards shared by the auth middlewares.

* ``is_public_http`` — the paths a logged-out browser needs (the HTML shell,
  static code, health). Auth middlewares gate everything else, deny by
  default, so a new route is protected without being listed anywhere.
* ``is_browser_navigation`` / ``NavigationRoute`` — a top-level page load of
  a URL that is also a JSON API gets the page, never the data.
* WebSocket credentials and rejection (``websocket_token``,
  ``reject_websocket``), plus short-lived single-use WebSocket tickets
  (``POST /api/auth/ws-ticket``) so browsers never put a long-lived key in a
  URL.
* ``OriginGuardMiddleware`` — refuses cross-site WebSocket handshakes and
  cross-site state-changing requests (CSRF, including ``text/plain`` "simple"
  requests that skip the CORS preflight).
* ``HostGuardMiddleware`` — refuses a request to a loopback or private-network
  server whose ``Host`` is a DNS name it does not know (DNS rebinding).
* ``JSONObjectBodyMiddleware`` — answers 400 to a JSON request body that is
  an array or a scalar, which every built-in handler would index as a dict.
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
from starlette.routing import BaseRoute, Match, NoMatchFound

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

#: API prefixes a logged-out browser needs (GET only): starting OAuth sign-in
#: and the provider's callback. They redirect; they return no user data.
PUBLIC_API_PREFIXES = ("/api/auth/oauth/",)

#: Static files served publicly from a ``static_dir`` (code, styles, fonts,
#: images). Anything else there (markdown, JSON, HTML pages) holds content and
#: needs credentials like any other route.
PUBLIC_STATIC_SUFFIXES = frozenset(
    {
        ".js", ".mjs", ".css", ".map", ".woff", ".woff2", ".ttf", ".otf", ".eot",
        ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
    }
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
    if path.startswith(PUBLIC_PREFIXES) or path.startswith(PUBLIC_API_PREFIXES):
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


_PAGE_CONTENT = re.compile(
    r'<noscript>.*?</noscript>|<script type="application/json" id="aiui-initial-doc">.*?</script>',
    re.S | re.I,
)


def strip_page_content(html: str) -> str:
    """A built docs page without its body: the ``<noscript>`` copy and the
    inlined markdown (``#aiui-initial-doc``) are removed, so the page is the
    app shell, which then fetches the markdown with credentials. The title
    and description stay; ``/docs-nav.json`` lists them anyway."""
    return _PAGE_CONTENT.sub("", html)


def static_dir_public_predicate(root: Any) -> Callable[[Request], bool]:
    """Which requests to a ``create_app(static_dir=...)`` mount need no credentials.

    Public: a path with no file behind it (the server answers with the
    generated HTML shell), HTML pages (served by ``create_app`` without their
    content, :func:`strip_page_content`, so a signed-out browser gets the app
    and its sign-in prompt) and code, style, font and image files
    (:data:`PUBLIC_STATIC_SUFFIXES`). Markdown, JSON and any other file need
    credentials in every auth mode, as they do under ``AIUI_REQUIRE_TOKEN``.
    ``AIUI_PUBLIC_STATIC_DIR=1`` makes the whole folder public again (a
    public docs site in front of a private API).
    """
    from pathlib import Path

    base = Path(root).resolve()

    def _inside(candidate: Path) -> Optional[Path]:
        try:
            resolved = candidate.resolve()
        except (OSError, RuntimeError, ValueError):
            return None
        return resolved if resolved == base or resolved.is_relative_to(base) else None

    def _public(request: Request) -> bool:
        if os.environ.get("AIUI_PUBLIC_STATIC_DIR", "").strip().lower() in ("1", "true", "yes"):
            return True
        rel = request.scope.get("path", "").lstrip("/")
        if not rel:
            return True
        target = _inside(base / rel)
        if target is not None and target.is_dir():
            target = _inside(target / "index.html")
        elif target is None or not target.is_file():
            target = _inside(base / f"{rel.rstrip('/')}.html")
        if target is None or not target.is_file():
            return True  # no file: the generated HTML shell
        suffix = target.suffix.lower()
        return suffix == ".html" or suffix in PUBLIC_STATIC_SUFFIXES

    return _public


# ── Page navigations ─────────────────────────────────────────────────


def is_browser_navigation(scope: dict) -> bool:
    """True for a top-level page load, False for ``fetch()`` / XHR.

    Browsers send ``Sec-Fetch-Mode: navigate`` only for a page load
    (``fetch()`` sends ``cors`` / ``same-origin`` / ``no-cors``). Without
    that header, a navigation asks for ``text/html`` and not for JSON
    (``fetch()`` defaults to ``*/*``).
    """
    if scope.get("type") != "http" or scope.get("method", "GET") not in _SAFE_METHODS:
        return False
    mode = header(scope, b"sec-fetch-mode").strip().lower()
    if mode:
        return mode == "navigate"
    if header(scope, b"x-requested-with"):
        return False
    accept = header(scope, b"accept").lower()
    return "text/html" in accept and "application/json" not in accept


class NavigationRoute(BaseRoute):
    """Route that takes a request only when ``predicate(scope)`` is true.

    The host puts one first in its route table, so a browser navigation to a
    page URL that is also a JSON API (``GET /sessions``) gets the page while
    ``fetch()`` keeps getting the API. ``endpoint`` is what auth middlewares
    see for the request (:func:`_matched_endpoint`), so a navigation is
    public exactly when that endpoint is (``mark_public``), and it never
    reaches the data handler.
    """

    path = "{navigation}"

    def __init__(self, predicate: Callable[[dict], bool], endpoint: Any, app: Any) -> None:
        self.predicate = predicate
        self.endpoint = endpoint
        self.app = app

    #: Per-request memo in the scope: auth middlewares match the route table
    #: (:func:`_matched_endpoint`) before the router does, and the predicate
    #: may scan plugin folders, so it runs once per request and path.
    _MEMO_KEY = "aiui.navigation_match"

    def matches(self, scope: dict) -> tuple[Match, dict]:
        key = (id(self), scope.get("path", ""), scope.get("method", ""))
        memo = scope.get(self._MEMO_KEY)
        if memo is not None and memo[0] == key:
            hit = memo[1]
        else:
            try:
                hit = bool(self.predicate(scope))
            except Exception:  # noqa: BLE001 - a failing check never diverts a request
                hit = False
            scope[self._MEMO_KEY] = (key, hit)
        return (Match.FULL, {}) if hit else (Match.NONE, {})

    async def handle(self, scope, receive, send) -> None:
        await self.app(scope, receive, send)

    def url_path_for(self, name: str, /, **path_params: Any):
        raise NoMatchFound(name, path_params)


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


# ── Request body size ────────────────────────────────────────────────

#: Default cap on any request body, in MiB (``AIUI_MAX_BODY_MB`` overrides).
DEFAULT_MAX_BODY_MB = 25
#: Cap on a body sent to a path that needs no credentials (login, sign-up,
#: protocol negotiation): small, because anyone can send one.
PUBLIC_MAX_BODY_BYTES = 64 * 1024
#: Unauthenticated POST paths outside PUBLIC_EXACT_PATHS (the sign-up policy
#: lets some through without a session).
_SIGNUP_PATHS = frozenset({"/register", "/api/auth/register"})


def configured_max_body_bytes(env: Optional[dict] = None) -> int:
    """``AIUI_MAX_BODY_MB`` in bytes (default 25 MiB; ``0`` turns the cap off)."""
    raw = (env if env is not None else os.environ).get("AIUI_MAX_BODY_MB", "").strip()
    try:
        mb = float(raw) if raw else DEFAULT_MAX_BODY_MB
    except ValueError:
        logging.getLogger(__name__).warning(
            "AIUI_MAX_BODY_MB=%r is not a number; using %s", raw, DEFAULT_MAX_BODY_MB
        )
        mb = DEFAULT_MAX_BODY_MB
    return max(0, int(mb * 1024 * 1024))


class RequestBodyTooLarge(Exception):
    """Raised from ``receive()`` once a body passes its cap."""


class BodySizeLimitMiddleware:
    """Answer 413 to a request body over its cap, before it is buffered.

    The cap is ``AIUI_MAX_BODY_MB`` (default 25 MiB) for authenticated
    routes and :data:`PUBLIC_MAX_BODY_BYTES` for paths that need no
    credentials, so an anonymous client cannot make the server hold a large
    body in memory. A ``Content-Length`` over the cap is refused without
    reading; a chunked body is counted as it streams and stopped at the cap.
    """

    def __init__(self, app, max_bytes: Optional[int] = None, public_max_bytes: int = PUBLIC_MAX_BODY_BYTES):
        self.app = app
        self.max_bytes = configured_max_body_bytes() if max_bytes is None else max_bytes
        self.public_max_bytes = public_max_bytes

    def _limit(self, scope: dict) -> int:
        path = scope.get("path", "")
        if path in PUBLIC_EXACT_PATHS or path in _SIGNUP_PATHS:
            return min(self.public_max_bytes, self.max_bytes) if self.max_bytes else self.public_max_bytes
        return self.max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self._limit(scope)
        if not limit:
            await self.app(scope, receive, send)
            return
        declared = header(scope, b"content-length")
        if declared.isdigit() and int(declared) > limit:
            await self._too_large(scope, receive, send, limit)
            return

        received = 0
        exceeded = False
        answered = False

        async def limited_receive():
            nonlocal received, exceeded
            if exceeded:
                raise RequestBodyTooLarge()
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise RequestBodyTooLarge()
            return message

        async def guarded_send(message):
            # Once the cap is hit, whatever the app answers (a 500 from an
            # error handler, a handler that caught the exception) becomes 413.
            nonlocal answered
            if not exceeded:
                answered = answered or message["type"] == "http.response.start"
                await send(message)
            elif not answered:
                answered = True
                await self._too_large(scope, receive, send, limit)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except RequestBodyTooLarge:
            pass
        except Exception:
            if not exceeded:
                raise
        if exceeded and not answered:
            await self._too_large(scope, receive, send, limit)

    @staticmethod
    async def _too_large(scope, receive, send, limit: int) -> None:
        response = JSONResponse(
            {"error": f"Request body too large (limit {limit} bytes)"}, status_code=413
        )
        await response(scope, receive, send)


# ── JSON request bodies ──────────────────────────────────────────────

_BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
#: Content types whose body the handlers read with ``request.json()``.
_JSON_LIKE = ("application/json", "text/plain", "")
_MAX_INSPECT_BYTES = 4 * 1024 * 1024


def _json_like(content_type: str) -> bool:
    ct = content_type.split(";", 1)[0].strip().lower()
    return ct in _JSON_LIKE or ct.endswith("+json")


class JSONObjectBodyMiddleware:
    """Refuse a JSON request body that is not an object (or ``null``).

    Every built-in handler reads its body with ``await request.json()`` and
    then calls ``body.get(...)`` / ``body[...]``, so ``[1, 2]`` or ``"x"``
    raised inside the handler and came back as a 500. This answers 400
    before the handler runs, for every route at once. Malformed JSON, an
    empty body and ``null`` pass through unchanged (handlers already deal
    with them), as do multipart uploads and other non-JSON bodies, bodies
    over 4 MiB, and third-party plugin routes under *skip_prefixes*.
    """

    def __init__(self, app, skip_prefixes: Iterable[str] = ("/api/plugins/",)):
        self.app = app
        self.skip_prefixes = tuple(skip_prefixes)

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("method", "GET") not in _BODY_METHODS
            or scope.get("path", "").startswith(self.skip_prefixes)
            or not _json_like(header(scope, b"content-type"))
        ):
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        size = 0
        more = True
        pending: Optional[dict] = None
        while more:
            message = await receive()
            if message["type"] != "http.request":
                pending = message  # disconnect: let the app see it
                break
            body = message.get("body", b"")
            chunks.append(body)
            size += len(body)
            more = message.get("more_body", False)
            if size > _MAX_INSPECT_BYTES:
                break
        buffered = b"".join(chunks)

        if not more and pending is None and _is_non_object_json(buffered):
            response = JSONResponse(
                {"error": "Request body must be a JSON object"}, status_code=400
            )
            await response(scope, receive, send)
            return

        replayed = False

        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                if pending is not None and not buffered:
                    return pending
                return {"type": "http.request", "body": buffered, "more_body": more}
            if pending is not None:
                return pending
            return await receive()

        await self.app(scope, replay, send)


def _is_non_object_json(body: bytes) -> bool:
    import json

    text = body.strip()
    if not text or text[:1] in (b"{", b"n"):
        return False  # empty, an object or null (or malformed: the handler decides)
    try:
        value = json.loads(text)
    except (ValueError, UnicodeDecodeError):
        return False
    return not isinstance(value, dict) and value is not None


async def invalid_json_handler(request, exc):
    """``json.JSONDecodeError`` from a handler: 400 when the request had a body.

    Handlers read their body with ``await request.json()``; malformed or
    empty JSON raised there and came back as a 500 with a logged traceback.
    Any other source of the error (no request body) stays a 500.
    """
    if request.method not in _BODY_METHODS:
        raise exc
    return JSONResponse({"error": "Request body is not valid JSON"}, status_code=400)


def json_exception_handlers() -> dict:
    """The ``exception_handlers`` mapping ``create_app`` installs."""
    import json

    return {json.JSONDecodeError: invalid_json_handler}


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
