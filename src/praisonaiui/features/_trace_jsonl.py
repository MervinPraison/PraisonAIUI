"""Stdlib reader for PraisonAI context-trace JSONL files (Replay contract v1, section 1).

One file per run at ``<traces dir>/<run_or_session_id>.jsonl``; one JSON object
(``ContextEvent.to_dict()``) per line, in append order.  Readers must tolerate:

* a partially written last line (it is skipped until it is complete);
* unknown fields and unknown ``event_type`` values (passed through untouched);
* schema 1.0 files (no ``run_id`` / ``parent_seq`` / ``node_id``).

Shared by the ``replay`` feature (runs, events, SSE tail) and the ``tracing``
feature (spans from start/end pairs).  No third-party imports.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

__all__ = [
    "RUN_ID_RE",
    "LIVE_WINDOW_S",
    "traces_dir",
    "is_valid_run_id",
    "run_path",
    "list_run_files",
    "read_events",
    "TailReader",
    "EndTracker",
    "find_graph",
    "summarize_run",
    "build_spans",
]

#: Allowed run ids: one path segment, no separators (path-traversal safe).
RUN_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")

#: A run without an end marker counts as live while its file changed this recently.
LIVE_WINDOW_S = 15 * 60

#: start event type -> the end event type that closes it.
START_END: Dict[str, str] = {
    "session_start": "session_end",
    "workflow_start": "workflow_end",
    "task_start": "task_end",
    "step_start": "step_end",
    "agent_start": "agent_end",
    "tool_call_start": "tool_call_end",
    "llm_request": "llm_response",
    "approval_requested": "approval_decided",
}
END_START: Dict[str, str] = {v: k for k, v in START_END.items()}

_SPAN_KIND = {
    "session_start": "session",
    "workflow_start": "workflow",
    "task_start": "task",
    "step_start": "step",
    "agent_start": "agent",
    "tool_call_start": "tool",
    "llm_request": "llm",
    "approval_requested": "approval",
}


# ── Location ──────────────────────────────────────────────────────────


def traces_dir() -> Path:
    """Resolve the traces directory.

    Precedence: ``$PRAISONAI_TRACES_DIR`` > ``$PRAISON_HOME/traces`` > ``~/.praison/traces``.
    Never creates the directory (this module is read-only).
    """
    override = os.environ.get("PRAISONAI_TRACES_DIR")
    if override:
        return Path(override).expanduser()
    home = os.environ.get("PRAISON_HOME")
    base = Path(home).expanduser() if home else Path.home() / ".praison"
    return base / "traces"


def is_valid_run_id(run_id: Any) -> bool:
    """True when *run_id* is a single safe path segment."""
    return (
        isinstance(run_id, str)
        and 0 < len(run_id) <= 200
        and run_id not in (".", "..")
        and bool(RUN_ID_RE.match(run_id))
    )


def run_path(run_id: str, directory: Optional[Path] = None) -> Optional[Path]:
    """Return the JSONL path for *run_id*, or ``None`` when the id is unsafe.

    The resolved path is additionally checked to sit directly inside the
    traces directory, so a symlinked or odd id can never escape it.
    """
    if not is_valid_run_id(run_id):
        return None
    base = directory or traces_dir()
    candidate = base / f"{run_id}.jsonl"
    try:
        if candidate.resolve().parent != base.resolve():
            return None
    except OSError:
        return None
    return candidate


def list_run_files(directory: Optional[Path] = None) -> List[Path]:
    """All ``*.jsonl`` files with a valid id, newest (mtime) first."""
    base = directory or traces_dir()
    if not base.is_dir():
        return []
    items: List[Tuple[float, Path]] = []
    for p in base.iterdir():
        if p.suffix != ".jsonl" or not is_valid_run_id(p.stem):
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        if p.is_file():
            items.append((st.st_mtime, p))
    items.sort(key=lambda it: (it[0], it[1].name), reverse=True)
    return [p for _, p in items]


# ── Reading ───────────────────────────────────────────────────────────


def _parse_line(raw: bytes) -> Optional[Dict[str, Any]]:
    raw = raw.strip()
    if not raw:
        return None
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


class TailReader:
    """Incrementally read complete JSON lines from a growing file.

    Keeps a byte offset; each :meth:`poll` returns only events whose line is
    complete.  A trailing fragment without a newline is consumed only when it
    already parses as a JSON object (a proper prefix of a JSON object never
    does), so a half-written line is never surfaced.  If the file shrinks
    (the writer truncates on restart), reading restarts from the top.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.offset = 0

    def poll(self) -> List[Dict[str, Any]]:
        try:
            size = self.path.stat().st_size
        except OSError:
            return []
        if size < self.offset:
            self.offset = 0
        if size == self.offset:
            return []
        try:
            with open(self.path, "rb") as fh:
                fh.seek(self.offset)
                chunk = fh.read(size - self.offset)
        except OSError:
            return []
        events: List[Dict[str, Any]] = []
        consumed = 0
        start = 0
        while True:
            nl = chunk.find(b"\n", start)
            if nl < 0:
                break
            ev = _parse_line(chunk[start:nl])
            if ev is not None:
                events.append(ev)
            start = nl + 1
            consumed = start
        tail = chunk[start:]
        if tail.strip():
            ev = _parse_line(tail)
            if ev is not None:  # complete object, newline not written yet
                events.append(ev)
                consumed = len(chunk)
        self.offset += consumed
        return events


