"""PraisonAI Replay feature: read-only access to recorded agent runs.

Routes (contract v1, section 5):

* ``GET /api/replay/runs``                       run picker rows, newest first
* ``GET /api/replay/runs/{run_id}/events``       ``{events, graph, run}``; ``?after_seq=N``;
  ``?wait=1`` answers ``{events: [], graph: null, run: null}`` (not 404) for a run
  that has not written its first event yet
* ``GET /api/replay/runs/{run_id}/stream``       SSE tail of the JSONL file

The trace directory is ``$PRAISONAI_TRACES_DIR``, else ``$PRAISON_HOME/traces``,
else ``~/.praison/traces``.  Run ids must match ``^[A-Za-z0-9._-]+$``.

The browser side lives in ``templates/frontend/plugins/views/replay-core.js``
(pure functions) and ``replay.js`` (DOM/SVG).  :func:`standalone_html` inlines
both into one self-contained page for ``praisonai replay export --format html``.

:func:`create_replay_app` is the same view as a small ASGI app (no dashboard) to
mount inside your own app, optionally with a Run box that starts runs::

    app.mount("/replay", create_replay_app(run=my_runner))
"""

from __future__ import annotations

import asyncio
import html
import inspect
import json
import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from starlette.routing import Route

from . import _trace_jsonl as tj
from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

#: Page id of the dashboard view; open ``/replay?run=<id>`` (or ``/#/replay?run=<id>``).
REPLAY_PAGE_ID = "replay"

#: Replay's own mark (three lanes and a cursor), used as the page's ``icon_svg``.
REPLAY_MARK_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="1em" height="1em" '
    'aria-hidden="true" focusable="false" '
    'style="display:inline-block;vertical-align:-0.125em">'
    '<rect x="1" y="3" width="8" height="2.2" rx="1.1" fill="currentColor"/>'
    '<rect x="3" y="7" width="10" height="2.2" rx="1.1" fill="currentColor"/>'
    '<rect x="1" y="11" width="6" height="2.2" rx="1.1" fill="currentColor"/>'
    '<rect x="11.2" y="1" width="1.6" height="14" rx="0.8" fill="currentColor" opacity="0.55"/>'
    "</svg>"
)

#: Pages a replay-only app should whitelist (Replay first, then its companions).
REPLAY_PAGES = ("replay", "approvals", "traces")

_VIEWS_DIR = Path(__file__).resolve().parent.parent / "templates" / "frontend" / "plugins" / "views"
#: Stable on-disk locations of the renderer (also served at /plugins/views/...).
REPLAY_CORE_JS = _VIEWS_DIR / "replay-core.js"
REPLAY_VIEW_JS = _VIEWS_DIR / "replay.js"


def configure_replay_app() -> None:
    """Configure aiui as a Replay-first dashboard (call before the server starts).

    Equivalent to ``aiui.set_style("dashboard")`` plus
    ``aiui.set_pages(["replay", "approvals", "traces"])``; Replay sorts first,
    so ``/`` lands on it.  Used by ``praisonaiui/replay_app.py``.
    """
    from praisonaiui.server import set_pages, set_style

    set_style("dashboard")
    set_pages(list(REPLAY_PAGES))


