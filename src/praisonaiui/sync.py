"""Sync↔async bridging utilities for PraisonAIUI.

This module provides utilities to bridge between synchronous and asynchronous
code, enabling smooth integration in mixed codebases.
"""

from __future__ import annotations

import asyncio
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from functools import wraps
from typing import Any, Awaitable, Callable, Optional, TypeVar

T = TypeVar("T")


def make_async(
    func: Callable[..., T], 
    *, 
    cancellable: bool = True,
    executor: Optional[ThreadPoolExecutor] = None
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
        
        # Use custom executor or default thread pool
        if executor:
            future = executor.submit(func, *args, **kwargs)
        else:
            # Use asyncio's default thread pool
            future = loop.run_in_executor(None, func, *args, **kwargs)
        
        if cancellable and hasattr(future, 'cancel'):
            # Create a cancellable task that wraps the future
            try:
                return await future
            except asyncio.CancelledError:
                # Best-effort cancellation of the underlying thread
                if hasattr(future, 'cancel'):
                    future.cancel()
                raise
        else:
            return await future
    
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
        loop = asyncio.get_running_loop()
        raise RuntimeError(
            "run_sync() cannot be called from a running event loop. "
            "Use await instead, or call from a synchronous context."
        )
    except RuntimeError as e:
        if "no running event loop" not in str(e).lower():
            # Re-raise if it's the "already running" error
            raise
    
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
            raise RuntimeError(
                "AsyncContext cannot be used from within a running event loop"
            )
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
            asyncio.run_coroutine_threadsafe(
                self._shutdown(), self._loop
            ).result()
            self._thread.join()
    
    def _run_loop(self):
        """Run the event loop in the background thread."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._ready.set()  # Signal that loop is ready
        self._loop.run_forever()
    
    async def _shutdown(self):
        """Shutdown the event loop."""
        loop = asyncio.get_running_loop()
        loop.stop()
    
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