"""PraisonAI Replay feature: read-only access to recorded agent runs.

Routes (contract v1, section 5):

* ``GET /api/replay/runs``                       run picker rows, newest first
* ``GET /api/replay/runs/{run_id}/events``       ``{events, graph, run}``; ``?after_seq=N``
* ``GET /api/replay/runs/{run_id}/stream``       SSE tail of the JSONL file

The trace directory is ``$PRAISONAI_TRACES_DIR``, else ``$PRAISON_HOME/traces``,
else ``~/.praison/traces``.  Run ids must match ``^[A-Za-z0-9._-]+$``.

The browser side lives in ``templates/frontend/plugins/views/replay-core.js``
(pure functions) and ``replay.js`` (DOM/SVG).  :func:`standalone_html` inlines
both into one self-contained page for ``praisonai replay export --format html``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from . import _trace_jsonl as tj
from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

#: Page id of the dashboard view; open ``/replay?run=<id>`` (or ``/#/replay?run=<id>``).
REPLAY_PAGE_ID = "replay"

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
