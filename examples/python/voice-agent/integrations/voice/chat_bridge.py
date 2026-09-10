"""Bridge voice call events into Chat UI sessions (sidebar + history)."""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from typing import Any

logger = logging.getLogger(__name__)

_bridge_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=512)
_worker_lock = threading.Lock()
_worker_task: asyncio.Task[None] | None = None


def voice_session_id(call_id: str) -> str:
    return f"voice-{call_id}"


def enqueue_transcript(call_id: str, role: str, text: str, *, final: bool) -> None:
    if not call_id or not text.strip():
        return
    _enqueue(
        {
            "kind": "transcript",
            "call_id": call_id,
            "role": role,
            "text": text.strip(),
            "final": final,
        }
    )


def enqueue_call_summary(call_id: str, summary: str, status: str) -> None:
    if not call_id:
        return
    _enqueue(
        {
            "kind": "summary",
            "call_id": call_id,
            "summary": summary.strip(),
            "status": status,
        }
    )


def _enqueue(item: dict[str, Any]) -> None:
    try:
        _bridge_queue.put_nowait(item)
    except queue.Full:
        logger.warning("Voice chat bridge queue full; dropping event")


async def _ensure_session(call_id: str) -> str:
    from praisonaiui.server import _datastore

    session_id = voice_session_id(call_id)
    existing = await _datastore.get_session(session_id)
    if existing is None:
        await _datastore.create_session(session_id)
        await _datastore.update_session(
            session_id,
            platform="voice",
            icon="📞",
            title=f"📞 Call {call_id[:8]}",
        )
    return session_id


async def _process_item(item: dict[str, Any]) -> None:
    from praisonaiui.features.chat import get_chat_manager
    from praisonaiui.server import _datastore

    call_id = str(item.get("call_id") or "")
    if not call_id:
        return
    session_id = await _ensure_session(call_id)
    mgr = get_chat_manager()

    if item.get("kind") == "transcript":
        role = str(item.get("role") or "unknown")
        text = str(item.get("text") or "")
        final = bool(item.get("final"))
        if not final:
            await mgr.broadcast(
                session_id,
                {
                    "type": "voice_transcript_partial",
                    "session_id": session_id,
                    "call_id": call_id,
                    "role": role,
                    "content": text,
                },
            )
            return
        content = f"**{role}:** {text}"
        await _datastore.add_message(
            session_id,
            {"role": "user" if role == "user" else "assistant", "content": content, "platform": "voice"},
        )
        await mgr.broadcast(
            session_id,
            {
                "type": "voice_transcript",
                "session_id": session_id,
                "call_id": call_id,
                "role": role,
                "content": text,
            },
        )
        return

    if item.get("kind") == "summary":
        summary = str(item.get("summary") or "(call ended)")
        status = str(item.get("status") or "ended")
        content = f"**Call {status}**\n\n{summary}"
        await _datastore.add_message(session_id, {"role": "assistant", "content": content, "platform": "voice"})
        await mgr.broadcast(
            session_id,
            {
                "type": "voice_call_ended",
                "session_id": session_id,
                "call_id": call_id,
                "status": status,
                "summary": summary,
            },
        )


async def run_chat_bridge_worker() -> None:
    while True:
        try:
            item = await asyncio.to_thread(_bridge_queue.get, True, 1.0)
        except queue.Empty:
            continue
        try:
            await _process_item(item)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Voice chat bridge error: %s", exc)


def start_chat_bridge_worker() -> None:
    global _worker_task
    with _worker_lock:
        if _worker_task is not None and not _worker_task.done():
            return
        loop = asyncio.get_running_loop()
        _worker_task = loop.create_task(run_chat_bridge_worker())