def _json_for_script(obj: Any) -> str:
    """JSON that is safe inside an inline ``<script>`` element."""
    text = json.dumps(obj, default=str, separators=(",", ":"))
    return (
        text.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def standalone_html(
    events: List[Dict[str, Any]],
    graph: Optional[Dict[str, Any]] = None,
    title: str = "PraisonAI Replay",
) -> str:
    """One self-contained HTML page (no CDN, no network) rendering *events*.

    Inlines ``replay-core.js`` and ``replay.js`` and sets
    ``window.__REPLAY_DATA__ = {events, graph}``; the view boots itself.
    Approval buttons are hidden because there is no server to answer them.
    """
    core = REPLAY_CORE_JS.read_text(encoding="utf-8").replace("</script", "<\\/script")
    view = REPLAY_VIEW_JS.read_text(encoding="utf-8").replace("</script", "<\\/script")
    if graph is None:
        graph = tj.find_graph(events)
    data = _json_for_script({"events": list(events), "graph": graph})
    safe_title = (
        str(title).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{safe_title}</title>\n"
        "<style>body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}</style>\n"
        "</head>\n<body>\n<main id=\"replay-root\"></main>\n"
        f"<script>window.__REPLAY_DATA__ = {data};</script>\n"
        f"<script type=\"module\">\n{core}\n</script>\n"
        f"<script type=\"module\">\n{view}\n</script>\n"
        "</body>\n</html>\n"
    )


def _bad_request(msg: str) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=400)


def _parse_after_seq(request: Request) -> tuple[Optional[int], Optional[JSONResponse]]:
    """``?after_seq=N``; an SSE reconnect's ``Last-Event-ID`` wins when it is later."""
    values = []
    for raw, strict in (
        (request.query_params.get("after_seq"), True),
        (request.headers.get("last-event-id"), False),
    ):
        if raw in (None, ""):
            continue
        try:
            values.append(int(raw))
        except (TypeError, ValueError):
            if strict:
                return None, _bad_request("after_seq must be an integer")
    return (max(values) if values else None), None


def _resolve(request: Request) -> tuple[Optional[Path], Optional[JSONResponse]]:
    run_id = request.path_params.get("run_id", "")
    path = tj.run_path(run_id)
    if path is None:
        return None, _bad_request("invalid run id (allowed: A-Z a-z 0-9 . _ -)")
    if not path.is_file():
        return None, JSONResponse({"error": "run not found"}, status_code=404)
    return path, None


def _seq_of(ev: Dict[str, Any]) -> Optional[int]:
    s = ev.get("sequence_num")
    return s if isinstance(s, int) and not isinstance(s, bool) else None


