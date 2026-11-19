"""Sync↔async bridging utilities for PraisonAIUI.

This module provides utilities to bridge between synchronous and asynchronous
code, enabling smooth integration in mixed codebases.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import contextvars
import functools
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from typing import Any, Awaitable, Callable, Optional, TypeVar

T = TypeVar("T")


def make_async(
    func: Callable[..., T],
    *,
    cancellable: bool = True,
    executor: Optional[ThreadPoolExecutor] = None,
) -> Callable[..., Awaitable[T]]:
    """Wrap a blocking function to run asynchronously on a thread pool.

    Args:
        func: The blocking function to wrap
        cancellable: If True, cancelling the returned awaitable will attempt
            to cancel the executor future (best-effort)
        executor: Custom thread pool executor (if None, uses default)

    Returns:
        An async function that runs the original function on a thread pool

    Example:
        import time

        # Wrap a blocking function
        async_sleep = make_async(time.sleep)

        # Use it in async code
        await async_sleep(1.0)

        # Or with cancellation
        task = asyncio.create_task(async_sleep(5.0))
        task.cancel()  # Will attempt to cancel the thread
    """

    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> T:
        loop = asyncio.get_running_loop()
        # The thread gets a copy of this task's context: aiui.context.session,
        # user_session and aiui.run_sync(aiui.say(...)) work inside it.
        ctx = contextvars.copy_context()
        future = loop.run_in_executor(executor, functools.partial(ctx.run, func, *args, **kwargs))
        try:
            return await future
        except asyncio.CancelledError:
            if cancellable:
                future.cancel()  # best effort: a started thread runs to its end
            raise

    return wrapper


def run_sync(coro: Awaitable[T], *, timeout: Optional[float] = None) -> T:
    """Run a coroutine synchronously from a sync context.

    Args:
        coro: The coroutine to run
        timeout: Optional timeout in seconds

    Returns:
        The result of the coroutine

    Raises:
        RuntimeError: If called from within a running event loop
        asyncio.TimeoutError: If timeout is exceeded

    Example:
        async def async_function():
            return "result"

        # Run from sync context
        result = run_sync(async_function())
        print(result)  # "result"

        # With timeout
        result = run_sync(async_function(), timeout=5.0)
    """
    try:
        # Check if we're in a running event loop
        asyncio.get_running_loop()
        raise RuntimeError(
            "run_sync() cannot be called from a running event loop. "
            "Use await instead, or call from a synchronous context."
        )
    except RuntimeError as e:
        if "no running event loop" not in str(e).lower():
            # Re-raise if it's the "already running" error
            raise

    # In a worker thread started by make_async() inside a handler: run on the
    # handler's loop, in the handler's context, so UI calls reach its chat.
    from praisonaiui.context import current_session

    session = current_session()
    loop = session.loop if session is not None else None
    if loop is not None and loop.is_running() and not loop.is_closed():
        ctx = contextvars.copy_context()

        async def _in_handler_context() -> T:
            for var, value in ctx.items():
                var.set(value)
            return await coro

        future = asyncio.run_coroutine_threadsafe(_in_handler_context(), loop)
        try:
            return future.result(timeout)
        except concurrent.futures.TimeoutError:
            future.cancel()
            raise asyncio.TimeoutError() from None

    # Safe to create new event loop
    if timeout is not None:
        return asyncio.run(asyncio.wait_for(coro, timeout=timeout))
    else:
        return asyncio.run(coro)


class AsyncContext:
    """Context manager for running async code in sync contexts.

    This is useful when you need to run multiple async operations
    in a sync context without the overhead of starting/stopping
    the event loop multiple times.

    Example:
        with AsyncContext() as ctx:
            result1 = ctx.run(some_async_func())
            result2 = ctx.run(another_async_func())
    """

    def __init__(self):
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()

    def __enter__(self) -> "AsyncContext":
        # Check if already in async context
        try:
            asyncio.get_running_loop()
            raise RuntimeError("AsyncContext cannot be used from within a running event loop")
        except RuntimeError as e:
            if "no running event loop" not in str(e).lower():
                raise

        # Start event loop in a separate thread
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self._ready.wait()  # Wait for loop to be ready
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._loop and self._thread:
            # Schedule loop shutdown
            try:
                # Call stop() from the main thread
                self._loop.call_soon_threadsafe(self._loop.stop)
                self._thread.join(timeout=5.0)  # Add timeout to prevent hanging
                if self._thread.is_alive():
                    # Force cleanup if thread didn't stop properly
                    pass
            except Exception:
                # Best-effort cleanup
                pass

    def _run_loop(self):
        """Run the event loop in the background thread."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._ready.set()  # Signal that loop is ready
        try:
            self._loop.run_forever()
        finally:
            # Cleanup when loop stops
            self._loop.close()

    async def _shutdown(self):
        """Shutdown the event loop."""
        # This method is no longer needed
        pass

    def run(self, coro: Awaitable[T], timeout: Optional[float] = None) -> T:
        """Run a coroutine in the background event loop.

        Args:
            coro: The coroutine to run
            timeout: Optional timeout in seconds

        Returns:
            The result of the coroutine
        """
        if not self._loop:
            raise RuntimeError("AsyncContext not properly initialized")

        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result(timeout=timeout)
