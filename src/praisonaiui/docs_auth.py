"""Sign-in for a built docs site on ``aiui serve`` and ``aiui dev`` (docs/features/docs-auth.md).

A build with ``content.docs.auth`` writes ``aiui-access.json`` (compiler/access.py):
each page's rule (anyone, any signed-in reader, or readers in named groups) and the
environment variable holding each reader's password. :meth:`DocsAuth.wrap` enforces it:

* a page and every file made from it (its HTML, ``.md`` twins, ``og/`` card, Try it
  data, feed) answers only readers its rule lets in. A signed-out browser gets the
  sign-in page (401), a signed-in reader outside the page's groups a 404;
* ``docs-nav.json``, ``search-index.json`` and the ``llms`` files are cut to what the
  reader may read; MCP, Ask AI, search and feedback see only those pages
  (:func:`view`, a :class:`View`);
* code, styles, fonts, images and the site config are open to anyone; any other file
  needs sign-in. A signed-out ``GET`` that the site answers with a redirect still
  gets it.

The session is a signed, ``HttpOnly``, ``SameSite=Lax`` cookie. Its key comes from
the reader's password, so changing a password signs that reader out everywhere.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import os
import posixpath
import re
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, urlsplit

from praisonaiui import http_guard as hg
from praisonaiui.compiler.access import ACCESS_FILE

log = logging.getLogger(__name__)

LOGIN, LOGOUT = "/__aiui/login", "/__aiui/logout"
COOKIE = "aiui_docs"
SESSION_S = 7 * 24 * 3600
MAX_FAILS, FAIL_WINDOW_S = 10, 600  # wrong passwords per client per window
SCOPE_KEY = "aiui.docs_view"
#: Files built from every page: cut to what the reader may read.
FILTERED = frozenset({"/search-index.json", "/docs-nav.json", "/llms.txt", "/llms-full.txt",
                      "/.well-known/llms.txt", "/.well-known/llms-full.txt"})
#: Open to anyone: the site's config and discovery files, and the endpoints that filter by reader.
OPEN = frozenset({"/ui-config.json", "/aiui-manifest.json", "/route-manifest.json", "/robots.txt",
                  "/sitemap.xml", "/404.html", "/LICENSE-fonts.txt", "/mcp", "/.well-known/mcp",
                  "/.well-known/mcp.json", "/.well-known/mcp/server-card.json", "/api/docs/ask",
                  "/api/docs/search", "/api/docs/feedback"})
OPEN_PREFIXES = ("/assets/", "/plugins/", "/grammars/")
_OPEN = frozenset(p.casefold() for p in OPEN)
_PAGE_SUFFIXES = (".source.md", ".md", "/index.html", ".html", "/rss.xml")
_LINK = re.compile(r"^- \[[^\]]*\]\(([^)\s]+)\)")
_SOURCE = re.compile(r"^Source: (\S+)$", re.M)


@dataclass(frozen=True)
class Reader:
    name: str
    groups: frozenset


class View:
    """What one reader (``None``: signed out) may read."""

    def __init__(self, auth: DocsAuth, reader: Optional[Reader]):
        self.auth, self.reader = auth, reader
        self.full = reader is not None and all(self.can(r) for r in auth.pages)

    def can(self, route: str) -> bool:
        """May the reader read the page at ``route`` (a route with no rule needs sign-in)?"""
        rule = self.auth.pages.get(route.rstrip("/").casefold() or "/")
        if rule is True:
            return True
        return self.reader is not None and (not rule or bool(self.reader.groups & rule))

    def may(self, path: str) -> bool:
        """May the reader fetch ``path`` (relative to the site, or a URL with the base path)?"""
        kind, route = self.auth.classify(self.auth.relative(path))
        return self.can(route) if kind == "page" else kind in ("open", "filtered") or self.reader is not None

    def llms(self, text: str) -> str:
        """``llms.txt`` without the links the reader may not follow, and sections left empty."""
        lines = [ln for ln in text.split("\n") if not (m := _LINK.match(ln)) or self.may(m.group(1))]
        out: list[str] = []
        for i, line in enumerate(lines):
            if line.startswith("## ") and not next((ln for ln in lines[i + 1:] if ln.strip()), "").startswith("- "):
                continue
            if not (line == "" and out and out[-1] == ""):
                out.append(line)
        return "\n".join(out)

    def filter(self, path: str, body: bytes) -> bytes:
        """One of :data:`FILTERED` cut to what the reader may read."""
        if self.full:
            return body
        text = body.decode("utf-8", "replace")
        if path.endswith("llms-full.txt"):
            parts = text.split("\n\n---\n\n")
            keep = [p for p in parts[1:] if (m := _SOURCE.search(p)) and self.may(m.group(1))]
            return ("\n\n---\n\n".join(parts[:1] + keep).rstrip("\n") + "\n").encode()
        if path.endswith(".txt"):
            return self.llms(text).encode()
        data = json.loads(text)
        if path == "/search-index.json":
            data["pages"] = [p for p in data.get("pages", []) if self.can(p.get("p", ""))]
        else:
            data["items"] = self._nav(data.get("items", []))
        return json.dumps(data, ensure_ascii=False).encode()

    def _nav(self, items: list) -> list:
        out = []
        for item in items:
            kids = self._nav(item["children"]) if item.get("children") else None
            ok = not item.get("path") or self.can(item["path"])
            if (not ok and not kids) or (kids == [] and not item.get("path")):
                continue
            entry = {**item, **({"children": kids} if kids is not None else {})}
            if not ok:
                entry.pop("path")
            out.append(entry)
        return out


def view(scope: dict) -> Optional[View]:
    """The reader's :class:`View` on a site with sign-in, else ``None`` (read everything)."""
    found = scope.get(SCOPE_KEY)
    return found if isinstance(found, View) and not found.full else None


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class DocsAuth:
    """The sign-in and access rules of one built site (``root``)."""

    def __init__(self, root: Path, base: str, data: dict, env: Optional[dict] = None):
        env = os.environ if env is None else env
        self.root, self.base = root, base
        self.docs = str(data.get("docs") or "").casefold()
        self.pages: dict[str, Any] = {
            r.casefold(): v if isinstance(v, bool) else frozenset(v) for r, v in (data.get("pages") or {}).items()}
        self.users: list[tuple[str, bytes, bytes, frozenset]] = []
        for user in data.get("users") or []:
            secret = str(env.get(user.get("env", ""), "")).encode()
            if not secret:
                log.warning("Docs sign-in: %s is not set, so %s cannot sign in", user.get("env"), user.get("name"))
                continue
            name = str(user["name"])
            key = hashlib.pbkdf2_hmac("sha256", secret, f"aiui-docs:{name}".encode(), 100_000)
            self.users.append((name, hashlib.sha256(secret).digest(), key, frozenset(user.get("groups") or [])))
        if not self.users:
            log.warning("Docs sign-in: no password is set; only open pages are served")
        self.fails: dict[str, deque] = {}

    @classmethod
    def for_site(cls, root: Path, base: str = "") -> Optional[DocsAuth]:
        """The rules of a build made with ``content.docs.auth``, else ``None``."""
        try:
            data = json.loads((root / ACCESS_FILE).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return cls(root, base, data) if isinstance(data, dict) else None

    def relative(self, url: str) -> str:
        path = urlsplit(url).path or "/"
        return path[len(self.base):] or "/" if self.base and path.startswith(self.base + "/") else path

    def classify(self, path: str) -> tuple[str, str]:
        """``(kind, route)``: kind ``page``, ``filtered`` (route: the file), ``open``, ``hidden`` or
        ``other``. Compared normalized and case-folded, as a case-insensitive disk finds files."""
        path = posixpath.normpath(re.sub(r"/+", "/", "/" + path)).casefold()
        p = path.rstrip("/") or "/"
        if p.startswith("/og/") and p.endswith(".png"):
            p = p[3:-4]
            p = "/" if p == "/index" else p
        elif p.startswith("/openapi/try/") and p.endswith(".json"):
            p = self.docs + p[12:-5]
        else:
            p = next((p[: -len(s)] for s in _PAGE_SUFFIXES if p.endswith(s)), p)
        p = p.rstrip("/") or "/"
        if p in self.pages:
            return "page", p
        if path in FILTERED:
            return "filtered", path
        if path == "/" + ACCESS_FILE:
            return "hidden", ""
        suffix = os.path.splitext(path)[1]
        if path in _OPEN or path.startswith(OPEN_PREFIXES) or suffix in hg.PUBLIC_STATIC_SUFFIXES:
            return "open", ""
        return "other", ""

    @staticmethod
    def _sign(key: bytes, name: str, expires: int) -> str:
        return hmac.new(key, f"{name}|{expires}".encode(), hashlib.sha256).hexdigest()

    def session(self, user: tuple) -> str:
        expires = int(time.time()) + SESSION_S
        return f"{_b64(user[0].encode())}.{expires}.{self._sign(user[2], user[0], expires)}"

    def reader(self, scope: dict) -> Optional[Reader]:
        """The signed-in reader, from a valid, unexpired session cookie."""
        parts = hg.cookie(scope, COOKIE).split(".")
        if len(parts) != 3 or not parts[1].isdigit() or int(parts[1]) < time.time():
            return None
        try:
            name = base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)).decode()
        except ValueError:
            return None
        for uname, _, key, groups in self.users:
            if uname == name and hmac.compare_digest(self._sign(key, name, int(parts[1])), parts[2]):
                return Reader(name, groups)
        return None

    def check(self, password: str) -> Optional[tuple]:
        """The reader whose password this is; every password is compared, in constant time."""
        digest, found = hashlib.sha256(password.encode()).digest(), None
        for user in self.users:
            if hmac.compare_digest(digest, user[1]) and found is None:
                found = user
        return found

    def allow(self, client: str) -> bool:
        """Fewer than MAX_FAILS wrong passwords from ``client`` in the last FAIL_WINDOW_S."""
        if len(self.fails) > 10_000:
            self.fails.clear()
        now, q = time.monotonic(), self.fails.setdefault(client, deque())
        while q and now - q[0] > FAIL_WINDOW_S:
            q.popleft()
        return len(q) < MAX_FAILS

    def wrap(self, app):
        """``app`` behind the access rules (paths relative to the base path)."""

        async def gated(scope, receive, send):
            if scope["type"] != "http":
                await app(scope, receive, send)
                return
            path = scope.get("path", "/")
            current = View(self, self.reader(scope))
            scope = {**scope, SCOPE_KEY: current}
            if path in (LOGIN, LOGOUT):
                await (await self._login(scope, receive, current))(scope, receive, send)
                return
            kind, route = self.classify(path)
            if kind == "open":
                await app(scope, receive, send)
            elif kind == "hidden":
                await self._not_found(scope, receive, send)
            elif kind == "filtered":
                await self._filtered(app, scope, receive, send, current, route)
            elif current.can(route) if kind == "page" else current.reader is not None:
                await app(scope, receive, _private(send))
            elif kind == "page" or scope.get("method") not in ("GET", "HEAD"):
                await self._deny(scope, receive, send, current)
            else:  # signed out: a redirect carries no content, anything else is refused
                passed: list[bool] = []

                async def redirect_only(message):
                    if message["type"] == "http.response.start":
                        passed.append(300 <= message["status"] < 400)
                    if passed and passed[0]:
                        await send(message)

                await app(scope, receive, redirect_only)
                if not (passed and passed[0]):
                    await self._deny(scope, receive, send, current)

        return gated

    async def _filtered(self, app, scope, receive, send, current: View, name: str) -> None:
        if current.full:
            await app(scope, receive, _private(send))
            return
        drop = {b"accept-encoding", b"if-none-match", b"if-modified-since", b"range"}
        scope["headers"] = [(k, v) for k, v in scope.get("headers") or () if k.lower() not in drop]
        start: dict = {}
        chunks: list[bytes] = []

        async def capture(message):  # the file, or what MCP serves for it (llms.txt with its own section)
            if message["type"] == "http.response.start":
                start.update(message)
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))

        await app(scope, receive, capture)
        body, status = b"".join(chunks), start.get("status", 500)
        if status == 200:
            try:
                body = current.filter(name, body)
            except (ValueError, AttributeError, TypeError):
                body, status = b"", 500
        gone = {b"etag", b"last-modified", b"cache-control", b"content-encoding", b"vary", b"content-length"}
        headers = [(k, v) for k, v in start.get("headers", []) if k.lower() not in gone]
        headers += [(b"content-length", str(len(body)).encode())] + [(k.lower().encode(), v.encode())
                                                                    for k, v in _PRIVATE.items()]
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    async def _not_found(self, scope, receive, send) -> None:
        from starlette.responses import HTMLResponse, PlainTextResponse

        page = self.root / "404.html"
        if hg.is_browser_navigation(scope) and page.is_file():
            response: Any = HTMLResponse(page.read_text(encoding="utf-8"), 404, headers=_NO_STORE)
        else:
            response = PlainTextResponse("Not Found", 404, headers=_NO_STORE)
        await response(scope, receive, send)

    async def _deny(self, scope, receive, send, current: View) -> None:
        """A signed-in reader outside the page's groups: 404. Signed out: the sign-in page (401)."""
        from starlette.responses import HTMLResponse, PlainTextResponse

        if current.reader is not None:
            await self._not_found(scope, receive, send)
            return
        if hg.is_browser_navigation(scope):
            query = scope.get("query_string", b"").decode("latin-1")
            target = scope.get("path", "/") + (f"?{query}" if query else "")
            response: Any = HTMLResponse(self.page(current, target), 401, headers=_NO_STORE)
        else:
            response = PlainTextResponse(f"Sign in at {self.base}{LOGIN}", 401, headers=_NO_STORE)
        await response(scope, receive, send)

    async def _login(self, scope: dict, receive, current: View):
        from starlette.responses import HTMLResponse, PlainTextResponse, RedirectResponse

        method = scope.get("method", "GET")
        if method in ("GET", "HEAD") and scope["path"] == LOGIN:
            target = _local(hg.query_param(scope, "next"))
            return HTMLResponse(self.page(current, target), headers=_NO_STORE)
        if method != "POST":
            return PlainTextResponse("Method Not Allowed", 405, headers={"Allow": "POST"})
        if not hg.host_allowed(scope, hg.configured_hosts()):
            return PlainTextResponse("Host not allowed", 400)
        if not hg.origin_allowed(scope, hg.configured_origins()):
            return PlainTextResponse("Origin not allowed", 403)
        secure = "https" in (scope.get("scheme", ""), hg.header(scope, b"x-forwarded-proto").split(",")[0].strip())
        flags = f"; Path={self.base or '/'}; HttpOnly; SameSite=Lax" + ("; Secure" if secure else "")
        if scope["path"] == LOGOUT:
            response = RedirectResponse(self.base + "/", 303)
            response.headers.append("Set-Cookie", f"{COOKIE}=; Max-Age=0{flags}")
            return response
        body = b""
        while len(body) <= 4096:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        form = parse_qs(body.decode("utf-8", "replace")) if len(body) <= 4096 else {}
        target = _local((form.get("next") or ["/"])[0])
        client = (scope.get("client") or ("?",))[0]
        if not self.allow(client):
            return HTMLResponse(self.page(current, target, "Too many tries. Wait a few minutes and try again."),
                                429, headers={**_NO_STORE, "Retry-After": str(FAIL_WINDOW_S)})
        user = self.check((form.get("password") or [""])[0])
        if user is None:
            self.fails[client].append(time.monotonic())
            return HTMLResponse(self.page(current, target, "That password is not right."), 401, headers=_NO_STORE)
        self.fails.pop(client, None)
        response = RedirectResponse(self.base + target, 303)
        response.headers.append("Set-Cookie", f"{COOKIE}={self.session(user)}; Max-Age={SESSION_S}{flags}")
        return response

    def page(self, current: View, target: str, error: str = "") -> str:
        """The sign-in page (or, signed in, the sign-out page) in the site's own theme."""
        try:
            shell = (self.root / "index.html").read_text(encoding="utf-8")
            title = json.loads((self.root / "ui-config.json").read_text(encoding="utf-8"))["site"]["title"]
        except (OSError, ValueError, KeyError, TypeError):
            shell, title = "", "Docs"
        head = re.search(r"<head>(.*?)</head>", shell, re.S)
        # The site's stylesheets, icon and theme script (its CSP already allows that script).
        keep = re.findall(r'<link\b[^>]*\brel="(?:stylesheet|icon)"[^>]*>|<script>.*?</script>',
                          head.group(1) if head else "", re.S)
        e, base = html.escape, self.base
        if current.reader is not None:
            form = (f'<form method="post" action="{e(base + LOGOUT)}"><h1>{e(str(title))}</h1>'
                    f"<p>Signed in as {e(current.reader.name)}.</p>"
                    f'<a href="{e(base + target)}">Back to the docs</a><button type="submit">Sign out</button></form>')
        else:
            alert = f'<p role="alert">{e(error)}</p>' if error else ""
            form = (f'<form method="post" action="{e(base + LOGIN)}"><h1>{e(str(title))}</h1>'
                    f"<p>Sign in to read these docs.</p>{alert}"
                    '<label for="aiui-password">Password</label>'
                    '<input id="aiui-password" name="password" type="password" autocomplete="current-password" '
                    f'required autofocus><input type="hidden" name="next" value="{e(target)}">'
                    '<button type="submit">Sign in</button></form>')
        return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
                f'content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">'
                f'{"".join(keep)}<title>Sign in · {e(str(title))}</title><style>{_CSS}</style></head>'
                f"<body><main>{form}</main></body></html>")