_CACHE_LOCK = threading.Lock()
_EVENT_CACHE: Dict[str, Tuple[Tuple[int, int], List[Dict[str, Any]]]] = {}
_SUMMARY_CACHE: Dict[str, Tuple[Tuple[int, int, int], Dict[str, Any]]] = {}
_EVENT_CACHE_MAX = 8
_SUMMARY_CACHE_MAX = 512


def _sig(path: Path) -> Optional[Tuple[int, int]]:
    try:
        st = path.stat()
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def _seq(ev: Dict[str, Any], default: int = -1) -> int:
    s = ev.get("sequence_num")
    return s if isinstance(s, int) and not isinstance(s, bool) else default


def read_events(path: Path, after_seq: Optional[int] = None) -> List[Dict[str, Any]]:
    """All complete events in *path* (append order), optionally ``sequence_num > after_seq``."""
    path = Path(path)
    sig = _sig(path)
    if sig is None:
        return []
    key = str(path)
    with _CACHE_LOCK:
        hit = _EVENT_CACHE.get(key)
    if hit and hit[0] == sig:
        events = hit[1]
    else:
        events = TailReader(path).poll()
        with _CACHE_LOCK:
            _EVENT_CACHE.pop(key, None)
            _EVENT_CACHE[key] = (sig, events)
            while len(_EVENT_CACHE) > _EVENT_CACHE_MAX:
                _EVENT_CACHE.pop(next(iter(_EVENT_CACHE)))
    if after_seq is None:
        return list(events)
    return [ev for ev in events if _seq(ev) > after_seq]


# ── Interpretation ────────────────────────────────────────────────────


class EndTracker:
    """Decide when a run has finished, feeding events one at a time.

    The outermost scope is the first ``session_start`` or, failing that, the
    first top-level ``workflow_start``.  The run has ended once that scope's
    end event arrives (``session_end`` always ends it).
    """

    def __init__(self) -> None:
        self.outer: Optional[Tuple[str, int]] = None
        self.first_workflow: Optional[int] = None
        self.ended = False
        self.status: Optional[str] = None
        self.ended_at: Optional[float] = None

    def feed(self, ev: Dict[str, Any]) -> None:
        et = ev.get("event_type")
        seq = _seq(ev)
        if et == "session_start" and self.outer is None:
            self.outer = ("session", seq)
        elif et == "workflow_start":
            if self.first_workflow is None:
                self.first_workflow = seq
            if self.outer is None and ev.get("parent_seq") is None:
                self.outer = ("workflow", seq)
        elif et == "workflow_end":
            data = ev.get("data") or {}
            ps = ev.get("parent_seq")
            if ps is None or ps == self.first_workflow:
                if isinstance(data, dict) and data.get("status"):
                    self.status = str(data["status"])
            if self.outer is None or (self.outer[0] == "workflow" and ps in (None, self.outer[1])):
                self._end(ev)
        elif et == "session_end":
            self._end(ev)

    def _end(self, ev: Dict[str, Any]) -> None:
        self.ended = True
        ts = ev.get("timestamp")
        if isinstance(ts, (int, float)):
            self.ended_at = float(ts)


