"""``aiui dev``: build a docs site, serve it, and reload the open tab on save.

* Every build goes to a fresh folder in a temporary directory, and the
  server switches to it only when the build succeeds: a broken edit never
  takes the preview down. The error is printed in the terminal and shown over
  the page, and the last good build stays up.
* The tab hears about builds over Server-Sent Events at :data:`EVENTS_PATH`.
  The small script that listens is added to HTML responses as they are
  served, never written to disk, so ``aiui build`` output never carries it.
* A reload keeps the scroll position, and the URL keeps the heading anchor.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Optional

EVENTS_PATH = "/__aiui/dev"

# Runs in the served page. __ID__ is the build the page came from; the stream
# sends {id, error} on connect and on every build. A new id reloads the page
# (also after a server restart: EventSource reconnects by itself), an error
# shows the overlay. Text goes in with textContent, never as HTML.
_CLIENT_JS = """(function () {
  var id = __ID__, key = "aiui-dev-scroll:" + location.pathname;
  try {
    var y = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (y) {
      y = +y;
      var tries = 0;
      (function restore() {
        if (document.documentElement.scrollHeight - innerHeight >= y || ++tries > 60) scrollTo(0, y);
        else setTimeout(restore, 50);
      })();
    }
  } catch (e) {}
  function overlay(text) {
    var box = document.getElementById("aiui-dev-error");
    if (!text) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement("div");
      box.id = "aiui-dev-error";
      box.setAttribute("role", "alert");
      box.style.cssText = "position:fixed;inset:auto 16px 16px 16px;z-index:2147483647;max-height:60vh;" +
        "overflow:auto;padding:16px;border-radius:8px;font:13px/1.5 ui-monospace,monospace;" +
        "background:var(--background,Canvas);color:var(--foreground,CanvasText);" +
        "border:2px solid var(--destructive,currentColor);box-shadow:0 8px 24px rgb(0 0 0 / .25)";
      var head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;gap:8px;font-weight:600";
      var title = document.createElement("span");
      title.textContent = "Build failed. Showing the last good build; save a fix to reload.";
      var close = document.createElement("button");
      close.type = "button";
      close.textContent = "Dismiss";
      close.setAttribute("aria-label", "Dismiss build error");
      close.style.cssText = "font:inherit;background:none;color:inherit;border:1px solid currentColor;" +
        "border-radius:4px;padding:0 8px;cursor:pointer";
      close.onclick = function () { box.remove(); };
      var pre = document.createElement("pre");
      pre.style.cssText = "margin:8px 0 0;white-space:pre-wrap;word-break:break-word";
      head.append(title, close);
      box.append(head, pre);
      document.body.appendChild(box);
    }
    box.lastChild.textContent = text;
  }
  var events = new EventSource(__URL__);
  events.onmessage = function (message) {
    var state = JSON.parse(message.data);
    if (state.error) return overlay(state.error);
    if (state.id === id) return overlay("");
    try { sessionStorage.setItem(key, String(scrollY)); } catch (e) {}
    events.close();
    location.reload();
  };
})();"""

_WAITING_PAGE = (
    b'<!doctype html><html lang="en"><head><meta charset="utf-8">'
    b'<meta name="viewport" content="width=device-width, initial-scale=1">'
    b"<title>aiui dev</title></head><body></body></html>"
)


def client_script(build_id: str) -> bytes:
    """The ``<script>`` that reloads a page built as *build_id*."""
    js = _CLIENT_JS.replace("__ID__", json.dumps(build_id)).replace(
        "__URL__", json.dumps(EVENTS_PATH)
    )
    return f"<script data-aiui-dev>{js}</script>".encode()


def with_client(html: bytes, build_id: str) -> bytes:
    """*html* with the reload script before ``</body>`` (appended without one)."""
    at = html.rfind(b"</body>")
    script = client_script(build_id)
    return html[:at] + script + html[at:] if at >= 0 else html + script


def _error_text(exc: BaseException) -> str:
    from pydantic import ValidationError

    from praisonaiui.schema.loader import ConfigLoadError

    if isinstance(exc, (ConfigLoadError, ValidationError, BuildError)):
        return str(exc)
    return f"{type(exc).__name__}: {exc}"


class BuildError(Exception):
    """The compiler reported a failed build."""


class DevSite:
    """The latest good build of a site, the ASGI app that serves it, and the
    reload stream. ``config`` None builds ``project/docs`` with defaults."""

    def __init__(self, config: Optional[Path], project: Path, url_base: Optional[str] = None):
        self.config = config.resolve() if config else None
        self.project = project.resolve()
        self.url_base = url_base
        self.workdir = Path(tempfile.mkdtemp(prefix="aiui-dev-"))
        self.root: Optional[Path] = None  # the build being served
        self.build_id = ""
        self.error = ""
        self.warnings: list[str] = []
        self._session = secrets.token_hex(4)
        self._count = 0
        self._served: tuple = (None, "")  # (app, build id): swapped together, read once per request
        self._git_dates: dict = {}
        self.stop = threading.Event()  # set on shutdown: ends the watcher and the reload streams

    # -- building ---------------------------------------------------------

    def _load_config(self):
        from praisonaiui.schema.loader import load_config_file
        from praisonaiui.schema.models import Config

        if self.config is None:
            data = {"site": {"title": self.project.name}, "content": {"docs": {"dir": "docs"}}}
        else:
            data = load_config_file(self.config, {})
        return Config.model_validate(data)

    def build(self) -> bool:
        """Build into a new folder; serve it if it worked. True on success."""
        from praisonaiui.cli import _static_site_app
        from praisonaiui.compiler import Compiler

        self._count += 1
        out = self.workdir / f"build-{self._count}"
        try:
            compiler = Compiler(self._load_config(), base_path=self.project, url_base=self.url_base)
            compiler.git_dates = self._git_dates
            result = compiler.compile(output_dir=out)
            if not result.success:
                raise BuildError(result.error or "The build failed.")
            app = _static_site_app(out)
        except Exception as exc:  # any failure keeps the last good build up
            shutil.rmtree(out, ignore_errors=True)
            self.error = _error_text(exc)
            return False
        previous, self.root = self.root, out
        self.build_id = f"{self._session}-{self._count}"
        self._served = (app, self.build_id)
        self.error, self.warnings = "", result.warnings
        # Keep the build before this one: a request may still be reading it.
        for old in self.workdir.glob("build-*"):
            if old not in (out, previous):
                shutil.rmtree(old, ignore_errors=True)
        return True

    def watch_paths(self) -> list[Path]:
        """The project folder, plus the docs folder when it lives outside it."""
        paths = [self.project]
        try:
            docs = (self.project / self._load_config().content.docs.dir).resolve()
            if not docs.is_relative_to(self.project) and docs.is_dir():
                paths.append(docs)
        except Exception:
            pass
        return paths

    def watch(self, report: Callable[[bool, float], None]) -> None:
        """Rebuild on every batch of file changes until :attr:`stop` is set."""
        from watchfiles import DefaultFilter, watch

        # `aiui build`'s default output folder: rebuilding it must not loop.
        ignore = DefaultFilter(ignore_paths=[str(self.project / "aiui"), str(self.workdir)])
        for _changes in watch(
            *self.watch_paths(), watch_filter=ignore, stop_event=self.stop, raise_interrupt=False
        ):
            started = time.monotonic()
            ok = self.build()
            report(ok, time.monotonic() - started)

    def close(self) -> None:
        shutil.rmtree(self.workdir, ignore_errors=True)

    # -- serving ----------------------------------------------------------

    async def events(self, poll: float = 0.2, keepalive: float = 15.0):
        """The reload stream: ``{id, error}`` now and on every change."""
        sent, quiet = None, 0.0
        yield "retry: 1000\n\n"
        while not self.stop.is_set():
            state = {"id": self.build_id, "error": self.error}
            if state != sent:
                sent, quiet = state, 0.0
                yield f"data: {json.dumps(state)}\n\n"
            elif quiet >= keepalive:
                quiet = 0.0
                yield ": ping\n\n"
            await asyncio.sleep(poll)
            quiet += poll

    async def __call__(self, scope, receive, send):
        from starlette.responses import PlainTextResponse, Response, StreamingResponse

        from praisonaiui.http_guard import configured_hosts, host_allowed

        if scope["type"] != "http":
            return
        if not host_allowed(scope, configured_hosts()):  # DNS rebinding: errors name local paths
            await PlainTextResponse("Host not allowed", status_code=400)(scope, receive, send)
            return
        if scope["path"] == EVENTS_PATH:
            response = StreamingResponse(
                self.events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"}
            )
            await response(scope, receive, send)
            return
        app, build_id = self._served
        if app is None:  # no good build yet: an empty page that shows the error and waits
            page = with_client(_WAITING_PAGE, build_id)
            await Response(page, status_code=503, media_type="text/html")(scope, receive, send)
            return
        # Uncompressed, so HTML can be patched on the way out (local: no cost).
        headers = [(k, v) for k, v in scope["headers"] if k != b"accept-encoding"]
        await app(dict(scope, headers=headers), receive, self._inject(scope, send, build_id))

    @staticmethod
    def _inject(scope, send, build_id: str):
        """Wrap *send*: a full HTML page gets the reload script for *build_id*."""
        if scope.get("method") == "HEAD":
            return send
        start: Optional[dict] = None
        chunks: list[bytes] = []

        async def wrapped(message):
            nonlocal start
            if message["type"] == "http.response.start":
                ctype = dict(message.get("headers", [])).get(b"content-type", b"")
                if message["status"] == 200 and ctype.startswith(b"text/html"):
                    start = message
                    return
            elif start is not None and message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))
                if message.get("more_body"):
                    return
                body = with_client(b"".join(chunks), build_id)
                drop = (b"content-length", b"etag", b"last-modified", b"cache-control")
                headers = [(k, v) for k, v in start["headers"] if k not in drop]
                headers += [
                    (b"content-length", str(len(body)).encode()),
                    (b"cache-control", b"no-store"),
                ]
                await send(dict(start, headers=headers))
                await send({"type": "http.response.body", "body": body})
                return
            await send(message)

        return wrapped


def run(
    config: Optional[Path],
    project: Path,
    *,
    host: str,
    port: int,
    open_browser: bool,
    url_base: Optional[str] = None,
) -> None:
    """Build, serve on *host*:*port*, watch and reload until Ctrl+C."""
    import uvicorn
    from rich.markup import escape

    from praisonaiui.cli import (
        _built_base_path,
        _find_available_port,
        _icon,
        _port_moved_message,
        console,
    )

    site = DevSite(config, project, url_base)
    shown: set[str] = set()

    def report(ok: bool, took: float) -> None:
        if not ok:
            console.print(
                f"[red]✗[/red] Build failed (still serving the last good build):\n{escape(site.error)}"
            )
            return
        for warning in site.warnings:
            if warning not in shown:
                shown.add(warning)
                console.print(f"[yellow]Warning:[/yellow] {escape(warning)}")
        console.print(f"[green]✓[/green] Built in {took:.1f}s")

    console.print(
        f"[yellow]{_icon('⏳', '...')}[/yellow] Building {escape(str(config or project / 'docs'))}..."
    )
    started = time.monotonic()
    report(site.build(), time.monotonic() - started)

    try:
        actual = _find_available_port(host, port)
    except OSError as e:
        site.close()
        console.print(f"[red]Error:[/red] {e}")
        raise SystemExit(4) from e
    if actual != port:
        console.print(_port_moved_message(host, port, actual))
    url = f"http://{host}:{actual}{_built_base_path(site.root) if site.root else ''}/"
    console.print(f"\n[green]{_icon('🚀', '>')}[/green] Preview at [link]{url}[/link]")
    console.print("[dim]Edits rebuild and reload the page. Press Ctrl+C to stop.[/dim]\n")

    threading.Thread(target=site.watch, args=(report,), daemon=True).start()
    if open_browser:
        import webbrowser

        threading.Timer(0.8, webbrowser.open, args=(url,)).start()
    server = uvicorn.Server(
        uvicorn.Config(
            site,
            host=host,
            port=actual,
            log_level="warning",
            lifespan="off",
            timeout_graceful_shutdown=2,
        )
    )
    handle_exit = server.handle_exit

    def on_exit(sig, frame) -> None:  # Ctrl+C: end the open reload streams so uvicorn can stop
        site.stop.set()
        handle_exit(sig, frame)

    server.handle_exit = on_exit
    try:
        server.run()
    finally:
        site.stop.set()
        site.close()
