"""Tests for callbacks.py context isolation (contextvars).

Verifies that concurrent async handlers each see their own MessageContext
instead of clobbering each other via a module-global variable.
"""

import asyncio

import pytest

from praisonaiui.callbacks import _get_context, _set_context
from praisonaiui.server import MessageContext


class TestContextIsolation:
    """Prove that _current_context uses contextvars, not a bare global."""

    def test_set_and_get_roundtrip(self):
        """Basic set/get works."""
        ctx = MessageContext(text="hello", session_id="s1")
        _set_context(ctx)
        assert _get_context() is ctx
        _set_context(None)
        assert _get_context() is None

    def test_default_is_none(self):
        """Default value is None when nothing has been set."""
        _set_context(None)
        assert _get_context() is None

    @pytest.mark.asyncio
    async def test_concurrent_tasks_isolated(self):
        """Two concurrent async tasks get independent contexts."""
        results = {}

        async def handler(name: str, delay: float):
            ctx = MessageContext(text=name, session_id=name)
            _set_context(ctx)
            await asyncio.sleep(delay)
            # After sleeping, our context should still be ours
            got = _get_context()
            results[name] = got.text if got else None

        # Task A sets context, sleeps; Task B sets different context
        await asyncio.gather(
            handler("task_a", 0.05),
            handler("task_b", 0.01),
        )

        # Each task must see its own context, not the other's
        assert results["task_a"] == "task_a"
        assert results["task_b"] == "task_b"