def _local(target: str) -> str:
    """A path on this site to go back to (never another host)."""
    target = target.strip()
    ok = target.startswith("/") and not target.startswith("//") and "\\" not in target
    return target if ok and not any(ord(ch) < 32 for ch in target) else "/"


def _private(send):
    """``send`` with ``Cache-Control: private``: a shared cache keeps no protected answer."""

    async def wrapped(message):
        if message["type"] == "http.response.start":
            headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
            extra = [(k.lower().encode(), v.encode()) for k, v in _PRIVATE.items()]
            message = {**message, "headers": headers + extra}
        await send(message)

    return wrapped


_NO_STORE = {"Cache-Control": "no-store"}
_PRIVATE = {"Cache-Control": "private, no-cache", "Vary": "Cookie"}
_CSS = (
    "body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--background);"
    "color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif)}main{width:min(100% - 32px,360px)}"
    "form{display:grid;gap:12px;padding:24px;border:1px solid var(--border);border-radius:calc(var(--radius)*1.5);"
    "background:var(--card);color:var(--card-foreground)}h1{margin:0;font-size:1.25rem;font-weight:600}"
    "p{margin:0;color:var(--muted-foreground);font-size:.875rem}label{font-size:.875rem;font-weight:500}"
    "input,button{font:inherit;padding:8px 12px;border-radius:var(--radius)}"
    "input{border:1px solid var(--input);background:transparent;color:inherit}"
    "button{font-weight:500;border:0;background:var(--primary);color:var(--primary-foreground);cursor:pointer}"
    "a{color:var(--primary);font-size:.875rem}[role=alert]{color:var(--destructive)}"
    "input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--ring);outline-offset:2px}"
)
