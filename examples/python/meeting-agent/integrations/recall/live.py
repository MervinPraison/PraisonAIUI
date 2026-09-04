"""In-process live transcript fan-out for SSE subscribers."""

from __future__ import annotations

import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class LiveTranscriptState:
    """Latest live transcript snapshot for a meeting."""

    lines: list[str] = field(default_factory=list)
    text: str = ""
    live_status: str = ""


_lock = threading.Lock()
_states: dict[str, LiveTranscriptState] = {}
_subscribers: dict[str, list[threading.Event]] = defaultdict(list)


def get_live_state(meeting_id: str) -> LiveTranscriptState | None:
    with _lock:
        return _states.get(meeting_id)


def publish_live_chunk(
    meeting_id: str,
    *,
    line: str,
    full_text: str,
    live_status: str = "live",
) -> None:
    """Record a new utterance and notify SSE waiters."""
    with _lock:
        state = _states.setdefault(meeting_id, LiveTranscriptState())
        if line:
            state.lines.append(line)
        state.text = full_text
        state.live_status = live_status
        waiters = list(_subscribers.get(meeting_id, []))
    for event in waiters:
        event.set()


def set_live_status(meeting_id: str, live_status: str) -> None:
    with _lock:
        state = _states.setdefault(meeting_id, LiveTranscriptState())
        state.live_status = live_status
        waiters = list(_subscribers.get(meeting_id, []))
    for event in waiters:
        event.set()


def wait_for_update(meeting_id: str, timeout: float = 25.0) -> LiveTranscriptState | None:
    """Block until the meeting transcript changes or timeout (for SSE long-poll)."""
    event = threading.Event()
    with _lock:
        _subscribers[meeting_id].append(event)
        state = _states.get(meeting_id)
    event.wait(timeout=timeout)
    with _lock:
        subs = _subscribers.get(meeting_id, [])
        if event in subs:
            subs.remove(event)
        return _states.get(meeting_id)


def snapshot_for_api(meeting_id: str, record: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge in-memory live state with persisted meeting metadata."""
    meta = (record or {}).get("metadata") or {}
    live = get_live_state(meeting_id)
    text = (live.text if live and live.text else meta.get("transcript")) or ""
    return {
        "meeting_id": meeting_id,
        "live_status": (live.live_status if live and live.live_status else meta.get("live_status"))
        or "",
        "transcript": text,
        "line_count": len([ln for ln in text.splitlines() if ln.strip()]),
    }
