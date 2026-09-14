"""Live transcript pub/sub for voice calls (SSE)."""

from __future__ import annotations

import asyncio
import json
import queue
import threading
from collections import defaultdict
from typing import Any, AsyncIterator


class TranscriptHub:
    """Thread-safe hub broadcasting transcript events per call_id."""

    def __init__(self) -> None:
        self._queues: dict[str, list[queue.Queue[dict[str, Any]]]] = defaultdict(list)
        self._lock = threading.Lock()

    def publish(self, call_id: str, event: dict[str, Any]) -> None:
        if not call_id:
            return
        with self._lock:
            queues = list(self._queues.get(call_id, []))
        for sub in queues:
            try:
                sub.put_nowait(event)
            except queue.Full:
                pass

    async def subscribe(self, call_id: str) -> AsyncIterator[dict[str, Any]]:
        sub: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=256)
        with self._lock:
            self._queues[call_id].append(sub)
        try:
            while True:
                try:
                    event = await asyncio.to_thread(sub.get, True, 1.0)
                except queue.Empty:
                    continue
                yield event
        finally:
            with self._lock:
                if call_id in self._queues and sub in self._queues[call_id]:
                    self._queues[call_id].remove(sub)

    def snapshot_sse(self, event: dict[str, Any]) -> str:
        return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


transcript_hub = TranscriptHub()