def find_graph(events: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The graph from the first ``workflow_start`` carrying one, else ``None``."""
    for ev in events:
        if ev.get("event_type") == "workflow_start":
            data = ev.get("data")
            if isinstance(data, dict) and isinstance(data.get("graph"), dict):
                return data["graph"]
    return None


def _num(v: Any) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def summarize_run(path: Path, now: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Run-picker row for one trace file (cached on mtime/size)."""
    path = Path(path)
    try:
        st = path.stat()
    except OSError:
        return None
    now = time.time() if now is None else now
    sig = (st.st_mtime_ns, st.st_size, int(now - st.st_mtime < LIVE_WINDOW_S))
    key = str(path)
    with _CACHE_LOCK:
        hit = _SUMMARY_CACHE.get(key)
    if hit and hit[0] == sig:
        return dict(hit[1])

    events = read_events(path)
    tracker = EndTracker()
    agents: List[str] = []
    cost = 0.0
    session_id = None
    event_run_id = None
    started_at = None
    kind, name, process = "session", None, None
    schema = None
    for ev in events:
        tracker.feed(ev)
        if session_id is None and ev.get("session_id"):
            session_id = ev.get("session_id")
        if event_run_id is None and ev.get("run_id"):
            event_run_id = ev.get("run_id")
        if schema is None and ev.get("schema_version"):
            schema = str(ev.get("schema_version"))
        ts = ev.get("timestamp")
        if started_at is None and isinstance(ts, (int, float)):
            started_at = float(ts)
        agent = ev.get("agent_name")
        if isinstance(agent, str) and agent and agent not in agents:
            agents.append(agent)
        cost += _num(ev.get("cost_usd"))
        if ev.get("event_type") == "workflow_start" and name is None:
            data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
            kind = str(data.get("kind") or "workflow")
            name = data.get("name")
            process = data.get("process")
    live = (not tracker.ended) and (now - st.st_mtime) < LIVE_WINDOW_S
    if tracker.ended:
        status = tracker.status or "completed"
    else:
        status = "running" if live else "incomplete"
    summary: Dict[str, Any] = {
        "run_id": path.stem,
        "session_id": session_id,
        "path": str(path),
        "started_at": started_at,
        "status": status,
        "kind": kind,
        "name": name or (agents[0] if agents else path.stem),
        "agents": agents,
        "events": len(events),
        "cost_usd": round(cost, 6),
        "live": live,
        "schema_version": schema,
    }
    if tracker.ended_at is not None:
        summary["ended_at"] = tracker.ended_at
    if process:
        summary["process"] = process
    if event_run_id and event_run_id != path.stem:
        summary["event_run_id"] = event_run_id
    with _CACHE_LOCK:
        _SUMMARY_CACHE[key] = (sig, summary)
        while len(_SUMMARY_CACHE) > _SUMMARY_CACHE_MAX:
            _SUMMARY_CACHE.pop(next(iter(_SUMMARY_CACHE)))
    return dict(summary)


def _span_name(ev: Dict[str, Any]) -> str:
    et = ev.get("event_type")
    data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
    agent = ev.get("agent_name") or ""
    if et == "tool_call_start":
        return str(data.get("tool_name") or "tool")
    if et == "llm_request":
        model = data.get("model")
        return f"llm {model}" if model else "llm"
    if et == "approval_requested":
        return f"approval {data.get('tool') or ''}".strip()
    if et in ("task_start", "step_start", "workflow_start"):
        return str(data.get("name") or ev.get("node_id") or et.split("_")[0])
    if et == "agent_start":
        return agent or "agent"
    return "session"


def _match_key(ev: Dict[str, Any]) -> Tuple[Any, ...]:
    """Identity used to pair a start with its end when ``parent_seq`` is absent."""
    et = ev.get("event_type")
    data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
    base = END_START.get(et, et)
    extra: Any = None
    if base == "tool_call_start":
        extra = data.get("tool_name")
    elif base == "approval_requested":
        extra = data.get("approval_id")
    elif base in ("task_start", "step_start"):
        extra = ev.get("node_id") or data.get("name")
    agent = ev.get("agent_name") or ""
    if base in ("approval_requested", "session_start", "workflow_start"):
        agent = ""  # decisions/ends are often emitted by a different emitter name
    return (base, agent, ev.get("branch_id"), extra)


def build_spans(events: List[Dict[str, Any]], trace_id: str) -> List[Dict[str, Any]]:
    """Spans from start/end pairs.

    Schema 1.1: an end event's ``parent_seq`` names its start; a start's
    ``parent_seq`` names the enclosing span.  Schema 1.0 (no ``parent_seq``):
    ends pair with the oldest open start of the same kind/agent/tool, and the
    parent is the innermost span open when the start was seen (sequence order).
    ``llm_response`` is a point event whose ``parent_seq`` is its enclosing
    scope, so LLM spans always pair by order.
    """
    ordered = sorted(enumerate(events), key=lambda it: (_seq(it[1], it[0]), it[0]))
    spans: Dict[int, Dict[str, Any]] = {}
    start_type: Dict[int, str] = {}
    start_key: Dict[int, Tuple[Any, ...]] = {}
    open_by_key: Dict[Tuple[Any, ...], List[int]] = {}
    stack: List[int] = []
    order: List[int] = []

    for idx, ev in ordered:
        et = ev.get("event_type")
        seq = _seq(ev, idx)
        ts = _num(ev.get("timestamp"))
        if et in START_END:
            parent = ev.get("parent_seq")
            if not (isinstance(parent, int) and parent in spans):
                parent = next((s for s in reversed(stack) if spans[s]["status"] == "open"), None)
            data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
            span = {
                "id": f"{trace_id}:{seq}",
                "trace_id": trace_id,
                "parent_span_id": f"{trace_id}:{parent}" if parent is not None else None,
                "agent_id": ev.get("agent_name") or "",
                "name": _span_name(ev),
                "kind": _SPAN_KIND[et],
                "status": "open",
                "start_time": ts,
                "end_time": None,
                "duration_ms": None,
                "timestamp": ts,
                "attributes": {
                    k: v
                    for k, v in {
                        "node_id": ev.get("node_id"),
                        "branch_id": ev.get("branch_id"),
                        "start_seq": seq,
                        "input": data.get("tool_args") if et == "tool_call_start" else None,
                    }.items()
                    if v is not None
                },
                "events": [],
            }
            spans[seq] = span
            start_type[seq] = et
            start_key[seq] = _match_key(ev)
            order.append(seq)
            stack.append(seq)
            open_by_key.setdefault(start_key[seq], []).append(seq)
            continue
        if et not in END_START:
            continue
        start_seq = None
        ps = ev.get("parent_seq")
        key = _match_key(ev)
        if (
            et != "llm_response"
            and isinstance(ps, int)
            and ps in spans
            and spans[ps]["status"] == "open"
            and START_END.get(start_type[ps]) == et
        ):
            start_seq = ps
        else:
            queue = open_by_key.get(key) or []
            while queue and spans[queue[0]]["status"] != "open":
                queue.pop(0)
            if queue:
                start_seq = queue[0]
        if start_seq is None:
            continue
        q = open_by_key.get(start_key[start_seq])
        if q and start_seq in q:
            q.remove(start_seq)
        span = spans[start_seq]
        data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
        dur = data.get("duration_ms")
        span["end_time"] = ts
        span["duration_ms"] = (
            float(dur) if isinstance(dur, (int, float)) and not isinstance(dur, bool)
            else round(max(0.0, ts - span["start_time"]) * 1000, 3)
        )
        failed = bool(data.get("error")) or data.get("status") == "failed" or data.get("approved") is False
        span["status"] = "error" if failed else "ok"
        attrs = span["attributes"]
        for k in ("cost_usd", "prompt_tokens", "completion_tokens"):
            v = ev.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v:
                attrs[k] = v
        if data.get("error"):
            attrs["error"] = data.get("error")
        if start_seq in stack:
            stack.remove(start_seq)

    return [spans[s] for s in order]

