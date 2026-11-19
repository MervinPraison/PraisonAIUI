"""Utility functions for PraisonAIUI.

This module provides common utility functions including async sleep
that yields to the event emitter to keep UI responsive.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import json
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Hashable, Optional, Tuple

# Characters that must never reach the HTML tokenizer inside a <script> element.
_SCRIPT_JSON_ESCAPES = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
}
_SCRIPT_JSON_TABLE = str.maketrans(_SCRIPT_JSON_ESCAPES)


def json_for_html(
    value: Any,
    *,
    separators: Optional[tuple[str, str]] = (",", ":"),
    ensure_ascii: bool = False,
    default: Optional[Callable[[Any], Any]] = None,
) -> str:
    """JSON that is safe to inline in a ``<script>`` element (ARCHITECTURE R9).

    The one escaper for inline JSON: ``<``, ``>``, ``&``, U+2028 and U+2029 are
    written as ``\\uXXXX`` escapes, so the text can never close the element or
    open a comment, and still parses to the same value. The keyword arguments
    pass through to :func:`json.dumps`.
    """
    text = json.dumps(value, separators=separators, ensure_ascii=ensure_ascii, default=default)
    return text.translate(_SCRIPT_JSON_TABLE)


async def sleep(seconds: float) -> None:
    """Async sleep that also yields to the event emitter.

    This function wraps asyncio.sleep and ensures that pending SSE events
    are flushed so the UI stays responsive during long sleep periods.

    Args:
        seconds: Number of seconds to sleep

    Example:
        import praisonaiui as aiui

        async def long_process():
            await aiui.Message("Starting process...").send()
            await aiui.sleep(2.0)  # Flushes events before sleeping
            await aiui.Message("Process complete!").send()
    """
    # Get current message context to access the stream queue
    from praisonaiui.callbacks import _get_context

    context = _get_context()

    # If we have an active context with a stream queue, flush pending events
    if context and hasattr(context, "_stream_queue") and context._stream_queue:
        try:
            # Yield to allow any pending events to be processed
            await asyncio.sleep(0)

            # Check if there are any pending items in the queue and process them
            # Note: We don't wait for queue processing to complete, just yield
            # to give the event loop a chance to process pending events
        except Exception:
            # If there's any issue with the context/queue, just proceed with normal sleep
            pass

    # Perform the actual sleep
    await asyncio.sleep(seconds)


def format_duration(seconds: float) -> str:
    """Format a duration in seconds to a human-readable string.

    Args:
        seconds: Duration in seconds

    Returns:
        Formatted duration string (e.g., "2.5s", "1m 30s", "1h 5m")
    """
    if seconds < 60:
        return f"{seconds:.1f}s"

    minutes = int(seconds // 60)
    remaining_seconds = seconds % 60

    if minutes < 60:
        if remaining_seconds > 0:
            return f"{minutes}m {remaining_seconds:.0f}s"
        return f"{minutes}m"

    hours = minutes // 60
    remaining_minutes = minutes % 60

    if remaining_minutes > 0:
        return f"{hours}h {remaining_minutes}m"
    return f"{hours}h"


def truncate_text(text: str, max_length: int = 100, suffix: str = "...") -> str:
    """Truncate text to a maximum length with an optional suffix.

    Args:
        text: Text to truncate
        max_length: Maximum length of the result (including suffix)
        suffix: Suffix to add if text is truncated

    Returns:
        Truncated text
    """
    if len(text) <= max_length:
        return text

    if len(suffix) >= max_length:
        return text[:max_length]

    # Truncate to fit the suffix, then strip trailing whitespace
    truncated = text[: max_length - len(suffix)].rstrip()
    return truncated + suffix


def safe_filename(filename: str, max_length: int = 255) -> str:
    """Convert a string to a safe filename by removing/replacing invalid characters.

    Args:
        filename: Original filename
        max_length: Maximum length of the result

    Returns:
        Safe filename
    """
    import re

    # Replace invalid characters with underscores
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", filename)

    # Remove leading/trailing dots and spaces
    safe_name = safe_name.strip(". ")

    # Truncate if too long
    if len(safe_name) > max_length:
        name, ext = safe_name.rsplit(".", 1) if "." in safe_name else (safe_name, "")
        max_name_length = max_length - len(ext) - 1 if ext else max_length
        safe_name = name[:max_name_length] + ("." + ext if ext else "")

    # Ensure it's not empty
    if not safe_name:
        safe_name = "untitled"

    return safe_name


def _cache_key(args: tuple, kwargs: dict) -> Hashable:
    key = (args, tuple(sorted(kwargs.items())))
    try:
        hash(key)
        return key
    except TypeError:  # a list or dict argument: key by its text instead
        return ("repr", repr(key))


def cache(
    func: Optional[Callable[..., Any]] = None,
    *,
    ttl: Optional[float] = None,
    maxsize: Optional[int] = None,
) -> Any:
    """Memoize expensive setup (a model, an index, a client) across chats.

    Keyed by the arguments (unhashable ones by their ``repr``); sync or async.
    Concurrent first calls share one computation (a cancelled awaiter does not
    cancel it); exceptions are not cached. ``ttl`` (seconds) expires entries,
    ``maxsize`` keeps the most recently used, ``fn.cache_clear()`` empties it.
    """
    if ttl is not None and not ttl > 0:
        raise ValueError("ttl must be a positive number of seconds")
    if maxsize is not None and (isinstance(maxsize, bool) or not isinstance(maxsize, int) or maxsize < 1):
        raise ValueError("maxsize must be a positive integer")

    def decorate(fn: Callable[..., Any]) -> Callable[..., Any]:
        store: "OrderedDict[Hashable, Tuple[Optional[float], Any]]" = OrderedDict()
        lock = threading.Lock()
        pending: Dict[Hashable, Any] = {}  # key -> threading.Lock / asyncio.Task in progress

        def lookup(key: Hashable) -> Tuple[bool, Any]:
            with lock:
                hit = store.get(key)
                if hit is None:
                    return False, None
                expires, value = hit
                if expires is not None and time.monotonic() >= expires:
                    del store[key]
                    return False, None
                store.move_to_end(key)
                return True, value

        def remember(key: Hashable, value: Any) -> None:
            with lock:
                store[key] = (None if ttl is None else time.monotonic() + ttl, value)
                store.move_to_end(key)
                while maxsize is not None and len(store) > maxsize:
                    store.popitem(last=False)

        def cache_clear() -> None:
            with lock:
                store.clear()

        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                key = _cache_key(args, kwargs)
                found, value = lookup(key)
                if found:
                    return value
                loop = asyncio.get_running_loop()
                with lock:
                    task = pending.get(key)
                    if task is None or task.get_loop() is not loop:
                        task = pending[key] = loop.create_task(fn(*args, **kwargs))

                        def done(t: "asyncio.Task[Any]", key: Hashable = key) -> None:
                            with lock:
                                if pending.get(key) is t:
                                    del pending[key]
                            if not t.cancelled() and t.exception() is None:
                                remember(key, t.result())

                        task.add_done_callback(done)
                return await asyncio.shield(task)

            async_wrapper.cache_clear = cache_clear  # type: ignore[attr-defined]
            return async_wrapper

        @functools.wraps(fn)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            key = _cache_key(args, kwargs)
            found, value = lookup(key)
            if found:
                return value
            with lock:
                key_lock = pending.setdefault(key, threading.Lock())
            with key_lock:  # one computation per key; later callers wait for it
                found, value = lookup(key)
                if found:
                    return value
                try:
                    value = fn(*args, **kwargs)
                    remember(key, value)
                    return value
                finally:
                    with lock:
                        if pending.get(key) is key_lock:
                            del pending[key]

        sync_wrapper.cache_clear = cache_clear  # type: ignore[attr-defined]
        return sync_wrapper

    return decorate(func) if func is not None else decorate
