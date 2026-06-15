"""StreamBridge — Thread-safe async-sync bridge for agent streaming.

Solves the concurrency architecture issue where PraisonAI agent execution
runs on worker threads while PraisonAIUI chat runs on asyncio. Token streaming
crosses this boundary via callbacks that must be thread-safe.

Usage:
    bridge = StreamBridge()

    # In agent callback (worker thread):
    bridge.emit_token(token)

    # In asyncio handler:
    async for token in bridge.consume():
        await aiui.stream_token(token)
"""

import asyncio
import threading
from typing import Any, AsyncIterator, Callable


class StreamBridge:
    """Thread-safe bridge for streaming tokens from worker threads to asyncio."""

    def __init__(self, loop: asyncio.AbstractEventLoop | None = None):
        """Initialize the bridge.

        Args:
            loop: Event loop to use. If None, uses the current running loop.
        """
        self._loop = loop
        self._queue: asyncio.Queue | None = None
        self._cancelled = False
        self._lock = threading.Lock()

    def _ensure_queue(self) -> asyncio.Queue:
        """Lazy initialization of the queue."""
        if self._queue is None:
            if self._loop is None:
                try:
                    self._loop = asyncio.get_running_loop()
                except RuntimeError:
                    raise RuntimeError("No running event loop found. Call from async context.")
            self._queue = asyncio.Queue()
        return self._queue

    def emit_token(self, token: str) -> None:
        """Emit a token from a worker thread (thread-safe).

        Args:
            token: Token to emit, or None to signal end of stream.
        """
        with self._lock:
            if self._cancelled:
                return

            queue = self._ensure_queue()
            if self._loop is None:
                raise RuntimeError("Event loop not set")

            # Use call_soon_threadsafe for thread-safe queue operations
            self._loop.call_soon_threadsafe(queue.put_nowait, token)

    def emit_end(self) -> None:
        """Signal end of stream (thread-safe)."""
        self.emit_token(None)

    async def consume(self, timeout: float = 120.0) -> AsyncIterator[str]:
        """Consume tokens asynchronously.

        Args:
            timeout: Timeout in seconds for each token.

        Yields:
            Tokens as they arrive. Stops when None is received (end signal).
        """
        queue = self._ensure_queue()

        while not self._cancelled:
            try:
                token = await asyncio.wait_for(queue.get(), timeout=timeout)
            except asyncio.TimeoutError:
                break

            if token is None:  # End of stream sentinel
                break

            yield token

    def cancel(self) -> None:
        """Cancel the bridge and stop token emission (thread-safe)."""
        with self._lock:
            self._cancelled = True
            # Signal any waiting consumers
            if self._queue is not None and self._loop is not None:
                self._loop.call_soon_threadsafe(self._queue.put_nowait, None)

    def emitter_callback(self) -> Callable[[Any], None]:
        """Create a callback function for agent stream emitters.

        Returns:
            Callback function that can be passed to agent.stream_emitter.add_callback()
        """
        def callback(event):
            """Handle stream events from PraisonAI agent."""
            try:
                from praisonaiagents.streaming.events import StreamEventType

                if event.type == StreamEventType.DELTA_TEXT and event.content:
                    self.emit_token(event.content)
                elif event.type == StreamEventType.FIRST_TOKEN and event.content:
                    self.emit_token(event.content)
                elif event.type == StreamEventType.STREAM_END:
                    self.emit_end()
            except (ImportError, AttributeError):
                # Fallback for other event types or missing dependencies
                if hasattr(event, 'content') and event.content:
                    self.emit_token(event.content)

        return callback


def create_stream_bridge(loop: asyncio.AbstractEventLoop | None = None) -> StreamBridge:
    """Create a new StreamBridge instance.

    Args:
        loop: Event loop to use. If None, uses the current running loop.

    Returns:
        New StreamBridge instance.
    """
    return StreamBridge(loop)
