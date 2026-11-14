"""Run ledger: one record per chat run, for the layouts that show runs.

The ledger watches the chat event stream (``chat.add_event_observer``) and
keeps, for every run: its session, agent, start and end, status, steps, and
the tokens and cost of the usage records tagged with its run id. Nothing new
goes on the wire: clients read it after ``run_completed``.

Owned by the ``builtin.run-ledger`` record, which mounts only while a layout
that needs it (command, mission) is available or the record is listed in
``extensions.enabled`` (ADR 0003). Routes::

    GET /api/runs?after=&agent=&session_id=&limit=   recent runs, newest first
    GET /api/runs/{run_id}                            one run with its steps

Shapes follow ``RunSummary`` and ``RunDetail``
in ``src/frontend/src/sdk/layoutTypes.ts`` (camelCase, epoch milliseconds).

Tokens and cost come from ``usage.track_usage(..., run_id=...)``. A usage
record without a run id (a provider that does not tag its records) is joined
by session and time window instead, and the run says ``approximate: true``.

Finished runs are kept in memory (the newest ``RING_SIZE``) and appended to
``<data dir>/runs/ledger.jsonl``. The append happens on one writer thread, in
order, so the chat broadcast path never waits on the disk.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

#: Finished runs kept in memory (and read back from disk at start).
RING_SIZE = 1000
#: Steps kept per run; later steps still count in ``stepCount``.
MAX_STEPS = 200
#: Usage tracked this long after a run's last event still belongs to it (the
#: time-window join for records without a run id).
WINDOW_GRACE_S = 5.0
LEDGER_FILE = "ledger.jsonl"
_TERMINAL = {"completed", "failed", "cancelled"}


def ledger_dir() -> Path:
    """``<data dir>/runs`` (resolved per call, so it follows the environment)."""
    from ._paths import aiui_default_data_dir, feature_data_path

    return feature_data_path("runs", aiui_default_data_dir() / "runs")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _text(value: Any, limit: int = 200) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s[:limit] if s else None


class RunLedger:
    """The runs seen in this process, fed by chat events."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._live: Dict[str, Dict[str, Any]] = {}
        self._done: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self._loaded = False
        self._file_lock = threading.Lock()
        self._writer: Optional[ThreadPoolExecutor] = None
        self._last_write: Optional["Future[None]"] = None

    # ── events ───────────────────────────────────────────────────────

    def observe(self, session_id: str, event: Dict[str, Any]) -> None:
        """Chat event observer: update the run the event belongs to."""
        run_id = event.get("run_id")
        etype = event.get("type")
        if not isinstance(run_id, str) or not run_id or not isinstance(etype, str):
            return
        with self._lock:
            if etype == "run_closed":
                self._close(run_id, event)
                return
            run = self._live.get(run_id)
            if run is None:
                if run_id in self._done:
                    return  # a late frame of a finished run
                run = self._start(run_id, session_id or event.get("session_id"))
            self._apply(run, etype, event, _now_ms())

    def _start(self, run_id: str, session_id: Optional[str]) -> Dict[str, Any]:
        run: Dict[str, Any] = {
            "id": run_id,
            "sessionId": session_id or None,
            "agent": None,
            "startedAt": _now_ms(),
            "status": "running",
            "steps": [],
            "stepCount": 0,
        }
        self._live[run_id] = run
        if len(self._live) > RING_SIZE:  # runs whose close never arrived
            oldest = min(self._live.values(), key=lambda r: r["startedAt"])
            self._finish(oldest)
        return run

    def _apply(self, run: Dict[str, Any], etype: str, ev: Dict[str, Any], now: int) -> None:
        agent = _text(ev.get("agent_name"))
        if etype == "run_started":
            if agent and run["agent"] and agent != run["agent"]:
                self._end_open(run, now)
                self._add_step(run, "handoff", f"Handed off to {agent}", now, status="done")
            if agent:
                run["agent"] = agent
            return
        if agent and not run["agent"]:
            run["agent"] = agent
        if etype in ("run_completed", "run_error", "run_cancelled"):
            run["status"] = {
                "run_completed": "completed",
                "run_error": "failed",
                "run_cancelled": "cancelled",
            }[etype]
            if etype == "run_error":
                run["error"] = _text(ev.get("error"), 500)
            run["endedAt"] = now
            self._end_open(run, now, failed=etype == "run_error")
            return
        if run["status"] == "waiting" and etype != "run_paused":
            run["status"] = "running"  # the gate was answered
            self._end_open(run, now, kinds=("approval",))
        if etype == "reasoning_started":
            self._end_open(run, now, kinds=("text",))
            self._add_step(run, "reasoning", "Thinking", now)
        elif etype == "reasoning_completed":
            self._end_open(run, now, kinds=("reasoning",))
        elif etype == "tool_call_started":
            self._tool_started(run, ev, now)
        elif etype == "tool_call_completed":
            self._tool_completed(run, ev, now)
        elif etype == "run_paused":
            self._end_open(run, now, kinds=("text",))
            run["status"] = "waiting"
            if ev.get("pause_type") == "approval_required":
                tool = _text(ev.get("tool_name")) or "a tool"
                label = f"Waiting for approval: {tool}"
            else:
                label = "Waiting for your answer"
            self._add_step(run, "approval", label, now, status="waiting")
        elif etype == "run_content" and ev.get("token"):
            if not self._open(run, "text"):
                self._add_step(run, "text", "Writing the answer", now)

    def _tool_started(self, run: Dict[str, Any], ev: Dict[str, Any], now: int) -> None:
        name = _text(ev.get("name")) or "tool"
        label = _text(ev.get("description")) or _text(ev.get("label")) or f"Using {name}"
        tc_id = _text(ev.get("tool_call_id"))
        existing = self._find(run, tc_id)
        if existing is not None:  # the same call again, with complete args
            existing["label"] = label
            return
        self._end_open(run, now, kinds=("text", "reasoning"))
        self._add_step(run, "tool", label, now, step_id=tc_id, tool_name=name)

    def _tool_completed(self, run: Dict[str, Any], ev: Dict[str, Any], now: int) -> None:
        name = _text(ev.get("name"))
        step = self._find(run, _text(ev.get("tool_call_id")))
        if step is None and name:
            step = next(
                (
                    s
                    for s in reversed(run["steps"])
                    if s["kind"] == "tool" and s.get("toolName") == name and s["status"] == "running"
                ),
                None,
            )
        if step is None:
            self._add_step(
                run, "tool", f"Using {name or 'tool'}", now,
                step_id=_text(ev.get("tool_call_id")), tool_name=name,
            )  # fmt: skip
            step = run["steps"][-1] if run["steps"] else None
        if step is not None and step["status"] == "running":
            step["status"] = "done"
            step["endedAt"] = now

    @staticmethod
    def _find(run: Dict[str, Any], step_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not step_id:
            return None
        return next((s for s in run["steps"] if s["id"] == step_id), None)

    @staticmethod
    def _open(run: Dict[str, Any], kind: str) -> bool:
        return any(s["kind"] == kind and s["status"] == "running" for s in run["steps"])

    @staticmethod
    def _add_step(
        run: Dict[str, Any],
        kind: str,
        label: str,
        now: int,
        *,
        status: str = "running",
        step_id: Optional[str] = None,
        tool_name: Optional[str] = None,
    ) -> None:
        run["stepCount"] += 1
        if len(run["steps"]) >= MAX_STEPS:
            return
        step: Dict[str, Any] = {
            "id": step_id or f"{kind}-{run['stepCount']}",
            "kind": kind,
            "label": label,
            "startedAt": now,
            "status": status,
        }
        if status == "done":
            step["endedAt"] = now
        if tool_name:
            step["toolName"] = tool_name
        run["steps"].append(step)

    @staticmethod
    def _end_open(
        run: Dict[str, Any], now: int, *, kinds: Iterable[str] = (), failed: bool = False
    ) -> None:
        wanted = set(kinds)
        for s in run["steps"]:
            if s["status"] in ("running", "waiting") and (not wanted or s["kind"] in wanted):
                s["status"] = "error" if failed and s["kind"] == "tool" else "done"
                s["endedAt"] = now

    def _close(self, run_id: str, ev: Dict[str, Any]) -> None:
        run = self._live.get(run_id)
        if run is None:
            return
        if run["status"] not in _TERMINAL:
            status = ev.get("status")
            run["status"] = status if status in _TERMINAL else "completed"
        if "endedAt" not in run:
            run["endedAt"] = _now_ms()
            self._end_open(run, run["endedAt"])
        self._finish(run)

    def _finish(self, run: Dict[str, Any]) -> None:
        """Move a run to the finished ring with its usage, and append it to disk."""
        self._live.pop(run["id"], None)
        run.update(_usage_totals(run, _UsageIndex.build(run["startedAt"])))
        self._remember(run)
        self._persist(json.dumps(run, separators=(",", ":")))

    def _remember(self, run: Dict[str, Any]) -> None:
        self._done[run["id"]] = run
        self._done.move_to_end(run["id"])
        while len(self._done) > RING_SIZE:
            self._done.popitem(last=False)

    # ── disk ─────────────────────────────────────────────────────────

    def _persist(self, line: str) -> None:
        """Append *line* to the ledger file, off the event loop.

        A run finishes inside ``ChatManager.broadcast`` (the observer), on the
        event loop: there the write is queued to one writer thread, so lines
        keep their order and the loop never blocks on the disk. Without a
        running loop (a script, a test) it is written right away.
        """
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            self._append(line)
            return
        if self._writer is None:
            self._writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="aiui-run-ledger")
        self._last_write = self._writer.submit(self._append, line)

    def flush(self, timeout: Optional[float] = None) -> None:
        """Wait until every queued append is on disk."""
        last = self._last_write
        if last is not None:
            last.result(timeout)

    def close(self) -> None:
        """Finish the queued appends and stop the writer thread."""
        writer, self._writer = self._writer, None
        if writer is not None:
            writer.shutdown(wait=True)

    def _append(self, line: str) -> None:
        try:
            path = ledger_dir() / LEDGER_FILE
            with self._file_lock:
                path.parent.mkdir(parents=True, exist_ok=True)
                with open(path, "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
        except OSError as exc:
            logger.warning("Run ledger: could not write %s: %s", LEDGER_FILE, exc)

    def ensure_loaded(self) -> None:
        """Read the finished runs back from disk once (call it off the event loop)."""
        if self._loaded:
            return
        path = ledger_dir() / LEDGER_FILE
        loaded: List[Dict[str, Any]] = []
        try:
            with self._file_lock, open(path, encoding="utf-8") as fh:
                lines = fh.readlines()
        except FileNotFoundError:
            lines = []
        except OSError as exc:
            logger.warning("Run ledger: could not read %s: %s", path, exc)
            lines = []
        for line in lines[-RING_SIZE:]:
            try:
                rec = json.loads(line)
            except ValueError:
                continue  # a torn last line
            if isinstance(rec, dict) and isinstance(rec.get("id"), str):
                loaded.append(rec)
        if len(lines) > 2 * RING_SIZE:
            self._compact(path, lines[-RING_SIZE:])
        with self._lock:
            if self._loaded:
                return
            kept = self._done
            self._done = OrderedDict()
            for rec in loaded:
                self._remember(rec)
            for rec in kept.values():  # runs finished in this process win
                self._remember(rec)
            self._loaded = True

    def _compact(self, path: Path, lines: List[str]) -> None:
        tmp = path.with_suffix(".jsonl.tmp")
        try:
            with self._file_lock:
                tmp.write_text("".join(lines), encoding="utf-8")
                tmp.replace(path)
        except OSError as exc:
            logger.warning("Run ledger: could not compact %s: %s", path, exc)

    # ── queries ──────────────────────────────────────────────────────

    def _all(self) -> List[Dict[str, Any]]:
        with self._lock:
            runs = [*self._done.values(), *self._live.values()]
        return [json.loads(json.dumps(r)) for r in runs]  # detached copies

    def runs(self) -> List[Dict[str, Any]]:
        """Every run (finished and live) with current usage, newest first."""
        runs = self._all()
        if runs:
            index = _UsageIndex.build(min(r["startedAt"] for r in runs))
            for r in runs:
                r.update(_usage_totals(r, index, fallback=r))
        runs.sort(key=lambda r: r["startedAt"], reverse=True)
        return runs

    def run(self, run_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            found = self._live.get(run_id) or self._done.get(run_id)
            run = json.loads(json.dumps(found)) if found else None
        if run is None:
            return None
        run.update(_usage_totals(run, _UsageIndex.build(run["startedAt"]), fallback=run))
        return run

    def recent(
        self,
        *,
        after: Optional[str] = None,
        agent: Optional[str] = None,
        session_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        runs = self.runs()
        if after:
            pivot = next((r for r in runs if r["id"] == after), None)
            if pivot is not None:
                runs = [r for r in runs if r["startedAt"] > pivot["startedAt"]]
        if agent:
            runs = [r for r in runs if r.get("agent") == agent]
        if session_id:
            runs = [r for r in runs if r.get("sessionId") == session_id]
        return [_summary(r) for r in runs[:limit]]

    def stats(self) -> Dict[str, int]:
        with self._lock:
            return {"live_runs": len(self._live), "runs_cached": len(self._done)}


# ── usage join ───────────────────────────────────────────────────────


class _UsageIndex:
    """Usage records grouped by run id, and the untagged ones by session."""

    def __init__(self, records: List[Dict[str, Any]]) -> None:
        self.by_run: Dict[str, List[Dict[str, Any]]] = {}
        self.untagged: Dict[str, List[Dict[str, Any]]] = {}
        for rec in records:
            rid = rec.get("run_id")
            if rid:
                self.by_run.setdefault(str(rid), []).append(rec)
            else:
                self.untagged.setdefault(str(rec.get("session_id")), []).append(rec)

    @classmethod
    def build(cls, since_ms: int) -> "_UsageIndex":
        from .usage import get_usage_records

        return cls(get_usage_records(since=since_ms / 1000 - 1))


def _usage_totals(
    run: Dict[str, Any], index: _UsageIndex, fallback: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Tokens, cost and model of *run* from the usage records.

    By run id first; else untagged records of the run's session inside its
    time window (``approximate``); else what *fallback* already holds (a run
    run read back from disk whose records left the usage ring).
    """
    records = index.by_run.get(run["id"], [])
    approximate = False
    if not records and run.get("sessionId"):
        start = run["startedAt"] / 1000
        end = (run.get("endedAt") or _now_ms()) / 1000 + WINDOW_GRACE_S
        records = [
            r
            for r in index.untagged.get(str(run["sessionId"]), [])
            if start <= float(r.get("timestamp", 0)) <= end
        ]
        approximate = bool(records)
    if not records:
        keys = ("tokens", "tokensIn", "tokensOut", "cost", "model", "approximate")
        return {k: fallback[k] for k in keys if fallback and k in fallback}
    out: Dict[str, Any] = {
        "tokensIn": sum(int(r.get("input_tokens") or 0) for r in records),
        "tokensOut": sum(int(r.get("output_tokens") or 0) for r in records),
        "cost": round(sum(float(r.get("cost") or 0.0) for r in records), 6),
    }
    out["tokens"] = out["tokensIn"] + out["tokensOut"]
    model = records[-1].get("model")
    if model and model != "unknown":
        out["model"] = str(model)
    out["approximate"] = approximate
    return out


def _summary(run: Dict[str, Any]) -> Dict[str, Any]:
    keys = (
        "id", "sessionId", "agent", "startedAt", "endedAt", "status",
        "stepCount", "tokens", "cost", "approximate",
    )  # fmt: skip
    return {k: run[k] for k in keys if run.get(k) is not None}


# ── singleton ────────────────────────────────────────────────────────

_ledger: Optional[RunLedger] = None
_ledger_lock = threading.Lock()


def get_run_ledger() -> RunLedger:
    """The process ledger, observing chat events from its first use."""
    global _ledger
    with _ledger_lock:
        if _ledger is None:
            from .chat import add_event_observer

            _ledger = RunLedger()
            add_event_observer(_ledger.observe)
        return _ledger


def reset_run_ledger() -> None:
    """Forget every run and stop observing (tests)."""
    global _ledger
    with _ledger_lock:
        if _ledger is not None:
            from .chat import _event_observers

            if _ledger.observe in _event_observers:
                _event_observers.remove(_ledger.observe)
            _ledger.close()
        _ledger = None


# ── feature ──────────────────────────────────────────────────────────


def _int_param(request: Request, name: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(request.query_params.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(lo, min(hi, value))


class RunLedgerFeature(BaseFeatureProtocol):
    """Per-run steps, tokens and cost."""

    feature_name = "run_ledger"
    feature_description = "Per-run steps, tokens and cost"

    def __init__(self) -> None:
        self._ledger = get_run_ledger()

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/runs", self._list, methods=["GET"]),
            Route("/api/runs/{run_id}", self._get, methods=["GET"]),
        ]

    async def health(self) -> Dict[str, Any]:
        return {"status": "ok", "feature": self.name, **self._ledger.stats()}

    async def _ready(self) -> RunLedger:
        ledger = get_run_ledger()
        if not ledger._loaded:
            await asyncio.to_thread(ledger.ensure_loaded)
        return ledger

    async def _list(self, request: Request) -> JSONResponse:
        ledger = await self._ready()
        q = request.query_params
        runs = ledger.recent(
            after=q.get("after") or None,
            agent=q.get("agent") or None,
            session_id=q.get("session_id") or None,
            limit=_int_param(request, "limit", 50, 1, 500),
        )
        return JSONResponse({"runs": runs, "count": len(runs)})

    async def _get(self, request: Request) -> JSONResponse:
        ledger = await self._ready()
        run = ledger.run(request.path_params["run_id"])
        if run is None:
            return JSONResponse({"error": "run not found"}, status_code=404)
        return JSONResponse(run)