class ReplayFeature(BaseFeatureProtocol):
    """Recorded-run timeline, map and live tail (PraisonAI Replay)."""

    feature_name = "replay"
    feature_description = "Replay recorded agent runs (timeline, map, live tail)"

    # Stream timings; instance attributes so tests can shorten them.
    poll_interval = 0.25
    ping_interval = 15.0
    quiet_period = 2.0

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/replay/runs", self._runs, methods=["GET"]),
            Route("/api/replay/runs/{run_id}/events", self._events, methods=["GET"]),
            Route("/api/replay/runs/{run_id}/stream", self._stream, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        d = tj.traces_dir()
        return {
            "status": "ok",
            "feature": self.name,
            "traces_dir": str(d),
            "runs": len(tj.list_run_files(d)),
        }

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "replay",
                "help": "List recorded runs (PraisonAI Replay)",
                "commands": {"list": {"help": "List recorded runs", "handler": self._cli_list}},
            }
        ]

    # ── data ──────────────────────────────────────────────────────────

    @staticmethod
    def list_runs(limit: int = 200) -> List[Dict[str, Any]]:
        rows = []
        now = time.time()
        for path in tj.list_run_files()[: max(1, limit)]:
            row = tj.summarize_run(path, now=now)
            if row is not None:
                rows.append(row)
        rows.sort(key=lambda r: (r.get("started_at") or 0.0, r["run_id"]), reverse=True)
        return rows

    def _cli_list(self) -> str:
        rows = self.list_runs()
        if not rows:
            return f"No recorded runs in {tj.traces_dir()}"
        lines = [f"Runs ({len(rows)}):"]
        for r in rows:
            live = " LIVE" if r.get("live") else ""
            lines.append(
                f"  {r['run_id']}  {r.get('name')}  {r['status']}{live}  "
                f"events={r['events']}  ${r['cost_usd']:.4f}"
            )
        return "\n".join(lines)

    # ── handlers ──────────────────────────────────────────────────────

    async def _runs(self, request: Request) -> JSONResponse:
        try:
            limit = int(request.query_params.get("limit", "200"))
        except ValueError:
            return _bad_request("limit must be an integer")
        rows = await run_in_threadpool(self.list_runs, limit)
        return JSONResponse(rows)

    async def _events(self, request: Request) -> JSONResponse:
        path, err = _resolve(request)
        if err is not None:
            if err.status_code == 404 and request.query_params.get("wait") == "1":
                return JSONResponse({"events": [], "graph": None, "run": None})
            return err
        after_seq, err = _parse_after_seq(request)
        if err is not None:
            return err

        def load() -> Dict[str, Any]:
            all_events = tj.read_events(path)
            events = all_events if after_seq is None else tj.read_events(path, after_seq)
            return {
                "events": events,
                "graph": tj.find_graph(all_events),
                "run": tj.summarize_run(path),
            }

        return JSONResponse(await run_in_threadpool(load))

    async def _stream(self, request: Request) -> StreamingResponse:
        path, err = _resolve(request)
        if err is not None:
            return err  # type: ignore[return-value]
        after_seq, err = _parse_after_seq(request)
        if err is not None:
            return err  # type: ignore[return-value]

        poll, ping, quiet = self.poll_interval, self.ping_interval, self.quiet_period

        async def gen():
            tail = tj.TailReader(path)
            tracker = tj.EndTracker()
            last_seq = after_seq
            loop = asyncio.get_running_loop()
            last_activity = last_ping = loop.time()
            yield "retry: 3000\n\n"
            while True:
                events = await run_in_threadpool(tail.poll)
                now = loop.time()
                if events:
                    last_activity = now
                for ev in events:
                    tracker.feed(ev)
                    seq = _seq_of(ev)
                    if last_seq is not None and seq is not None and seq <= last_seq:
                        continue
                    if seq is not None:
                        last_seq = seq
                    sid = f"id: {seq}\n" if seq is not None else ""
                    yield f"{sid}event: ctx\ndata: {json.dumps(ev, default=str)}\n\n"
                idle = now - last_activity
                if tracker.ended and idle >= quiet:
                    yield "event: end\ndata: {}\n\n"
                    return
                if not path.exists() or idle >= tj.LIVE_WINDOW_S:
                    yield 'event: end\ndata: {"reason": "stale"}\n\n'
                    return
                if now - last_ping >= ping:
                    last_ping = now
                    yield "event: ping\ndata: {}\n\n"
                await asyncio.sleep(poll)

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )


# ── embeddable app ─────────────────────────────────────────────────────

#: Longest input the Run box accepts (characters).
MAX_RUN_INPUT = 20_000


def _embed_page(base: str, title: str, cfg: Dict[str, Any]) -> str:
    """The page at the app's root: the view, mounted with *cfg*, and nothing else."""
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{html.escape(title)}</title>\n"
        f"<link rel=\"icon\" href=\"data:image/svg+xml,{quote(REPLAY_MARK_SVG.replace('currentColor', '#1A56DB'))}\">\n"
        "<style>body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}"
        "#replay-root{padding:12px;box-sizing:border-box;max-width:100%}</style>\n"
        "</head>\n<body>\n<main id=\"replay-root\"></main>\n"
        "<script type=\"module\">\n"
        f"import {{ render }} from {_json_for_script(base + '/replay.js')};\n"
        f"render(document.getElementById('replay-root'), {_json_for_script(cfg)});\n"
        "</script>\n</body>\n</html>\n"
    )


def create_replay_app(
    run: Optional[Callable[[str, str], Any]] = None,
    *,
    title: str = "PraisonAI Replay",
    input: Optional[str] = "",
    placeholder: str = "",
):
    """PraisonAI Replay as a small ASGI app to mount in your own app.

    Serves the view at ``/`` (no dashboard around it), its two scripts, and the
    ``/api/replay/...`` routes, all relative to where it is mounted::

        from fastapi import FastAPI
        from praisonaiui.features.replay import create_replay_app

        app = FastAPI()
        app.mount("/replay", create_replay_app())
        # <iframe src="/replay/?run=RUN_ID"> shows one run live; /replay/ lists runs

    Args:
        run: Optional ``run(input, run_id)``. When given, the page shows an
            input box and a **Run** button; each click calls it in a worker
            thread with a new ``run_id``, and the page follows that run live.
            It must record the run under ``run_id`` (``praisonai.replay.app()``
            does this for an agent, team or flow). One run at a time.
        title: Page title.
        input: Text the input box starts with; ``None`` for no input box
            (just a Run button, e.g. for a YAML file that has its own topic).
        placeholder: Placeholder text for the input box.

    Traces are read from the same folder as the rest of Replay
    (``$PRAISONAI_TRACES_DIR`` > ``$PRAISON_HOME/traces`` > ``~/.praison/traces``).
    Anyone who can reach the app can read the runs (and, with ``run``, start
    them): keep it on localhost or behind your app's auth.
    """
    from starlette.applications import Starlette

    feature = ReplayFeature()
    busy = threading.Lock()

    async def page(request: Request) -> HTMLResponse:
        base = str(request.scope.get("root_path", "")).rstrip("/")
        cfg: Dict[str, Any] = {"base": base, "approve": False}
        wanted = request.query_params.get("run")
        if wanted and tj.is_valid_run_id(wanted):
            cfg["run"] = wanted
        if run is not None:
            cfg["runner"] = {"input": input or "", "placeholder": placeholder, "ask": input is not None}
        return HTMLResponse(_embed_page(base, title, cfg), headers={"Cache-Control": "no-store"})

    def script(path: Path):
        async def serve(request: Request) -> FileResponse:
            return FileResponse(path, media_type="text/javascript", headers={"Cache-Control": "no-cache"})
        return serve

    def _call(text: str, run_id: str) -> None:
        try:
            result = run(text, run_id)  # type: ignore[misc]
            if inspect.isawaitable(result):
                asyncio.run(result)
        except Exception:
            logger.exception("replay run %s failed", run_id)
        finally:
            busy.release()

    async def start(request: Request) -> JSONResponse:
        # JSON only: a cross-site form post cannot set this content type without
        # a CORS preflight, which this app never answers.
        if not request.headers.get("content-type", "").lower().startswith("application/json"):
            return JSONResponse({"error": "send JSON: {\"input\": \"...\"}"}, status_code=415)
        try:
            body = await request.json()
        except ValueError:
            return _bad_request("body must be JSON")
        text = body.get("input", "") if isinstance(body, dict) else None
        if not isinstance(text, str) or len(text) > MAX_RUN_INPUT:
            return _bad_request(f"input must be a string of at most {MAX_RUN_INPUT} characters")
        if not busy.acquire(blocking=False):
            return JSONResponse({"error": "a run is already going; wait for it to finish"}, status_code=409)
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        try:
            threading.Thread(target=_call, args=(text, run_id), name=f"replay-{run_id}", daemon=True).start()
        except Exception:
            busy.release()
            raise
        # Answer once the trace file exists (usually milliseconds), so the page
        # can open the run straight away; it waits on its own if this times out.
        path = tj.run_path(run_id)
        for _ in range(40):
            if path is not None and path.is_file():
                break
            await asyncio.sleep(0.05)
        return JSONResponse({"run_id": run_id})

    routes = [
        Route("/", page, methods=["GET"]),
        Route("/replay.js", script(REPLAY_VIEW_JS), methods=["GET"]),
        Route("/replay-core.js", script(REPLAY_CORE_JS), methods=["GET"]),
        *feature.routes(),
    ]
    if run is not None:
        routes.append(Route("/api/replay/run", start, methods=["POST"]))
    return Starlette(routes=routes)
